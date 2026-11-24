---
description: "Global render_ui tool that requests a json-render display or form from a running server."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-json-render

## Summary

Register `render_ui` on the host tool layer so every agent can request a json-render layout from the v0.2.7 server. Display calls continue the turn. Display requests ask for user-relevant content; raw fields, coordinates, runtime parameters, and detail tables are shown only when the user asks for them. Component data remains available for rendering. A successful form ends the turn. Form requests require a visible enabled submit button. After generation, the host preserves an existing reachable form.submit button or appends one with submit_label (default 提交). Set submit_button=false only when the user explicitly requests no submit action; it disables host insertion and instructs the renderer to omit the default button. These two host options are not sent as server API fields. Failures return text after at most three attempts. Exhausted generation validation stops immediately and returns filtered diagnostics to the model.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

List Chart in components to select rich_content for bar, line, or donut charts. Chart requires labels and named series whose values match the label count.

Mount the plugin on the host, not inside one agent preset. Agents inherit the tool. A preset can remove it with `tools.restrict`. Change when the model calls it by editing `description`.

```yaml
- id: tool-json-render
  name: '@deepseek-ai/dsh-tool-json-render'
  config:
    baseUrl: http://10.37.0.21:3001
    description: Call render_ui only for comparison tables.
```

`JSON_RENDER_BASE_URL` overrides an empty `baseUrl`. Each attempt times out after `timeoutMs` (default 60000). The tool tries three times. HTTP 400 is not retried. A generation failure such as `MODEL_OUTPUT_INVALID` stops after that response. An image GET 401, 403, or 404 is a separate browser request and does not call the render server again.

Set `mediaRoot` to an absolute directory, or set `JSON_RENDER_MEDIA_ROOT` when `mediaRoot` is empty. The directory holds `index.json` and the image files it names. Each row has `id`, `file`, and `alt`, and may have `caption` and `owner`. `file` is a relative path inside the directory. The tool reads that catalog only for a call whose `business_data.image` has `assetId`, `id`, or `src`, then sends `image.src`, `image.alt`, and `image.caption`. `src` is `/api/media/<id>/content` with the id copied unchanged. Disk paths, tokens, `component`, and `type` are not sent. A row with `owner` is visible only when it equals `mediaOwner` or `JSON_RENDER_MEDIA_OWNER`. A row without `owner` is shared by the authenticated operator. An unknown image is rejected before any render request.

When `mediaRoot` is set and the Web server is present, the plugin registers `GET /api/media/<id>/content` on the page origin. The connection service applies the same login cookie and Host/Origin checks as other `/api` routes before the file is read. The response is the image bytes and an image `Content-Type`, or a short plain-text status. PNG, JPEG, GIF, and WebP are accepted after the file extension and the leading bytes agree. The handler resolves the real path, refuses directory traversal and links that leave the directory, and does not accept a path from the query string. `/api/file` remains a separate authenticated file route and is not an Image `src`. A deployment that already proxies `/api` to this host covers the media path. A deployment that serves the page from another origin must proxy `GET /api/media/` to the same host so the browser can send the login cookie. Do not put a bearer token in the URL.

The json-render server must already be running at v0.2.7, the same release as the installed `@eit/json-render-*` packages. This package calls `POST /v1/render` with `format` `json-render-v1`, `user_query`, `business_data`, optional `prompt_mode` (`full` or `progressive`), and `context.locale` / `context.intent`. It does not send `mode`, `profile`, `catalog`, or `framework`. Omit `intent` for an ordinary display so the server uses base. `generic_filters` and `generic_pick_one` select the forms catalog. Listing `Image`, `ImageUpload`, `Tabs`, `MapPreview`, `SortableSequence`, `Collapsible`, `CodeBlock`, or `Workflow` in `components` selects `rich_content` for the whole layout and includes those requested component names in `user_query`. A direct Generation SDK call uses `baseRenderProfile`, `formsRenderProfile`, or `richRenderProfile` for that same choice and does not reuse the HTTP fields. An image call sends `context.intent` `rich_content` and `context.locale` `zh-CN`. `image.src` is the catalog path already stored in `business_data`, copied without a domain or encoding. `ImageUpload` only names `uploadTarget`.

Display calls default to `answer_presentation: replace`: the interface must contain the complete answer. Use `supplement` when necessary explanations remain in the written answer. The model still writes a complete fallback, while the browser selects the visible answer from persisted result metadata. Forms always remain supplementary. Failed calls never declare a replacement.

<a id="model-experience"></a>
## Model Experience

### render_ui

#### What the model sees

The tool description is the configured `description`, or the default that names `render_ui`, `display`, `form`, `business_data`, `generic_filters`, `generic_pick_one`, `rich_content`, `components`, `Image`, `assetId`, and `ask_user_question`. Display and form both require `business_data` with the detailed facts. For an image the model sets `business_data.image.assetId` and does not invent a URL. A successful result is one sentence, `界面已附上`, and does not include the payload. Generation validation failures preserve the error code, requestId, and filtered validation paths and reasons for the model. The model may make one corrected call or continue in text; it must not repeat the same request or expose diagnostic JSON to the user. Other failures tell the model to continue in text or supply the facts. The payload and the server profile are stored only as result metadata. Debug mode records `format`, `intent`, `prompt_mode`, error `code`, `requestId`, and safe diagnostics, and omits prompts, business data, secrets, and resource addresses.

#### Token effect

One tool schema is added for every agent that inherits `render_ui`. The model-facing result is a short sentence. The layout JSON is not copied into that sentence.

#### KV Cache effect

The description is fixed for the life of the mount. A result sentence extends the conversation without rewriting the prompt prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The server must be started separately at v0.2.7. This tool does not launch it. An older server has no `rich_content` catalog, so Image and the other rich components fail generation.
- The image route is unmounted until `mediaRoot` or `JSON_RENDER_MEDIA_ROOT` names an absolute directory. The page and the API share one origin in the shipped Web profile. A split frontend must proxy `GET /api/media/` with the login cookie. Image load failures stay in the browser.
- Form choices are `generic_filters` and `generic_pick_one`. Rich layouts use `rich_content`, which already includes base and form components.
- Programmatic tool calling receives the canonical result, including a successful payload, while native function calling receives only the rendered sentence.
