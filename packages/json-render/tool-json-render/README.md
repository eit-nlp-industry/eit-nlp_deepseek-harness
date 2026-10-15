---
description: "Global render_ui tool that requests a json-render display or form from a running server."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-json-render

## Summary

Register `render_ui` on the host tool layer so every agent can request a json-render layout. Display calls continue the turn. A successful form ends the turn. Failures return text after at most three attempts and do not carry the server error body.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin on the host, not inside one agent preset. Agents inherit the tool. A preset can remove it with `tools.restrict`. Change when the model calls it by editing `description`.

```yaml
- id: tool-json-render
  name: '@deepseek-ai/dsh-tool-json-render'
  config:
    baseUrl: http://127.0.0.1:3001
    description: Call render_ui only for comparison tables.
```

`JSON_RENDER_BASE_URL` overrides an empty `baseUrl`. Each attempt times out after `timeoutMs` (default 60000). The tool tries three times. HTTP 400 is not retried.

The json-render server must already be running. This package only calls `POST /v1/render`.

<a id="model-experience"></a>
## Model Experience

### render_ui

#### What the model sees

The tool description is the configured `description`, or the default that names `render_ui`, `display`, `form`, `business_data`, `generic_filters`, `generic_pick_one`, and `ask_user_question`. Display and form both require `business_data` with the detailed facts. A successful result is one sentence, `界面已附上`, and does not include the payload. A failure is one sentence telling the model to continue in text or to supply the facts. The payload is stored only as result metadata.

#### Token effect

One tool schema is added for every agent that inherits `render_ui`. The model-facing result is a short sentence. The layout JSON is not copied into that sentence.

#### KV Cache effect

The description is fixed for the life of the mount. A result sentence extends the conversation without rewriting the prompt prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The server must be started separately. This tool does not launch it.
- Form choices are limited to `generic_filters` and `generic_pick_one`.
- Programmatic tool calling receives the canonical result, including a successful payload, while native function calling receives only the rendered sentence.
