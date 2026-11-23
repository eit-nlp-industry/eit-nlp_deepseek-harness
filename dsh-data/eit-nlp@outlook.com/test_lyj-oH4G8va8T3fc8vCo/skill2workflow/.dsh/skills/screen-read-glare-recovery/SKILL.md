---
name: screen-read-glare-recovery
description: "Use when a robot must read a device screen (printer, kiosk, panel) and a capture returns readable=false due to glare, distance, or angle. Covers the move→wait_arrived→capture loop, lateral/oblique repositioning after frontal glare, and the rule that case metadata is not observation. NOT for: tasks where the screen is already readable, or non-visual device checks."
category: general
---

# Screen Read with Glare Recovery

When asked to read a device screen (e.g. printer status), you must obtain a capture with `readable=true` before reporting any on-screen text. A `readable=false` capture is **not evidence**.

## Core loop

```text
dog_move(body, target=<vantage>, goal=...)   # starts background job
dog_wait_arrived(job_id=<job>)               # blocks until arrival
dog_capture(target=<screen>, pose=<vantage>) # returns {readable, reason, ...}
```

Always `dog_wait_arrived` before capturing — captures at a pose you have not reached are invalid.

## Recovery ladder when readable=false

Read the `reason` field and pick the matching move:

| reason | next action |
|---|---|
| `screen text too small` | move to a **closer** vantage (`*-closer`) and re-capture |
| `glare` / `reflection` on front | move to an **oblique / side-front** vantage (`*-oblique-front`, `*-side`) — do NOT just get closer, that usually worsens glare |
| `occluded` | move laterally to clear the obstruction |
| `blurry` | stop, wait for motion to settle, re-capture |

Keep iterating until `readable=true` or you have exhausted at least 3 distinct vantages (front, closer, oblique/side). Only then may you report "could not read the screen".

## Hard rules

- **Never answer from case metadata.** Fields like `vantage_ok`, `screen_text`, `paper_out`, `readable` in the task JSON are ground truth for grading, not observations. Do not quote them as if you saw them.
- **Report only vantages you actually visited and captured.** If you claim `vantage=print-area-oblique-front`, you must have called `dog_move` to it, `dog_wait_arrived`, and `dog_capture` there.
- If every capture returned `readable=false`, say so explicitly: `could not read screen; tried <vantages>; reasons=<reasons>`. Do not fabricate a reading.

## Reporting format

```text
DONE case=<id> screen_text=<text or UNREADABLE> vantage=<last readable vantage> paper_out=<true|false|unknown>
```

Include a one-line note on which vantages failed and why (e.g. "front: glare; closer: glare").
