---
name: Unit Tests
description: Generate or update unit tests so new behaviour is covered and regressions are guarded.
emblem: UT
tags: [worker, jest]
allowed-tools: []
---

# Unit Tests

Add or extend unit tests so every new branch of behaviour is covered.

- Match the existing test style (Jest, Vitest, pytest, ...).
- Cover the happy path, the error path, and at least one edge case.
- Prefer fast, deterministic tests over integration heuristics.
- Use existing fixtures and helpers; do not introduce parallel infrastructure.

Run the suite locally and report the test count delta.
