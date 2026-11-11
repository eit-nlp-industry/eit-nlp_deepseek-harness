import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

export const name = 's2s-harness-control';
export const inject = ['agents', 'sessions'];
const operations = new Set(['begin', 'cancel', 'mask', 'finish', 'inspect', 'ping', 'retire']);
const fail = error => ({ ok: false, error });
const textOf = message => Array.isArray(message?.content)
  ? message.content.filter(p => p.type === 'text').map(p => p.text).join('') : '';
const sha256 = text => createHash('sha256').update(text).digest('hex');
// Same identified, immutable shape as the SDK createDeveloperMessage factory.
const emptyDeveloper = input => Object.freeze({ ...input, content: Object.freeze([]),
  source: Object.freeze({ ...input.source }), role: 'developer', id: randomUUID() });

export function createController(ctx, options = {}) {
  const requests = new Map(), current = new Map();
  const instanceId = randomUUID();
  const factory = options.createDeveloperMessage ?? emptyDeveloper;
  let serial = Promise.resolve();
  const endSeq = session => session?.snapshotEvents().at(-1)?.seq ?? -1;
  const summary = r => ({ ok: true, sessionId: r.sessionId, requestKey: r.requestKey,
    turn: r.turn ?? null, rpcId: r.rpcId ?? null, finished: r.finished, masked: r.masked,
    sessionExists: r.sessionExists, maskedCount: r.maskedCount ?? 0,
    promptSelection: r.promptSelection, promptHash: r.promptHash,
    state: r.retired ? 'retired' : r.masked ? 'masked' : r.finished ? 'finished' : r.turn === undefined ? 'reserved' : 'claimed' });
  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    const r = requests.get(current.get(agent.session.id));
    if (!r || r.finished || r.masked) return;
    const matches = Number.isSafeInteger(turn) && (!r.promptHash || sha256(textOf(message)) === r.promptHash);
    if (!matches || (r.turn !== undefined && (r.turn !== turn || r.rpcId !== message.source?.rpcId))) {
      r.invalid = true; return;
    }
    r.turn = turn; r.rpcId = message.source?.rpcId; r.sessionExists = true;
  }, { global: true });
  async function mask(agent, r) {
    if (r.masked) return summary(r);
    if (!agent) { r.masked = true; r.finished = true; return summary(r); }
    await agent.runMaintenance(async signal => {
      if (signal.aborted) throw new Error('aborted');
      if (r.invalid) throw new Error('claim_mismatch');
      const events = agent.session.snapshotEvents();
      let turn, userSeq;
      const selected = [];
      const live = new Set(agent.session.surface.nodes);
      for (const event of events) {
        if (event.type === 'turn/start') turn = event.data.turn;
        const eventTurn = event.data?.turn ?? turn;
        if (event.seq <= r.baseline || event.seq > (r.end ?? Infinity) || eventTurn !== r.turn) continue;
        if (event.type === 'user/message') {
          // A second input in the same turn is foreign: never span across it.
          if (userSeq !== undefined) throw new Error('ambiguous_turn');
          if (r.promptHash && sha256(textOf(event.data)) !== r.promptHash) throw new Error('claim_mismatch');
          if (r.rpcId && event.data.source?.rpcId !== r.rpcId) throw new Error('claim_mismatch');
          userSeq = event.seq;
        } else if (userSeq !== undefined && live.has(event.seq)) {
          if (event.type === 'system/message') throw new Error('ambiguous_turn');
          selected.push(event);
        }
      }
      if (r.turn !== undefined && userSeq === undefined) throw new Error('missing_user');
      if (selected.length) {
        const first = selected[0], last = selected.at(-1);
        // The replacement interval must contain only this request's selected nodes.
        const sources = [...live].filter(seq => seq >= first.seq && seq <= last.seq);
        if (sources.length !== selected.length) throw new Error('ambiguous_turn');
        const step = selected.find(e => Number.isSafeInteger(e.data?.step))?.data.step ?? 1;
        agent.session.append('developer/message', { turn: r.turn, step,
          message: factory({ content: [], source: { kind: 'user' } }) }, {
          surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: last.seq }, sourceEventSeqs: sources,
        });
        r.maskedCount = selected.length;
      }
      await ctx.sessions.flush(agent.session);
      r.masked = true; r.finished = true;
    });
    return summary(r);
  }
  async function dispatch(job) {
    if (!job || job.protocol !== 1 || !operations.has(job.operation)) return fail('invalid_job');
    if (job.operation === 'ping') return { ok: true, protocol: 1, instanceId };
    const { sessionId, requestKey, operation } = job;
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256 ||
        typeof requestKey !== 'string' || !requestKey || requestKey.length > 256 ||
        (job.promptHash !== undefined && !/^[a-f0-9]{64}$/.test(job.promptHash)) ||
        (job.continuationHash !== undefined && (!job.promptHash || !/^[a-f0-9]{64}$/.test(job.continuationHash)))) return fail('invalid_job');
    let r = requests.get(requestKey);
    if (r && r.sessionId !== sessionId) return fail('request_session_mismatch');
    if (operation === 'begin') {
      if (job.promptHash === undefined) return fail('invalid_job');
      if (r?.retired) return fail('request_retired');
      if (r) return r.originalPromptHash === job.promptHash && r.continuationHash === job.continuationHash ? summary(r) : fail('request_conflict');
      if (requests.size >= (options.maxRequests ?? 4096)) return fail('capacity');
      const previous = requests.get(current.get(sessionId));
      if (previous && !previous.finished && !previous.masked) return fail('previous_unfinished');
      const agent = await ctx.agents.get(sessionId);
      if (agent && agent.status !== 'idle') return fail('session_busy');
      const continuation = Boolean(agent) && job.continuationHash !== undefined;
      r = { sessionId, requestKey, originalPromptHash: job.promptHash, continuationHash: job.continuationHash,
        promptHash: continuation ? job.continuationHash : job.promptHash, promptSelection: continuation ? 'continuation' : 'seed',
        baseline: endSeq(agent?.session), sessionExists: Boolean(agent), finished: false, masked: false };
      requests.set(requestKey, r); current.set(sessionId, requestKey); return summary(r);
    }
    if (!r) return fail('unknown_request');
    if (operation === 'inspect') return summary(r);
    if (r.retired) return operation === 'retire' && job.neverSubmitted === true ? summary(r) : fail('request_retired');
    if (r.invalid) return fail('claim_mismatch');
    if (r.masked) return summary(r);
    const agent = await ctx.agents.get(sessionId);
    r.sessionExists = Boolean(agent);
    if (operation === 'retire') {
      if (job.neverSubmitted !== true) return fail('retirement_unproven');
      // The authenticated caller must have prevented and joined all submission tasks.
      // Idle status alone cannot prove an RPC is not delayed in the network.
      const inbox = agent?.inbox;
      if (r.turn !== undefined || r.finished || current.get(sessionId) !== requestKey ||
          (agent && (agent.status !== 'idle' || endSeq(agent.session) !== r.baseline ||
            !Array.isArray(inbox?.nextTurn) || !Array.isArray(inbox?.nextStep) ||
            inbox.nextTurn.length || inbox.nextStep.length))) return fail('retirement_unsafe');
      r.retired = true; r.finished = true; current.delete(sessionId); return summary(r);
    }
    if (operation === 'finish') {
      if (r.finished) return summary(r);
      if (current.get(sessionId) !== requestKey && !r.finished) return fail('stale_request');
      if (agent) await agent.whenIdle();
      r.end ??= endSeq(agent?.session); r.finished = true; return summary(r);
    }
    const isCurrent = current.get(sessionId) === requestKey;
    if (operation === 'cancel' && isCurrent && !r.finished) {
      // An unclaimed running turn has no proven ownership yet.
      if (agent && r.turn === undefined) return fail('unclaimed_request');
      if (agent) { agent.cancel({ kind: 'user' }); await agent.whenIdle(); }
      r.end ??= endSeq(agent?.session);
    } else if (agent && agent.status !== 'idle') return fail('session_busy');
    else if (!r.finished && r.turn === undefined && agent) return fail('unclaimed_request');
    return mask(agent, r);
  }
  return { handle(job) {
    const next = serial.then(() => dispatch(job)).catch(error => fail(
      ['claim_mismatch', 'ambiguous_turn', 'missing_user'].includes(error?.message) ? error.message : 'operation_failed'));
    serial = next.then(() => undefined); return next;
  } };
}

export async function apply(ctx, config) {
  const url = new URL(config.controlUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid control URL');
  const info = await stat(config.keyFile);
  if (!info.isFile() || info.size > 8192 || (process.platform !== 'win32' && (info.mode & 0o077))) throw new Error('Control key must be a private file');
  const key = (await readFile(config.keyFile, 'utf8')).trim();
  if (key.length < 32 || key.length > 4096 || /\s/.test(key)) throw new Error('Invalid control key');
  const controller = createController(ctx, config);
  const stop = new AbortController();
  const maxBytes = Math.min(config.maxPayloadBytes ?? 65536, 1048576);
  const timeoutMs = Math.min(Math.max(config.timeoutMs ?? 35000, 1000), 120000);
  const base = url.href.replace(/\/$/, '');
  async function request(path, payload) {
    const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(timeoutMs)]);
    const response = await fetch(`${base}/${path}`, { method: payload ? 'POST' : 'GET', signal,
      headers: { Authorization: `Bearer ${key}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Control transport failure'); }
    const chunks = []; let total = 0;
    for await (const chunk of response.body ?? []) {
      total += chunk.length;
      if (total > maxBytes) { await response.body?.cancel().catch(() => {}); throw new Error('Control payload too large'); }
      chunks.push(chunk);
    }
    return total ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  }
  async function loop() {
    let failures = 0;
    while (!stop.signal.aborted) {
      try {
        const { job } = await request('jobs');
        if (job) {
          if (typeof job.id !== 'string' || job.id.length > 256) throw new Error('Invalid control job');
          const result = await controller.handle(job);
          for (let attempt = 0; ; attempt++) {
            try { await request('results', { id: job.id, result }); break; }
            catch { if (attempt >= 2 || stop.signal.aborted) throw new Error('Control result failed'); }
          }
        } else await delay(100, undefined, { signal: stop.signal });
        failures = 0;
      } catch {
        if (stop.signal.aborted) break;
        failures = Math.min(failures + 1, 6);
        await delay(Math.min(250 * 2 ** failures, 10000), undefined, { signal: stop.signal }).catch(() => {});
      }
    }
  }
  ctx.effect(() => { const task = loop(); return async () => { stop.abort(); await task; }; });
}
