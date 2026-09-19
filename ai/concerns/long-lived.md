---
title: Long-lived
description: Push on architecture analysis, failure modes, deployment safety, and migration cost for code that will live for years.
---

## DISCOVERY

### Reminders

- Who else depends on this surface today? Will they need to migrate?
- What is the rollback plan if this ships broken?

### Review Dimensions

- downstream impact
- rollback

## REFINEMENT

### Reminders

- Backwards-compat: which callers must keep working unchanged?
- Data shape: is this schema decision reversible?

### Review Dimensions

- compat
- schema reversibility

## PLANNING

### Reminders

- Prefer additive over replacing; deprecate before delete.
- Stage risky changes behind a flag if blast radius is wide.

### Review Dimensions

- additive design
- rollout staging

## EXECUTING

### Reminders

- Do not introduce new shared mutable state.
- If you touch a load-bearing module, document why when the reason is non-obvious.

### Review Dimensions

- coupling
- doc-debt

## VERIFICATION

### Reminders

- Run the migration on a copy of prod-shape data.
- Verify the rollback path actually rolls back.

### Review Dimensions

- migration proof
- rollback proof
