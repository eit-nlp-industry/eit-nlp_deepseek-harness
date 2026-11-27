---
description: "Shared map position decoding and location adapter identities for DSH rendering tools and clients."
kind: "package-library"
---

# @deepseek-ai/dsh-json-render-protocol

English | [中文](README.zh.md)

## Summary

The rendering tool and browser client share map position paths, coordinate limits, movement states, and location adapter identities through this package. `parseMapPosition` decodes real coordinates without inventing an initial position. The package has no framework, network, or model dependency.

## Table of Contents

- [Use this package](#use-this-package)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Import `MAP_POSITION_PATH` when assembling or subscribing to a live map. Decode provider coordinates with `parseMapPosition`; it returns canonical fields or `undefined` for an invalid coordinate, status, heading, or progress value. Unrelated stream fields are discarded. The tool owns request rejection; the browser owns frame ordering and subscription cleanup.

The live and campus demo source identifiers name existing DSH adapters. Other render hosts supply their own path and tracking identifiers through eit-json-render's structured map binding request; that SDK does not import this package. See the [rendering tool](../tool-json-render/README.md) for requests and failure handling.

## Known Limitations and Deferred Work

- The current DSH subscription adapter uses one shared position path per rendered payload. Independent position stores require extending the consumer protocol together.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
