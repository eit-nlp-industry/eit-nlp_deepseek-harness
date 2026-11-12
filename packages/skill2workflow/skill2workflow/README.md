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

The base bundle enables the row. The tools are in-process Cordis tools, same as the other plugins. Set `SKILL2WORKFLOW_ROOT` to a local skill2workflow checkout. The first call pip-installs that directory into `$DSH_HOME/s2w-cli/venv`. The plugin does not download from GitHub.

Put `.env` in the workspace or at `~/.skill2workflow/.env`. Fill in your own `LLM_API_KEY` and `N8N_*`.

## Model Experience

### Self-evolution tools

#### What the model sees

Seven tools. Report, decide, retrieve, and ingest do not call a model. Decide with `apply=true`, `s2w_compile`, `s2w_run_trajectory`, and `s2w_trace_to_skill` do.

#### Token effect

A tool result is a JSON string of the Python CLI stdout. Unused tools add zero tokens.

#### KV Cache effect

The row does not insert a standing prompt block. Only a later tool result changes the request suffix.

## Known Limitations and Deferred Work

The CLI is still Python. The plugin installs it into DSH_HOME on first use. This host needs `python3`. n8n stays in each user's `.env`.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The row lives next to Hindsight in `packages/bundle/base/cordis.patch.yml`. The Python CLI is the checkout at `SKILL2WORKFLOW_ROOT`.

</details>
