---
name: safety-interlock-case-runner
description: "Evaluate a safety-interlock case from case.json (id/measurement/command/max_limit/min_output/max_output) using an inclusive >= threshold with clamping fallback, computing via python3 -c and emitting a fixed two-line output plus DONE trailer. Use when asked to run, verify, or codify safety-interlock/clamping cases, especially boundary self-checks like measurement == max_limit. NOT for: general numeric scripting, non-interlock control logic, or tasks that require writing files."
category: general
---

# Safety Interlock Case Runner

Run a single safety-interlock case from `case.json` and emit a deterministic result. Treat this as a read-only evaluation: never write or modify files.

## Input schema (`case.json`)


{
  "id": "eq-100",
  "measurement": 100,
  "command": 40,
  "max_limit": 100,
  "min_output": 0,
  "max_output": 100
}


## Decision rule

1. If `measurement >= max_limit` (the equals sign counts as over-limit):
   - set `command = min_output`
   - set `safety_triggered = True`
2. Otherwise: clamp only — `command = max(min_output, min(max_output, command))`, `safety_triggered = False`.

Do not clamp the command after a safety trigger; the triggered branch forces `min_output`.

## Execution

- Read `./SKILL.md` (if present) and `./case.json` first.
- Compute with `python3 -c` — never do the arithmetic mentally.
- Do not invoke any write/edit tools.

bash
python3 -c "
import json
case = json.load(open('case.json'))
measurement = case['measurement']
command = case['command']
max_limit = case['max_limit']
min_output = case['min_output']
max_output = case['max_output']

safety_triggered = False
if measurement >= max_limit:
    command = min_output
    safety_triggered = True
command = max(min_output, min(max_output, command))
print('safety_triggered=' + str(safety_triggered).lower())
print('output=' + str(command))
"


## Required output

Exactly two result lines, then a trailer:


safety_triggered=<true|false>
output=<n>
DONE case=<id> safety=<true|false> output=<n>


Use lowercase booleans (`true`/`false`) in both the lines and the trailer.

## Boundary self-check

Case `eq-100` is the equality-boundary sample: `measurement=100`, `max_limit=100`, `command=40`, `min_output=0`, `max_output=100` must yield `safety_triggered=true` and `output=0` (NOT the clamped `40`). Verify this case whenever the threshold logic changes.

## Codifying the procedure

When asked to "solidify" or persist this as a reusable skill, actually create/update `SKILL.md` with the generalized rule above (schema, `>=` semantics, clamp fallback, output format, boundary sample) and confirm the final file contents — reading an existing SKILL.md alone does not satisfy the request.
