---
description: "Browser row that renders a render_ui payload and sends form, workflow, and route-order confirmations back to the session."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-json-render

English | [中文](README.zh.md)

## Summary

Retain every successful `render_ui` result in a turn. Multiple results appear in arrival order below the written answer; only a sole result may replace prose. Updates to the same call replace its card in place. Failed calls leave successful cards intact. Stable call keys preserve existing form state and live map connections when another card is appended. The tool row stays a short status. A form submit, workflow save, or applied route order is queued as the next user message. Form submissions use the form title and field labels with readable values rather than raw JSON; empty fields remain visible.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Add the package to the Web client composition. A sole successful display declared with `answer_presentation: replace` replaces a completed closing response containing one text block and optional reasoning. When no usable successful card exists, the written answer stays visible. Rendering exceptions restore the original Markdown with its links and controls. The written answer remains in the Session for copying and export. Multiple results, supplementary displays, forms, historical results without an explicit declaration, and responses with other block layouts render under the prose. The tool row only reports status.

Base and forms results use the stable Ant Design registry. A rich profile diagnostic uses the public experimental registry, which includes Image, ImageUpload, Workflow, and Chart. Chart selects the rich registry even without a server profile diagnostic. The chart engine uses the installed ECharts official prebuilt ESM distribution. This plugin bundles its chart engine into client.js because the Client loader does not preload synchronous shared chunks. Workflow supports local editing and undo/redo. workflow.save queues a Chinese outline of the edited workflow and its parameters and asks the agent to render an updated editable Workflow in the next reply. The Chat bubble shows only the submission receipt. route.order.apply queues the submitted id order with the full items from the original payload or that call's business data. workflow.change, workflow.select, and route.order.change do not send. A save or apply already in flight ignores another click; failure leaves the edit in place for a retry. workflow.execute is not connected, and edits are not persisted after reload. Upload targets come from host adapters; the payload only names `uploadTarget`. A Vue host uses the Vue adapter from the same v0.2.9 release instead of these React components. The renderer maps Ant Design CSS variables to the host's semantic theme tokens. Payloads containing Image or Workflow elements have no outer background, border, or padding. Cards and bordered Sections whose sole content child is an Image also omit their frame and horizontal padding, retaining their headings. Inline images share a borderless 640 × 360 frame that scales down with the container at 16:9; images fit fully without cropping or stretching, and failed loads retain the same frame. The preview close button displays a cross icon and retains its accessible text name. Other payloads have a rounded, elevated surface; a root Card or bordered Section shares it without a second frame. Immediate Cards and bordered Sections in a TabContent also omit their frame. Within tabs, grids mixing direct Text children with Cards or bordered Sections use one column in payload order; card-only grids retain their columns. Cards, tables, metrics, steps, notices, and form controls follow the host's light/dark palette and font settings. Form labels sit above their controls; fields retain their natural height, and card content has explicit gaps. Dropdowns stay inside the themed surface, and wide tables scroll independently. Grids stack on narrow screens; reduced-motion preferences disable local animation. Styling is local to this renderer and requires no changes to stored payloads or the render server.

Live MapPreview requires json-render v0.2.9, tracking.source robot-live, a nonempty tracking.trackId, and position bound to /tracking/position. Set the public build variable DSH_CLIENT_MAP_LOCATION_URL to a same-origin SSE endpoint (default /api/location), then rebuild the client. The host must serve or proxy that route and emit position events with trackId, an increasing safe-integer seq, x/y in 0–100, status idle/moving/arrived, and optional heading in [0, 360). Invalid or stale frames are ignored. Each message/map element owns its connection, which outlives text streaming and closes after applying arrived or on track change, map removal, or unmount. Frames update the existing panel store without changing its payload or key. All maps using /tracking/position in one panel share that position. The endpoint is host configuration and is never read from model data.

For a `form.submit` carrying `payload.form_action`, the next user message includes its `intent` and `label` together with the current `payload.form` values. Reset, skip, and cancel are requests for the agent to handle the current draft, not local mutations or evidence that a business operation succeeded. The paired tool package builds the declared action Buttons; horizontal button rows wrap on narrow screens. Missing or incomplete action metadata is not inferred from the label: incomplete declared metadata is rejected with the edit retained, while older submissions without metadata keep their existing behavior. Sends in flight ignore further clicks, and a failed send retains the draft for retry.

Horizontal form action rows share the full field width, distribute buttons evenly, and wrap when space is insufficient. The main submit, submit-and-add, or save action uses the primary style; other actions use outlined buttons.

Submission event IDs use the shared Web Crypto random-byte UUID implementation, including on HTTP intranet pages without crypto.randomUUID. Element event failures show localized feedback inside the card; synchronous and asynchronous submission failures release the send lock and retain the draft for retry. A submission receipt only confirms that the message was queued, not that a business operation completed.

Map paths, source identifiers, and coordinate decoding come from [json-render/protocol](../../json-render/protocol/README.md), shared with the rendering tool. This pure protocol is inlined into the browser bundle and does not require a client module-table registration.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the host `render_ui` tool. Confirmed forms, workflows, and route orders are queued as the next user message and are not system instructions.

#### KV Cache effect

The row only reads a recorded tool result and does not change the prompt prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Knowledge-base business components are not generated by the current server. Relative Image `src` uses `/api/media/<asset id>/content` on the page origin. The browser loads it with the login cookie and does not send Authorization. A failed image request does not call the render server again.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context</summary>

None.

</details>
