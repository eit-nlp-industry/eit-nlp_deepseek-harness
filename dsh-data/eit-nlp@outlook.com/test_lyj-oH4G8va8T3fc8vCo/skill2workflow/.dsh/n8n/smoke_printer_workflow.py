# -*- coding: utf-8 -*-
"""Smoke the repaired printer-screen workflow on n8n and assert real outputs.

Run from the workspace root: python3 .dsh/n8n/smoke_printer_workflow.py
"""
import json, re, sys
from pathlib import Path
sys.path.insert(0, "/opt/skill2workflow")
from skill2workflow import config
from skill2workflow.n8n_client import N8nClient
from skill2workflow.cli import executed_node_names

ROOT = Path(__file__).resolve().parents[2]
WF = ROOT / ".dsh/skills/printer-screen-vantage-scan/workflow.json"
OUT = ROOT / ".dsh/n8n/smoke_after_fix.json"

# n15 must report the oblique result, not an undefined `readable`.
wf = json.loads(WF.read_text())
nodes = {n["name"]: n for n in wf["nodes"]}
for item in nodes["Report no readable vantage"]["parameters"]["assignments"]["assignments"]:
    if item["name"] == "readable":
        item["value"] = "={{ $json.readable_oblique }}"
WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2) + "\n")
(ROOT / ".dsh/n8n/printer-screen-vantage-scan.C.workflow.json").write_text(
    json.dumps(wf, ensure_ascii=False, indent=2) + "\n")

CASES = [
    {"id": "paper-out-1", "job_id": "job-move-3", "readable_front": False,
     "readable_front_closer": False, "readable_oblique": True, "screen_text": "缺纸",
     "paper_out": True, "reason": "glare on the front of the screen"},
    {"id": "paper-out-none", "job_id": "job-move-3", "readable_front": False,
     "readable_front_closer": False, "readable_oblique": False, "screen_text": "",
     "paper_out": False, "reason": "glare on the front of the screen"},
]
EXPECT = [
    ("Report readable result",
     "这台打印机显示缺纸。有效观察位是 print-area-oblique-front。\n"
     "DONE case=paper-out-1 paper_out=true vantage=print-area-oblique-front"),
    ("Report no readable vantage",
     "没有可读的观察位；最后一个观察位失败原因：glare on the front of the screen"),
]


def decode(execution):
    arr = json.loads(execution["data"]) if isinstance(execution.get("data"), str) else execution.get("data")
    def res(v, depth=0):
        if depth > 40:
            return v
        if isinstance(v, dict):
            return {k: res(x, depth + 1) for k, x in v.items()}
        if isinstance(v, list):
            return [res(x, depth + 1) for x in v]
        if isinstance(v, str) and re.fullmatch(r"\d+", v) and int(v) < len(arr):
            return res(arr[int(v)], depth + 1)
        return v
    return res(arr[0])


def sink_output(execution, node_name):
    run = (decode(execution).get("resultData") or {}).get("runData") or {}
    runs = run.get(node_name) or []
    if not runs:
        return None
    main = ((runs[-1].get("data") or {}).get("main") or [[]])[0]
    return main[0].get("json") if main else None


config.load_dotenv()
client = N8nClient(config.env("N8N_BASE_URL"), config.env("N8N_EMAIL"), config.env("N8N_PASSWORD"))
client.login()
_, folder = client.ensure_folder(config.dsh_n8n_folder_name())
saved, updated = client.upsert_workflow(wf, parent_folder_id=folder)
wf_id = str(saved["id"])
known = set(nodes)

results = []
ok = True
for case, (sink_name, expect_report) in zip(CASES, EXPECT):
    pinned = dict(wf)
    pinned["pinData"] = {"Start Case": [{"json": case}]}
    client.update_workflow(wf_id, pinned)
    eid = client.run(wf_id, "Start Case")
    ex = client.wait_execution(eid)
    ex = client.get_execution(eid)
    out = sink_output(ex, sink_name)
    ran = executed_node_names(ex, known)
    other = "Report no readable vantage" if sink_name == "Report readable result" else "Report readable result"
    row = {
        "case_id": case["id"],
        "execution_id": eid,
        "status": ex.get("status"),
        "sink": sink_name if sink_name in ran else None,
        "other_sink_ran": other in ran,
        "report": (out or {}).get("report"),
        "expected_report": expect_report,
    }
    row["ok"] = (
        row["status"] == "success"
        and row["sink"] == sink_name
        and not row["other_sink_ran"]
        and row["report"] == expect_report
    )
    ok = ok and row["ok"]
    results.append(row)
    print(json.dumps(row, ensure_ascii=False))

OUT.write_text(json.dumps({"workflow_id": wf_id, "updated": updated, "runs": results}, ensure_ascii=False, indent=2) + "\n")
print("ALL_GREEN:", ok, "workflow_id:", wf_id)
raise SystemExit(0 if ok else 1)
