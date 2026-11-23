---
name: printer-screen-vantage-scan
description: "Procedure for inspecting a printer's status screen with a robot dog (dog_move / dog_wait_arrived / dog_capture), iterating candidate vantages until a capture is readable. Use when a case asks whether a printer is out of paper, jammed, or shows an error message. NOT for: general navigation, non-screen inspection, or cases where the target is not a printer display."
category: general
---

# Printer Screen Vantage Scan

Goal: read the printer's status screen and report what it actually says. The screen is small and reflective, so a single capture from the front is usually not enough.

## Core loop

For each candidate vantage in order, run exactly this sequence:

```text
dog_move({"body": "dog-01", "target": "<vantage>", "goal": "<why this vantage>"})
dog_wait_arrived({"job_id": "<job_id from dog_move>"})
dog_capture({"target": "printer-screen", "pose": "<vantage>"})
```

Only report a result after a `dog_capture` returns `readable: true`. Never infer screen text from the case record, `screen_text`, `paper_out`, or `vantage_ok` fields — those are ground truth for grading, not observations.

## Vantage order and failure handling

1. `print-area-front` — baseline. If `readable: false` with reason `screen text too small`, move closer.
2. `print-area-front-closer` — fixes small text. If `readable: false` with reason `glare` (reflection on the front of the screen), the front is unusable; switch to an oblique angle.
3. `print-area-oblique-front` — side-front angle that avoids front glare while still seeing the screen. This is the usual successful vantage.

If a vantage fails, record the observed reason and proceed to the next candidate. Do not stop after two failures; do not claim a vantage succeeded unless you captured from it.

## Reporting

Report only what the readable capture showed, plus the vantage that worked:

```text
这台打印机显示<screen text>。有效观察位是 <vantage>（<brief reason earlier vantages failed>）。
DONE case=<id> paper_out=<true|false> vantage=<vantage>
```

If no candidate vantage yields `readable: true`, say so explicitly and list the failure reasons per vantage instead of guessing the screen content.
