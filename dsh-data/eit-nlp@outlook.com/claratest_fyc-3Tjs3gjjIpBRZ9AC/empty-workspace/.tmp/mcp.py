import json, urllib.request, uuid, sys

BASE="http://10.37.0.21:18085/mcp/a7620aee-4f60-49ba-83e8-37028ca87ee0"
TOKEN="mcp_Ze2MEn_Wd11pFE6xy2rpe7BCxye8KZloRqdAhMHfimY"
SID=None

def post(payload, notify=False):
    global SID
    data=json.dumps(payload).encode()
    headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream","Authorization":"Bearer "+TOKEN}
    if SID: headers["Mcp-Session-Id"]=SID
    req=urllib.request.Request(BASE,data=data,headers=headers,method="POST")
    try:
        r=urllib.request.urlopen(req,timeout=60)
    except urllib.error.HTTPError as e:
        print("HTTPERR",e.code,e.read()[:500]); return None
    sid=r.headers.get("Mcp-Session-Id") or r.headers.get("mcp-session-id")
    if sid: SID=sid
    body=r.read().decode("utf-8","replace")
    if notify: return body
    ctype=r.headers.get("Content-Type","")
    if "text/event-stream" in ctype:
        # parse SSE
        msgs=[]
        for line in body.splitlines():
            if line.startswith("data:"):
                msgs.append(line[5:].strip())
        for m in msgs:
            try:
                obj=json.loads(m)
                if obj.get("id")==payload.get("id"): return obj
            except: pass
        return msgs[-1] if msgs else body
    return json.loads(body) if body.strip() else None

init={"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"dsh","version":"1.0"}}}
r=post(init); print("INIT",json.dumps(r,ensure_ascii=False)[:500])
post({"jsonrpc":"2.0","method":"notifications/initialized"},notify=True)
r=post({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}})
tools=(r or {}).get("result",{}).get("tools",[])
for t in tools:
    print("TOOL",t.get("name"),"-",(t.get("description") or "")[:150])
    print("   schema:",json.dumps(t.get("inputSchema",{}),ensure_ascii=False)[:300])
