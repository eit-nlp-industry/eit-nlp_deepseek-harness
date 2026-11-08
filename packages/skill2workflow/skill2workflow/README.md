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

The base bundle enables the row. The npm package is only JS: when the model calls a tool, this host runs `python3 -m skill2workflow`. Install the CLI with pip. Do not export another machine's path:

```bash
pip install 'git+https://github.com/eit-nlp-industry/skill2workflow.git'
python3 -c "import pathlib, shutil, skill2workflow; shutil.copy(pathlib.Path(skill2workflow.__file__).with_name('env.example'), '.env')"
# Fill in your own LLM_API_KEY and N8N_* values.
```

Put `.env` in the workspace, or at `~/.skill2workflow/.env`. Each person uses their own n8n. Contributors editing a git checkout may set `SKILL2WORKFLOW_ROOT`; nobody else should.

## Model Experience

### Self-evolution tools

#### What the model sees

Seven tools. Report, decide, retrieve, and ingest do not call a model. Decide with `apply=true`, `s2w_compile`, `s2w_run_trajectory`, and `s2w_trace_to_skill` do.

#### Token effect

A tool result is a JSON string of the Python CLI stdout. Unused tools add zero tokens.

#### KV Cache effect

The row does not insert a standing prompt block. Only a later tool result changes the request suffix.

## Known Limitations and Deferred Work

Python is not inside the npm package. If this python cannot import `skill2workflow`, the tool result tells you to pip-install. n8n stays in each user's `.env`.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The row lives next to Hindsight in `packages/bundle/base/cordis.patch.yml`.

</details>
