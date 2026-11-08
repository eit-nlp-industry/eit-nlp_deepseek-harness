---
description: "Base-bundle row that exposes skill2workflow compile and self-evolution as DeepSeek Harness tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill2workflow

English | [中文](README.zh.md)

## Summary

This package adds one composition row. The Agent can call `s2w_evolve_report`, `s2w_evolve_decide`, `s2w_evolve_retrieve`, `s2w_evolve_ingest`, `s2w_run_trajectory`, `s2w_trace_to_skill`, and `s2w_compile`. Default is judge only. Compile, live runs, and trace distillation wait until the model sets `apply`, `use_fixture`, `case_id`, or `trajectory`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The base bundle enables the row. **The npm package is only JS glue** (it spawns `python3 -m skill2workflow`). Clone the Python repo on each machine:

```bash
git clone git@github.com:eit-nlp-industry/skill2workflow.git
export SKILL2WORKFLOW_ROOT=/path/on/this/machine/skill2workflow
```

```yaml
- id: skill2workflow
  name: '@deepseek-ai/dsh-skill2workflow'
  disabled: false
  config:
    repoRoot: !!js process.env.SKILL2WORKFLOW_ROOT || ''
```

If unset, tools return `SKILL2WORKFLOW_ROOT is empty`. That directory must be able to run `python3 -m skill2workflow`. Each person uses their own n8n (`N8N_BASE_URL` in `.env`).

## Model Experience

### Self-evolution tools

#### What the model sees

Seven tools. Report, decide, retrieve, and ingest do not call a model. Decide with `apply=true`, `s2w_compile`, `s2w_run_trajectory`, and `s2w_trace_to_skill` do.

#### Token effect

A tool result is a JSON string of the Python CLI stdout. Unused tools add zero tokens.

#### KV Cache effect

The row does not insert a standing prompt block. Only a later tool result changes the request suffix.

## Known Limitations and Deferred Work

The Python repo is not inside this package. n8n's container must mount or copy it, or the tools return `SKILL2WORKFLOW_ROOT is empty`.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The row lives next to Hindsight in `packages/bundle/base/cordis.patch.yml`.

</details>
