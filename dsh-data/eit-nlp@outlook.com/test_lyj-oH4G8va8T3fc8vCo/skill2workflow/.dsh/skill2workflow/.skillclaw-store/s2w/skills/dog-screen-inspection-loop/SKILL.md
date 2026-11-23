---
name: dog-screen-inspection-loop
description: "Run a robot-dog screen/panel inspection as a move→wait_arrived→capture loop, escalating vantage (front → closer → oblique-front) based on the capture's readable/reason fields, and only report DONE when a readable=true capture is actually logged. Use when asked to check a printer screen, status panel, or similar display for a condition (paper out, error, ready). NOT for: navigation-only tasks, non-visual sensor checks, or cases where a readable capture already exists."
category: general
---

# Dog Screen Inspection Loop

Inspect a physical screen/panel with the robot dog and report a condition (e.g. paper out) backed by an actual readable capture.

## Core loop (one vantage at a time)

```text
dog_move({body, target: <vantage>, goal: <why>})  -> job_id
dog_wait_arrived({job_id})                         -> must return arrived
dog_capture({target: <screen>, pose: <vantage>})   -> {readable, reason?, screen_text?}
```

Never call `dog_capture` before `dog_wait_arrived` confirms arrival for that move. Pair every move with its own wait and capture; do not batch moves.

## Vantage escalation ladder

Start at the nominal front vantage, then escalate based on the capture's `reason`:

| reason on readable=false | next vantage | goal text |
|---|---|---|
| text too small / illegible size | `<area>-front-closer` | "get closer so the screen text is larger" |
| glare / reflection on screen | `<area>-oblique-front` | "side-front vantage that can still see the screen" |
| still unreadable after both | stop and report failure | — |

Do not skip rungs: front → front-closer → oblique-front. Each rung must have its own move/wait/capture triple in the log.

## Evidence rule (hard requirement)

- A condition may only be reported if a `dog_capture` call in this session returned `readable=true` with the `screen_text` that supports it.
- If the last logged capture is `readable=false`, you have NOT finished — either run the next rung or report failure. Do not assert a vantage or reading that is not backed by a logged capture.
- Quote the supporting `screen_text` (e.g. `缺纸`) in the report.

## DONE report format

Emit exactly one line after the evidence rule is satisfied:

```text
DONE case=<case_id> paper_out=<true|false> vantage=<vantage_that_produced_readable_true>
```

On failure (no readable=true after all rungs):

```text
FAILED case=<case_id> reason=<last readable=false reason> vantages_tried=<comma-separated>
```

## Pitfalls

- Claiming `vantage=...` without a matching logged `dog_capture` for that pose is the most common error; verify the tool log before writing DONE.
- `readable=false` is not a failure of the task — it is the signal to escalate. Only stop escalating when a rung succeeds or the ladder is exhausted.
- Keep `target` (the screen) constant across captures; only `pose`/vantage changes.
