---
name: API Client
description: Wire a typed API client to a remote service, including retry and error handling.
emblem: AC
tags: [worker, typescript]
allowed-tools: []
---

# API Client

Build a typed client for a remote HTTP service.

- Define request/response types from the OpenAPI/JSON schema if available.
- Centralise auth, base URL, and timeouts in one place.
- Add retry with bounded backoff on idempotent verbs only.
- Surface errors as typed results, not thrown strings.
