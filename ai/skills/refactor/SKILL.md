---
name: Refactor
description: Rework an existing module for clarity, reuse, or performance without changing behaviour.
emblem: RF
tags: [worker]
allowed-tools: []
---

# Refactor

Improve internal structure without changing observable behaviour.

- Make sure tests cover the surface before you start; add characterization tests if not.
- Move in small, reviewable steps; each commit should keep the suite green.
- Prefer extraction and renaming over rewrites.
- Stop when the original goal is met; do not gold-plate adjacent code.
