# ADR 007: Memory Model Minimisation

Date: 2026-05-13
Status: Accepted

## Context

pi-memory accumulated kinds, status values, fields, tools, and features across V1 lifecycle work. A design review identified that most of this complexity adds no system-level value — the same outcomes are achievable with a smaller, cleaner model.

The guiding principle: include everything needed for a solid, searchable, fast memory system — and nothing else.

## Decisions

### Kinds

Reduce from 8 kinds (`fact`, `preference`, `decision`, `episode`, `artifact_ref`, `progress_snapshot`, `todo`, `handoff`) to 2 explicit kinds:

- `todo` — has priority, nextAction, structured lifecycle
- `handoff` — has session lifecycle, active-handoff injection

All other memories have no explicit kind. A memory is text + tags + scope. The `fact`/`preference`/`decision`/`episode`/`artifact_ref` distinction is tag-level categorisation, not system-level behaviour.

### progress_snapshot and progress object

`progress_snapshot` kind is removed. The structured `progress` object on `memory_save` (`done`, `nextSteps`, `currentState`, `decisions`, `openQuestions`) is removed.

- `nextSteps` belong in real `todo` entries.
- `currentState`, `decisions`, and `done` belong in the memory body as free text.

### Status values

Reduce from 4 (`active`, `archived`, `done`, `superseded`) to 2:

- `active`
- `archived` + optional `archiveReason`

`done` and `superseded` are semantic nuances of "no longer active" — `archiveReason` covers both ("completed", "obsolete", "superseded by X").

### expiresAt and staleAfter

Both fields are removed. Expiry is not reliably set by agents, and automatic expiry is dangerous (a user on a two-month holiday should not return to find their todos archived). Lifecycle hygiene is the agent's responsibility, supported by audit warnings — not automatic expiry.

### Duplicate detection

Not implemented. Exact duplicates are rare in practice. Semantic duplicate detection (embedding-based O(n²)) has unacceptable false-positive risk and complexity. If duplicates appear, `memory_audit` and `memory_search` are sufficient to find and resolve them manually.

### Knowledge graph / memory_link

Removed. No concrete use case exists that tags and semantic search do not already cover. A knowledge graph requires consistent agent maintenance to be useful — which is not reliable in practice.

### Auto-audit

Removed. Audit checks based on age or update timestamp produce false positives (stale ≠ obsolete). Automatic deletion or archiving is explicitly out of scope. The session-start hygiene line is sufficient for routine awareness.

### Handoff count warning

`memory_save_handoff` warns when 3 or more active handoffs already exist in the same repo. Multiple active handoffs in one repo is almost always a sign of incomplete cleanup.

### Meta-table

Retained as internal infrastructure. After every `memory_audit` run, `lastAuditAt` and `lastAuditSummary` are written to the meta table. No other meta keys are defined for now.

### Tool surface

Remove the following tools:

- `memory_archive` — redundant wrapper for `memory_update(status="archived")`
- `memory_link` — knowledge graph removed
- `memory_list_active_todos` — redundant wrapper for `memory_list(kind="todo", status="active")`
- `memory_list_active_handoffs` — redundant wrapper for `memory_list(kind="handoff", status="active")`

Retain:

- `memory_save`, `memory_save_todo`, `memory_save_handoff`
- `memory_search`, `memory_list`, `memory_update`
- `memory_audit`, `memory_tag_catalog`, `memory_stats`

### sourceAgent / provenance

`sourceAgent` field is retained in the schema but not exposed as a user-facing parameter in this version. Provenance tracking (who triggered the save: user, agent, subagent) is a backlog item — useful for debugging agent behaviour, not in MVP scope.

### superseded status

Removed (covered by `archived` + `archiveReason`).

## Consequences

- Schema migration required: remove `progress_snapshot` kind, `progress` JSON column, `expires_at`, `stale_after`, `stale_after` columns; collapse `done`/`superseded` status values to `archived`.
- `links` table can be dropped.
- Tool surface shrinks from ~13 tools to 8.
- Agent guidelines become significantly simpler.
- Breaking change: SemVer major bump required.
