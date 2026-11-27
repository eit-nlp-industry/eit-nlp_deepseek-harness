---
kind: upgrade-guide
description: "Explicit MapPreview requests require validated places and routes, real initial coordinates for tracking, and a returned map component."
---

# Supply validated map facts

English | [中文](guide.zh.md)

## Change

For explicit `components: ["MapPreview"]` requests, `render_ui` rejects live tracking without valid initial coordinates before contacting the render server. A self-referential `business_data.tracking.position: {$state: '/tracking/position'}` is not a coordinate. The host assembles map tracking from the supplied facts and fixes the rendered position binding to `/tracking/position`. HTTP 200 responses missing an explicitly requested MapPreview now return a generation validation failure instead of a successful display.

## Migration

Static and live requests must supply nonempty `business_data.places: [{id, label, x, y}]` with unique IDs and coordinates in 0–100. Supply `route` as an ordered array of existing place IDs. The host also accepts `points`/`name` and `route.pointOrder`, but rejects conflicting aliases or incomplete facts before HTTP. It retains changed source structures in business_data.map_source for other components and rejects a conflicting existing field. It replaces returned map data with these validated facts. A degraded response preserves bounded service validation details and remains a failure.

1. Update integrations to supply `business_data.tracking: {source, trackId, position: {x, y, status?}}`, with provider-supplied coordinates in 0–100. Use `robot-live` with the actual track ID, or `robot-demo` with `campus-route` for the local demo. A supplied top-level `business_data.position` is also accepted as the initial coordinate.
2. When no initial position is available, omit `tracking`, request a static route, and explain that the live position is unavailable. Do not invent coordinates or replace them with a binding expression.
3. Declare `components: ["MapPreview"]` to enable map handling; data or wording alone do not enable it. Other components keep their original acceptance rules. Handle `ok: false` even for an HTTP 200 render response; do not claim that a text substitution fulfilled a map request. Inspect the returned validation issues when correcting a request.
4. Verify that a live response contains `MapPreview.props.position: {$state: '/tracking/position'}`, the supplied tracking identifiers, and real coordinates at `state.initial.tracking.position`. See the [package reference](../../../../packages/json-render/tool-json-render/README.md) for structured server requirements and deployment.
