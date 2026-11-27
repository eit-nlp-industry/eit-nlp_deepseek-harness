---
description: "Map rendering protocols and the server-backed render_ui tool."
kind: "package-group"
---

# JSON rendering packages

English | [中文](README.zh.md)

| Package | Responsibility |
| --- | --- |
| [protocol](protocol/README.md) | Shared DSH map fields and location adapter identities |
| [tool-json-render](tool-json-render/README.md) | Generation requests, component completion checks, and host map assembly |

The [tool subsystem](../../docs/subsystems/tools.md) owns tool registration and execution. Browser rendering remains in [client/ui-json-render](../client/ui-json-render/README.md).
