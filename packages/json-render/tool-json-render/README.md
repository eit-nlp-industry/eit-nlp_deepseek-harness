---
description: "Global render_ui tool that requests a json-render display or form from a running server."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-json-render

## Summary

Register `render_ui` on the host tool layer so every agent can request a json-render layout from the v0.2.0-rc.5 server. Display calls continue the turn. A successful form ends the turn. Failures return text after at most three attempts and do not carry the server error body.

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
    baseUrl: http://10.37.0.21:3001
    description: Call render_ui only for comparison tables.
```

`JSON_RENDER_BASE_URL` overrides an empty `baseUrl`. Each attempt times out after `timeoutMs` (default 60000). The tool tries three times. HTTP 400 is not retried.

The json-render server must already be running at v0.2.0-rc.5, the same release as the installed `@eit/json-render-*` packages. This package calls `POST /v1/render` with `format` `json-render-v1`, `user_query`, `business_data`, optional `prompt_mode` (`full` or `progressive`), and `context.locale` / `context.intent`. It does not send `mode`, `profile`, `catalog`, or `framework`. Omit `intent` for an ordinary display so the server uses base. `generic_filters` and `generic_pick_one` select the forms catalog. Listing `Image`, `ImageUpload`, `Tabs`, `MapPreview`, `SortableSequence`, `Collapsible`, or `CodeBlock` in `components` selects `rich_content` for the whole layout. A direct Generation SDK call uses `baseRenderProfile`, `formsRenderProfile`, or `richRenderProfile` for that same choice and does not reuse the HTTP fields. Image `src` stays the resource address from `business_data`. `ImageUpload` only names `uploadTarget`.

Display calls default to `answer_presentation: replace`: the interface must contain the complete answer. Use `supplement` when necessary explanations remain in the written answer. The model still writes a complete fallback, while the browser selects the visible answer from persisted result metadata. Forms always remain supplementary. Failed calls never declare a replacement.

<a id="model-experience"></a>
## Model Experience

### render_ui

#### What the model sees

The tool description is the configured `description`, or the default that names `render_ui`, `display`, `form`, `business_data`, `generic_filters`, `generic_pick_one`, `rich_content`, `components`, `Image`, and `ask_user_question`. Display and form both require `business_data` with the detailed facts. A successful result is one sentence, `界面已附上`, and does not include the payload. A failure is one sentence telling the model to continue in text or to supply the facts. The payload and the server profile are stored only as result metadata. Debug mode records `format`, `intent`, `prompt_mode`, error `code`, `requestId`, and safe diagnostics, and omits prompts, business data, secrets, and resource addresses.

#### Token effect

One tool schema is added for every agent that inherits `render_ui`. The model-facing result is a short sentence. The layout JSON is not copied into that sentence.

#### KV Cache effect

The description is fixed for the life of the mount. A result sentence extends the conversation without rewriting the prompt prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The server must be started separately at v0.2.0-rc.5. This tool does not launch it. An older server has no `rich_content` catalog, so Image and the other rich components fail generation.
- Form choices are `generic_filters` and `generic_pick_one`. Rich layouts use `rich_content`, which already includes base and form components.
- Programmatic tool calling receives the canonical result, including a successful payload, while native function calling receives only the rendered sentence.
