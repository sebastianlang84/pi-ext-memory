# ADR 006: Normal and Advanced Tool Surface

Date: 2026-05-13
Status: Accepted; partially superseded by ADR 007

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
- `memory_tag_catalog` for read-only tag inventory before agents create unfamiliar content/context tags.

ADR 007 partially supersedes the advanced/compatibility portion of this decision: the former advanced tools `memory_archive`, `memory_link`, `memory_list_active_todos`, and `memory_list_active_handoffs` are no longer callable. Use `memory_update(status="archived", archiveReason=...)` for archive flows and `memory_list` filters for active todos or handoffs.

Only `memory_stats` remains callable as an advanced/admin tool; it should not be the normal first choice for routine agent work.

## Consequences

- Agents get a smaller recommended path.
- `memory_list` accepts optional `kind` and `scope`, enabling a small active catalog and replacing active-list wrappers.
- `memory_update` can archive with a reason, replacing normal reliance on `memory_archive`.
- `memory_tag_catalog` adds one normal read-only lookup path to reduce tag vocabulary drift without overloading `memory_audit`, which writes audit metadata.
- The remaining advanced/admin callable surface is limited to `memory_stats`.
