# Plan: Memory Model Minimisation (v2.0.0)

Status: Accepted, not started  
ADR: [007-memory-model-minimisation](../adr/007-memory-model-minimisation.md)

## Goal

Reduce pi-memory to its essential core: a fast, searchable, well-scoped memory store with minimal surface area. Remove everything that adds complexity without system-level value.

## Slices

### 1. Schema migration

- Remove `expires_at` and `stale_after` columns from `memories` table
- Remove `progress` JSON field from `memories` table
- Drop `links` table
- Collapse `done` and `superseded` status values → `archived` (migrate existing records)
- Remove `progress_snapshot` kind → migrate existing records to no-kind memories
- Write and test migration

### 2. Kind reduction

- Remove `fact`, `preference`, `decision`, `episode`, `artifact_ref`, `progress_snapshot` from `MEMORY_KINDS`
- `memory_save` no longer accepts a `kind` parameter (or accepts only `todo`/`handoff` for compatibility)
- Update all validators and normalizers

### 3. Status reduction

- Remove `done` and `superseded` from `MEMORY_STATUSES`
- Only `active` and `archived` remain
- Update all validators, filters, and formatters

### 4. Tool removal

- Remove `memory_archive`
- Remove `memory_link` and all link-related store methods
- Remove `memory_list_active_todos`
- Remove `memory_list_active_handoffs`
- Update tool registry and prompt guidelines

### 5. Field removal

- Remove `expiresAt` and `staleAfter` from all inputs, outputs, mappers, and store methods
- Remove `progress` object from `memory_save` input
- Keep `sourceAgent` in schema (not exposed as user parameter)

### 6. Handoff count warning

- In `memory_save_handoff`: query active handoff count for same repoPath before saving
- If count ≥ 3: include warning in response

### 7. Meta-table audit logging

- After every `memory_audit` run: write `lastAuditAt` and `lastAuditSummary` to meta table
- Expose in `memory_stats` output

### 8. Agent guidelines update

- Rewrite all `promptSnippet` and `promptGuidelines` entries to reflect simplified model
- Remove all references to removed kinds, status values, and tools
- Update README and AGENTS.md

### 9. Tests and CHANGELOG

- Update all affected tests
- Write CHANGELOG entry for v2.0.0 breaking changes

## Out of scope for this plan

- Provenance/sourceAgent as user-facing parameter (backlog)
- Semantic duplicate detection (backlog)
- Knowledge graph / memory_link (removed, not backlog)
