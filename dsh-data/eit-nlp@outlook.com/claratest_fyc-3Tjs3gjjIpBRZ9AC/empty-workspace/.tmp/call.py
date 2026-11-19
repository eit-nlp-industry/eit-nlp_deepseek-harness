import json, urllib.request, sys
BASE="http://10.37.0.21:18085/mcp/a7620aee-4f60-49ba-83e8-37028ca87ee0"
TOKEN="mcp_Ze2MEn_Wd11pFE6xy2rpe7BCxye8KZloRqdAhMHfimY"
SID=None
def rpc(payload, notify=False, timeout=180):
    global SID
    headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream","Authorization":"Bearer "+TOKEN}
    if SID: headers["Mcp-Session-Id"]=SID
    req=urllib.request.Request(BASE,data=json.dumps(payload).encode(),headers=headers,method="POST")
    try: r=urllib.request.urlopen(req,timeout=timeout)
    except urllib.error.HTTPError as e:
        print("HTTPERR",e.code,e.read()[:800]); return None
    sid=r.headers.get("Mcp-Session-Id") or r.headers.get("mcp-session-id")
    if sid: SID=sid
    body=r.read().decode("utf-8","replace")
    if notify: return body
    if "text/event-stream" in r.headers.get("Content-Type",""):
        for line in body.splitlines():
            if line.startswith("data:"):
                try:
                    obj=json.loads(line[5:].strip())
                    if obj.get("id")==payload.get("id"): return obj
                except: pass
        return body
    return json.loads(body) if body.strip() else None

def init():
    rpc({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"dsh","version":"1.0"}}})
    rpc({"jsonrpc":"2.0","method":"notifications/initialized"},notify=True)

def call(name,args):
    r=rpc({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":name,"arguments":args}})
    if not r: return None
    if "error" in r: print("ERR",json.dumps(r["error"],ensure_ascii=False)[:800]); return None
    res=r.get("result",{})
    parts=[]
    for c in res.get("content",[]):
        if c.get("type")=="text": parts.append(c.get("text",""))
    txt="\n".join(parts)
    return txt

if __name__=="__main__":
    init()
    name=sys.argv[1]; args=json.loads(sys.argv[2]) if len(sys.argv)>2 else {}
    print(call(name,args))
