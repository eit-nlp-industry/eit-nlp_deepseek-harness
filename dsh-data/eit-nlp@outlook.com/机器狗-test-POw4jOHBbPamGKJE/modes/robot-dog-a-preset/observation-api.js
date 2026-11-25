// HTTP surface for the Web UI: read observation state and toggle it.
//
// The browser plugin polls /observation/state and calls /observation/start or
// /observation/stop. Same-origin only; no extra auth beyond the page session.

export const name = 'observation-api'
export const inject = ['webServer']

function send(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(payload.byteLength),
  })
  res.end(payload)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.length === 0) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

export function apply(ctx) {
  // Observation lives inside the robot-dog preset; the hub tracks the live one.
  function service() {
    const current = ctx.get('observation-hub')?.current?.()
    if (current === undefined || current === null) throw new Error('观察尚未启动')
    return current
  }

  // Standalone control page: no Web build needed, plain HTML + fetch.
  const PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>机器狗观察</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;color:#e6edf3;
  background:radial-gradient(900px 480px at 50% -20%,#1c2531,#0b0f14 65%);
  font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.card{width:min(620px,92vw);padding:22px 24px;border-radius:16px;
  background:linear-gradient(180deg,#161b22,#11161c);border:1px solid #262d37;
  box-shadow:0 18px 50px rgba(0,0,0,.5)}
.head{display:flex;align-items:center;gap:10px;margin-bottom:18px}
.dot{width:9px;height:9px;border-radius:50%;background:#5c6773;flex:none;transition:background .2s}
h1{margin:0;font-size:15px;font-weight:600;letter-spacing:.02em}
.badge{margin-left:auto;font-size:12px;padding:3px 10px;border-radius:999px;
  border:1px solid #2b333e;background:#1a2029;color:#9aa7b4}
.stats{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:20px}
.stat{display:flex;flex-direction:column;gap:2px;min-width:52px}
.stat b{font-size:20px;line-height:1.25;font-variant-numeric:tabular-nums;font-weight:600}
.stat span{font-size:11px;letter-spacing:.06em;color:#7f8b99}
.actions{display:flex;gap:10px;justify-content:flex-end;border-top:1px solid #222a34;padding-top:16px}
button{font:inherit;font-size:13px;padding:7px 16px;border-radius:9px;cursor:pointer;
  border:1px solid #2f3743;background:#1b222c;color:#dbe4ee;transition:filter .15s,border-color .15s}
button:hover:not(:disabled){filter:brightness(1.18);border-color:#3a4453}
button:disabled{opacity:.45;cursor:default}
button.primary{background:#2f81f7;border-color:#2f81f7;color:#fff}
.err{min-height:18px;margin-top:12px;font-size:12px;color:#ff7b72;word-break:break-all}
</style></head><body>
<div class="card">
  <div class="head"><span class="dot" id="dot"></span><h1>机器狗观察</h1><span class="badge" id="mode">—</span></div>
  <div class="stats">
    <div class="stat"><b id="state">—</b><span>状态</span></div>
    <div class="stat"><b id="seen">0</b><span id="seenLabel">在场</span></div>
    <div class="stat" id="stillBox"><b id="still">0</b><span>静止</span></div>
    <div class="stat"><b id="missing">0</b><span>缺席</span></div>
    <div class="stat"><b id="video">—</b><span>视频秒</span></div>
    <div class="stat"><b id="duration">—</b><span>时长</span></div>
  </div>
  <div class="actions">
    <button id="reset">重置</button>
    <button id="toggle" class="primary">…</button>
  </div>
  <div class="err" id="err"></div>
</div>
<script>
const q=s=>document.querySelector(s);let busy=false;
async function poll(){try{const r=await fetch('/observation/state',{cache:'no-store'});const s=await r.json();
q('#dot').style.background=s.running?'#3fb950':'#5c6773';
q('#mode').textContent=s.mode;q('#state').textContent=s.state;
const guide=s.mode==='guide_follow';
q('#seenLabel').textContent=guide?'走动':'在场';
q('#seen').textContent=s.seen;q('#missing').textContent=s.missing;
q('#stillBox').style.display=guide?'':'none';q('#still').textContent=s.still;
q('#video').textContent=typeof s.videoSeconds==='number'?s.videoSeconds.toFixed(1):'—';
q('#duration').textContent=typeof s.durationSec==='number'?s.durationSec.toFixed(1):'—';
q('#err').textContent=s.lastError?('错误：'+s.lastError):'';
const t=q('#toggle');t.textContent=s.running?'停止':'启动';t.className=s.running?'':'primary';t.disabled=busy;
}catch(e){q('#err').textContent='连接失败：'+e.message}}
async function reset(){if(busy)return;busy=true;q('#reset').disabled=true;
let note='';
try{const resp=await fetch('/observation/reset',{method:'POST'});
const b=await resp.json().catch(()=>({}));
if(!resp.ok){note=b.error||('HTTP '+resp.status)}
else{note='已重置 · 视频'+(b.cameraRestarted?'已回绕到 0 秒':'未回绕（解码器无 restart 能力）')}}
finally{busy=false;q('#reset').disabled=false;q('#err').textContent=note;setTimeout(poll,300)}}
async function toggle(){if(busy)return;busy=true;q('#toggle').disabled=true;
const r=await fetch('/observation/state',{cache:'no-store'}).then(x=>x.json()).catch(()=>({}));
const path=r.running?'/observation/stop':'/observation/start';
const resp=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:new URLSearchParams(location.search).get('sessionId')})});
if(!resp.ok){const b=await resp.json().catch(()=>({}));q('#err').textContent=b.error||('HTTP '+resp.status)}
busy=false;poll()}
q('#toggle').onclick=toggle;q('#reset').onclick=reset;poll();setInterval(poll,2000);
</script></body></html>`

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/observation',
    handler: async (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(PAGE)
    },
  }), 'observation-api: page route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/observation/state',
    handler: async (req, res) => {
      try {
        send(res, 200, service().status())
      } catch (error) {
        send(res, 503, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'observation-api: state route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/observation/start',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        send(res, 405, { error: 'POST only' })
        return
      }
      try {
        const body = await readBody(req)
        const result = await service().start(body?.sessionId)
        send(res, 200, result)
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'observation-api: start route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/observation/stop',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        send(res, 405, { error: 'POST only' })
        return
      }
      try {
        send(res, 200, service().stop())
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'observation-api: stop route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/observation/reset',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        send(res, 405, { error: 'POST only' })
        return
      }
      try {
        send(res, 200, service().reset())
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'observation-api: reset route')
}
