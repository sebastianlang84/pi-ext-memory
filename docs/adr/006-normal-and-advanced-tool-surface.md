# ADR 006: Normal and Advanced Tool Surface

Date: 2026-05-13
Status: Accepted

## Context

pi-memory accumulated convenience and administrative tools during V1 lifecycle work. Those tools are useful, but exposing all of them as equally normal choices makes agent tool selection noisier.

The simplified scope model in ADR 005 also favors fewer normal paths: use `global`, `repo`, and `session`; prefer structured listing over specialized list wrappers; keep legacy and administrative paths available without encouraging them for routine use.

## Decision

The normal agent-facing tool path is:

- `memory_search` for content retrieval.
- `memory_list` for structured listing, including active todos and handoffs.
- `memory_save`, `memory_save_todo`, and `memory_save_handoff` for explicit writes.
- `memory_update` for corrections, lifecycle changes, and normal archive flows via `status="archived"` plus `archiveReason`.
- `memory_audit` for hygiene, scope-identity findings, and read-only legacy project migration previews.

The following tools remain callable as advanced or compatibility tools, but should not be the normal first choice:

- `memory_list_active_todos`
- `memory_list_active_handoffs`
- `memory_stats`
- `memory_archive`
- `memory_link`

`memory_list_active_handoffs` keeps its explicit name instead of adding a shorter alias. It is a compatibility wrapper with special active-only and repo/session widening behavior; adding `memory_list_handoffs` would increase the surface instead of simplifying it.

No public tool is removed in this slice. Hard removal of callable tools remains a future SemVer-major decision.

## Consequences

- Agents get a smaller recommended path without breaking older workflows.
- `memory_list` accepts optional `kind` and `scope`, enabling a small active catalog and replacing most routine uses of active-list wrappers.
- `memory_update` can archive with a reason, reducing normal reliance on `memory_archive`.
- Advanced tools can be hidden, removed, or moved behind an admin surface later only with an explicit SemVer-major decision.
