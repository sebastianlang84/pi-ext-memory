# ADR 010: Enforce Handoff Expiry at Read Time

Date: 2026-07-07
Status: Accepted

## Context

`MEMORY_POLICY` defines a per-scope `expireAfterDays` window for handoffs (7 days), and `src/pi-extension/handoffs.ts` routes all handoff lookups through a helper named `listActiveUnexpiredHandoffs`, passing a `now` reference time to `isActiveHandoff(memory, now)`.

However, `isActiveHandoff` only accepted `(memory)` and silently ignored `now`. No expiry check ran anywhere except the advisory audit. As a result a handoff from weeks ago was still injected every turn as the "Latest active handoff", presenting stale state as current — the exact failure the naming implied was already handled.

## Decision

Enforce expiry where the code already intended to:

- `isActiveHandoff(memory, now?)` now checks status and, when `now` and lifecycle fields are present, whether the handoff is within its scope's `expireAfterDays` window (`isHandoffExpired`). Without `now` it remains the cheap status-only predicate for callers that carry no reference time.
- Turn-start handoff preload and handoff lookups pass `now`, so expired handoffs are excluded from injection and from `/memory-handoff`.
- The expiry window stays policy-driven and is not auto-archiving: expired handoffs are hidden from active surfaces but remain in the store, are reported by `memory_audit`, and can be batch-archived via `memory_audit apply=["expired_handoff"]`.

The 7-day window is the pre-existing policy; it is now actually applied and is tunable through the lifecycle policy.

## Consequences

- Agents no longer resume from stale handoffs presented as current context.
- A handoff idle past the window stops being surfaced; this is intended, and expired handoffs remain recoverable via audit/search until archived.
- Because a very long-running session (> window) could hide its own handoff, the window is a policy value rather than a hard constant, leaving room to tune it.
