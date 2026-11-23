# -*- coding: utf-8 -*-
"""Repair + smoke the dog-screen-inspection-loop workflow on n8n.

The compiler emitted all three IF nodes reading a single `$json.readable`, so the
front -> front-closer -> oblique-front ladder could never actually escalate: one
input value routed straight to DONE or straight to FAILED. Each Capture node now
stamps `readable` from its own per-vantage field (readable_front /
readable_front_closer / readable_oblique), matching the real move/wait/capture loop.

Run from the workspace root: python3 .dsh/n8n/smoke_dog_screen_workflow.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, "/opt/skill2workflow")
from skill2workflow import config
from skill2workflow.cli import executed_node_names
from skill2workflow.n8n_client import N8nClient

ROOT = Path(__file__).resolve().parents[2]
WF = ROOT / ".dsh/skills/dog-screen-inspection-loop/workflow.json"
OUT = ROOT / ".dsh/n8n/smoke_after_fix_dog.json"

PER_VANTAGE = {
    "Capture Front": "readable_front",
    "Capture Front-Closer": "readable_front_closer",
    "Capture Oblique-Front": "readable_oblique",
}

wf = json.loads(WF.read_text(encoding="utf-8"))
nodes = {n["name"]: n for n in wf["nodes"]}

for node_name, field in PER_VANTAGE.items():
    assignments = nodes[node_name]["parameters"]["assignments"]["assignments"]
    if not any(a["name"] == "readable" for a in assignments):
        assignments.append(
            {
                "id": f"a-readable-{field.replace('_', '-')}",
                "name": "readable",
                "value": f"={{{{ $json.{field} }}}}",
                "type": "boolean",
            }
        )

form_fields = nodes["Start Inspection"]["parameters"]["formFields"]["values"]
form_fields = [f for f in form_fields if f["fieldLabel"] != "readable"]
for field in ("readable_front", "readable_front_closer", "readable_oblique"):
    form_fields.append(
        {
            "fieldLabel": field,
            "fieldType": "checkbox",
            "requiredField": True,
            "defaultValue": "false",
        }
    )
nodes["Start Inspection"]["parameters"]["formFields"]["values"] = form_fields

WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(ROOT / ".dsh/n8n/dog-screen-inspection-loop.C.workflow.json").write_text(
    json.dumps(wf, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)

BASE = {
    "area_id": "print-area",
    "body": "dog-01",
    "job_id": "job-move-1",
    "target": "printer-screen",
    "pose": "print-area-front",
    "reason": "glare on the front of the screen",
}

CASES = [
    (
        {**BASE, "case_id": "paper-out-1", "readable_front": False,
         "readable_front_closer": False, "readable_oblique": True,
         "screen_text": "缺纸", "paper_out": True},
        "Report DONE",
        "DONE case=paper-out-1 paper_out=true vantage=print-area-oblique-front",
    ),
    (
        {**BASE, "case_id": "paper-out-front", "readable_front": True,
         "readable_front_closer": False, "readable_oblique": False,
         "screen_text": "缺纸", "paper_out": True, "reason": "none"},
        "Report DONE",
        "DONE case=paper-out-front paper_out=true vantage=print-area-front",
    ),
    (
        {**BASE, "case_id": "paper-out-none", "readable_front": False,
         "readable_front_closer": False, "readable_oblique": False,
         "screen_text": "", "paper_out": False},
        "Report FAILED",
        "FAILED case=paper-out-none reason=glare on the front of the screen "
        "vantages_tried=print-area-front,print-area-front-closer,print-area-oblique-front",
    ),
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
for case, sink_name, expect_report in CASES:
    pinned = dict(wf)
    pinned["pinData"] = {"Start Inspection": [{"json": case}]}
    client.update_workflow(wf_id, pinned)
    eid = client.run(wf_id, "Start Inspection")
    client.wait_execution(eid)
    ex = client.get_execution(eid)
    out = sink_output(ex, sink_name)
    ran = executed_node_names(ex, known)
    other = "Report FAILED" if sink_name == "Report DONE" else "Report DONE"
    row = {
        "case_id": case["case_id"],
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
        and (row["report"] or "").strip() == expect_report
    )
    ok = ok and row["ok"]
    results.append(row)
    print(json.dumps(row, ensure_ascii=False))

OUT.write_text(
    json.dumps({"workflow_id": wf_id, "updated": updated, "runs": results}, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print("ALL_GREEN:", ok, "workflow_id:", wf_id)
raise SystemExit(0 if ok else 1)
