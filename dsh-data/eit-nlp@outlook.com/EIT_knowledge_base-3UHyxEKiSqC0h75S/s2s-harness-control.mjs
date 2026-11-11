import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

export const name = 's2s-harness-control';
export const inject = ['agents', 'sessions'];
const operations = new Set(['begin', 'cancel', 'mask', 'finish', 'inspect', 'ping', 'retire', 'retain']);
const fail = error => ({ ok: false, error });
const textOf = message => Array.isArray(message?.content)
  ? message.content.filter(p => p.type === 'text').map(p => p.text).join('') : '';
const sha256 = text => createHash('sha256').update(text).digest('hex');
// Same identified, immutable shape as the SDK createDeveloperMessage factory.
const emptyDeveloper = input => Object.freeze({ ...input, content: Object.freeze([]),
  source: Object.freeze({ ...input.source }), role: 'developer', id: randomUUID() });

export async function decorateVoiceSessionTitle(ctx, agent) {
  try {
    if (!agent?.session?.id.startsWith('voice-') || agent.status !== 'idle') return false;
    const titles = ctx.get?.('sessionTitle') ?? ctx.sessionTitle;
    if (!titles || typeof titles.get !== 'function' || typeof titles.rename !== 'function') return false;
    const title = titles.get(agent.session)?.title;
    if (typeof title !== 'string' || !title.trim() || title.startsWith('S2S语音 · ')) return false;
    // The SDK's log-only title API is synchronous and does not require Agent
    // maintenance. The controller calls this inside its operation queue so a
    // later begin cannot capture its baseline before this metadata append.
    titles.rename(agent.session, `S2S语音 · ${title}`);
    // Only persistence is background work; it appends no Session events and
    // holds no maintenance/admission lock.
    void Promise.resolve().then(() => ctx.sessions.flush(agent.session)).catch(() => {});
    return true;
  } catch { return false; } // Visibility must never fail a context-control ACK.
}

export function createController(ctx, options = {}) {
  const requests = new Map(), current = new Map();
  const instanceId = randomUUID();
  const factory = options.createDeveloperMessage ?? emptyDeveloper;
  const claimTimeoutMs = Math.min(Math.max(options.claimTimeoutMs ?? 5000, 1), 30000);
  let serial = Promise.resolve();
  const endSeq = session => session?.snapshotEvents().at(-1)?.seq ?? -1;
  const summary = r => ({ ok: true, sessionId: r.sessionId, requestKey: r.requestKey,
    turn: r.turn ?? null, rpcId: r.rpcId ?? null, finished: r.finished, masked: r.masked,
    sessionExists: r.sessionExists, maskedCount: r.maskedCount ?? 0,
    ...(r.heardText === undefined ? {} : { heardText: r.heardText, retainedChars: r.heardText.length }),
    promptSelection: r.promptSelection, promptHash: r.promptHash,
    state: r.retired ? 'retired' : r.heardText ? 'retained' : r.masked ? 'masked' : r.finished ? 'finished' : r.turn === undefined ? 'reserved' : 'claimed' });
  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    const r = requests.get(current.get(agent.session.id));
    if (!r || r.finished || r.masked) return;
    const matches = Number.isSafeInteger(turn) && (!r.promptHash || sha256(textOf(message)) === r.promptHash);
    if (!matches || (r.turn !== undefined && (r.turn !== turn || r.rpcId !== message.source?.rpcId))) {
      r.invalid = true; r.claimWake?.(); return;
    }
    r.turn = turn; r.rpcId = message.source?.rpcId; r.sessionExists = true;
    r.claimWake?.();
  }, { global: true });
  async function waitForClaim(r) {
    if (r.turn !== undefined || r.invalid) return;
    await new Promise(resolve => {
      const timer = setTimeout(resolve, claimTimeoutMs);
      r.claimWake = () => { clearTimeout(timer); resolve(); };
    });
    delete r.claimWake;
  }
  async function mask(agent, r) {
    if (r.masked) return summary(r);
    if (!agent) { r.masked = true; r.finished = true; return summary(r); }
    await agent.runMaintenance(async signal => {
      if (signal.aborted) throw new Error('aborted');
      if (r.invalid) throw new Error('claim_mismatch');
      const events = agent.session.snapshotEvents();
      let turn, userSeq, orphanSurface = false;
      const selected = [];
      const live = new Set(agent.session.surface.nodes);
      for (const event of events) {
        if (event.type === 'turn/start') turn = event.data.turn;
        const eventTurn = event.data?.turn ?? turn;
        if (event.seq <= r.baseline || event.seq > (r.end ?? Infinity) || eventTurn !== r.turn) continue;
        if (userSeq === undefined && live.has(event.seq) && !['system/message','user/message'].includes(event.type)) orphanSurface = true;
        if (event.type === 'user/message') {
          // Harness seeds runtime metadata after the first real user input.
          // Keep this anchor; it is not a second human/RPC request. Reject
          // unexpected placement rather than spanning a preserved node.
          if (userSeq !== undefined && event.data.source?.kind === 'runtime-context' && !event.data.source?.rpcId) {
            if (selected.length) throw new Error('ambiguous_turn');
            continue;
          }
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
      // A claimed turn can be cancelled before its queued user message reaches
      // the surface. After idle there is nothing to remove in that empty turn.
      // Never use this exception to leave unexplained output in model context.
      if (r.turn !== undefined && userSeq === undefined && orphanSurface) throw new Error('missing_user');
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
      r.projectionPending = false;
      r.masked = true; r.finished = true;
    });
    return summary(r);
  }
  async function retain(agent, r, heardText) {
    // Authenticated backend speech can differ from raw Markdown model output.
    if (r.heardText !== undefined && !r.heardText.startsWith(heardText)) return fail('retain_extension');
    r.projectionPending = true;
    if (!r.masked) await mask(agent, r);
    r.projectionPending = true;
    await agent.runMaintenance(async signal => {
      if (signal.aborted) throw new Error('aborted');
      if (r.heardText !== heardText) {
        if (r.retainedSeq !== undefined) {
          if (!agent.session.surface.nodes.includes(r.retainedSeq)) throw new Error('ambiguous_turn');
          agent.session.append('developer/message', { turn: r.turn, step: 1,
            message: factory({ content: [], source: { kind: 'user' } }) }, {
            surfaceOp: { op: 'replace', startSeq: r.retainedSeq, endSeq: r.retainedSeq },
            sourceEventSeqs: [r.retainedSeq],
          });
          delete r.retainedSeq;
        }
        if (heardText) {
          // Older SDKs forbid sourceEventSeqs on assistant/message. Shadow
          // originals separately, then append ordinary assistant-role text.
          const event = agent.session.append('assistant/message', { turn: r.turn, step: 1, stream: [],
            message: Object.freeze({ id: randomUUID(), role: 'assistant',
              content: Object.freeze([Object.freeze({ type: 'text', text: heardText })]),
              source: Object.freeze({ kind: 'model', provider: 's2s', model: 'heard-playback' }) }) }, { surfaceOp: 'append' });
          r.retainedSeq = event.seq;
        }
        r.heardText = heardText;
        r.projectionPending = true;
      }
      await ctx.sessions.flush(agent.session);
      r.projectionPending = false;
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
        (job.continuationHash !== undefined && (!job.promptHash || !/^[a-f0-9]{64}$/.test(job.continuationHash))) ||
        (operation === 'retain' && (typeof job.heardText !== 'string' || job.heardText.length > 65536)) ||
        (job.contains !== undefined && (typeof job.contains !== 'string' || job.contains.length > 1024))) return fail('invalid_job');
    let r = requests.get(requestKey);
    if (r && r.sessionId !== sessionId) return fail('request_session_mismatch');
    if (operation === 'begin') {
      if (job.promptHash === undefined) return fail('invalid_job');
      if (r?.retired) return fail('request_retired');
      if (r) return r.originalPromptHash === job.promptHash && r.continuationHash === job.continuationHash ? summary(r) : fail('request_conflict');
      if (requests.size >= (options.maxRequests ?? 4096)) return fail('capacity');
      const previous = requests.get(current.get(sessionId));
      if (previous && (previous.projectionPending || (!previous.finished && !previous.masked))) return fail('previous_unfinished');
      const agent = await ctx.agents.get(sessionId);
      if (agent && agent.status !== 'idle') return fail('session_busy');
      const continuation = Boolean(agent) && job.continuationHash !== undefined;
      r = { sessionId, requestKey, originalPromptHash: job.promptHash, continuationHash: job.continuationHash,
        promptHash: continuation ? job.continuationHash : job.promptHash, promptSelection: continuation ? 'continuation' : 'seed',
        baseline: endSeq(agent?.session), sessionExists: Boolean(agent), finished: false, masked: false };
      requests.set(requestKey, r); current.set(sessionId, requestKey); return summary(r);
    }
    if (!r) return fail('unknown_request');
    if (operation === 'inspect') {
      const agent = await ctx.agents.get(sessionId);
      r.sessionExists = Boolean(agent);
      const events = agent?.session.snapshotEvents() ?? [];
      return { ...summary(r), rawEventCount: events.length, surfaceNodeCount: agent?.session.surface.nodes.length ?? 0,
        ...(job.contains === undefined ? {} : {
          rawContains: JSON.stringify(events).includes(job.contains),
          effectiveContains: JSON.stringify(agent?.session.deriveMessages() ?? []).includes(job.contains),
        }) };
    }
    if (r.retired) return operation === 'retire' && job.neverSubmitted === true ? summary(r) : fail('request_retired');
    if (r.invalid) return fail('claim_mismatch');
    if (r.masked && operation !== 'retain') {
      if (r.projectionPending) return fail('retain_pending');
      return summary(r);
    }
    let agent = await ctx.agents.get(sessionId);
    r.sessionExists = Boolean(agent);
    if (operation === 'retain') {
      if (current.get(sessionId) !== requestKey) return fail('stale_request');
      if (r.turn === undefined) return fail('unclaimed_request');
      if (!agent) return fail('session_unavailable');
      if (agent.status !== 'idle') return fail('session_busy');
      if (agent.session.snapshotEvents().some(e => e.seq > r.baseline && e.type === 'turn/start' && e.data.turn !== r.turn)) return fail('stale_request');
      r.end ??= endSeq(agent.session);
      return retain(agent, r, job.heardText);
    }
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
      // The workflow may have admitted its RPC before the inbox claims it.
      // A listener outside the operation queue supplies proof before cancellation.
      await waitForClaim(r);
      if (r.invalid) return fail('claim_mismatch');
      if (r.turn === undefined) return fail('unclaimed_request');
      agent = await ctx.agents.get(sessionId);
      r.sessionExists = Boolean(agent);
      if (!agent) return fail('session_unavailable');
      if (agent) { agent.cancel({ kind: 'user' }); await agent.whenIdle(); }
      r.end ??= endSeq(agent?.session);
    } else if (agent && agent.status !== 'idle') return fail('session_busy');
    else if (!r.finished && r.turn === undefined && agent) return fail('unclaimed_request');
    return mask(agent, r);
  }
  return { handle(job) {
    const next = serial.then(async () => {
      const result = await dispatch(job);
      // Title mutation is ordered with ownership registration, never after a
      // new reservation baseline. It uses no maintenance task; storage I/O
      // stays independent and every optional metadata failure is isolated.
      if (result.ok && ['finish', 'cancel', 'mask', 'retain'].includes(job?.operation) &&
          typeof job.sessionId === 'string' && job.sessionId.startsWith('voice-') &&
          current.get(job.sessionId) === job.requestKey) {
        try { await decorateVoiceSessionTitle(ctx, await ctx.agents.get(job.sessionId)); } catch {}
      }
      return result;
    }).catch(error => fail(
      ['claim_mismatch', 'ambiguous_turn', 'missing_user'].includes(error?.message) ? error.message : 'operation_failed'));
    serial = next.then(() => undefined); return next;
  } };
}

export async function apply(ctx, config) {
  let previousStatus;
  async function status(stage, details = {}) {
    if (typeof config.statusFile !== 'string' || !config.statusFile) return;
    const value = JSON.stringify({ stage, ...details });
    if (value === previousStatus) return;
    try { await writeFile(config.statusFile, value + '\n', { mode: 0o600 }); previousStatus = value; } catch {}
  }
  await status('loaded');
  const url = new URL(config.controlUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid control URL');
  const info = await stat(config.keyFile);
  if (!info.isFile() || info.size > 8192 || (process.platform !== 'win32' && (info.mode & 0o077))) throw new Error('Control key must be a private file');
  const key = (await readFile(config.keyFile, 'utf8')).trim();
  if (key.length < 32 || key.length > 4096 || /\s/.test(key)) throw new Error('Invalid control key');
  const controller = createController(ctx, config);
  const stop = new AbortController();
  const maxBytes = Math.min(config.maxPayloadBytes ?? 524288, 1048576);
  const timeoutMs = Math.min(Math.max(config.timeoutMs ?? 35000, 1000), 120000);
  const base = url.href.replace(/\/$/, '');
  async function request(path, payload) {
    const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(timeoutMs)]);
    const response = await fetch(`${base}/${path}`, { method: payload ? 'POST' : 'GET', signal,
      headers: { Authorization: `Bearer ${key}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}) });
    if (!response.ok) {
      await status('http_error', { httpStatus: response.status });
      await response.body?.cancel();
      const error = new Error('Control transport failure'); error.httpStatus = response.status; throw error;
    }
    const chunks = []; let total = 0;
    for await (const chunk of response.body ?? []) {
      total += chunk.length;
      if (total > maxBytes) { await response.body?.cancel().catch(() => {}); throw new Error('Control payload too large'); }
      chunks.push(chunk);
    }
    const result = total ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    await status('connected'); return result;
  }
  async function loop() {
    let failures = 0;
    while (!stop.signal.aborted) {
      try {
        await status('polling');
        const { job } = await request('jobs');
        if (job) {
          if (typeof job.id !== 'string' || job.id.length > 256) throw new Error('Invalid control job');
          const result = await controller.handle(job);
          for (let attempt = 0; ; attempt++) {
            try { await request('results', { id: job.id, result }); break; }
            catch (error) { if (attempt >= 2 || stop.signal.aborted) throw error; }
          }
        } else await delay(100, undefined, { signal: stop.signal });
        failures = 0;
      } catch (error) {
        if (stop.signal.aborted) break;
        if (!error?.httpStatus) {
          const code = error?.cause?.code;
          await status('transport_error', typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? { code } : {});
        }
        failures = Math.min(failures + 1, 6);
        await delay(Math.min(250 * 2 ** failures, 10000), undefined, { signal: stop.signal }).catch(() => {});
      }
    }
  }
  ctx.effect(() => { const task = loop(); return async () => { stop.abort(); await task; }; });
}
