---
description: "DeepSeek Harness rows that call the skill2workflow Python CLI for compile and self-evolution."
kind: "package-group"
---

# skill2workflow/ — compile and self-evolution

English | [中文](README.zh.md)

## Summary

These rows call `python3 -m skill2workflow`. The base composition ships the row enabled and points `repoRoot` at `SKILL2WORKFLOW_ROOT`.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

## Packages

| Package | Role |
|---|---|
| [`skill2workflow/`](skill2workflow/README.md) | Model-facing s2w_* tools for compile and self-evolution |

## Related documentation

- [Skill subsystem reference](../../docs/subsystems/skills.md) — the Skill files these tools compile or keep.
- The Python CLI lives in https://github.com/eit-nlp-industry/skill2workflow.

## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This is a first-party overlay on lyj's dsh fork, not an upstream DeepSeek bundle.

</details>
