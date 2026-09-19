---
title: Well-engineered
description: Push the agent on test strategy, performance, observability, threat modeling, and error quality at the right phase.
---

## DISCOVERY

### Reminders

- What can fail? List the failure modes you want callers to handle.
- What is the perf budget for this path?

### Review Dimensions

- failure modes
- perf budget
- trust boundaries

## REFINEMENT

### Reminders

- Each acceptance criterion should be machine-checkable.
- Error responses are part of the spec, not an afterthought.

### Review Dimensions

- acceptance criteria specificity
- error contract

## PLANNING

### Reminders

- Write the test list before the code list.
- Identify what must be observable in production (logs, metrics).

### Review Dimensions

- test strategy
- observability

## EXECUTING

### Reminders

- Validate at trust boundaries; trust internal callers.
- Prefer pure functions for the testable core.

### Review Dimensions

- input validation
- purity of core

## VERIFICATION

### Reminders

- Run the full suite, not just the new tests.
- If a flake appears, do not retry: investigate.

### Review Dimensions

- test pass evidence
- no skipped/flaky
