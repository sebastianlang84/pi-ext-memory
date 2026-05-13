---
role: Active open work backlog
contains: Open tasks with priority and status
not-contains: Completed history, durable decisions, or implementation notes
write-when: Active work or priorities change
---

# TODO / Active Backlog

Purpose: Active work only.
Rule: Completed items are removed, not checked off.

## Versioned delivery plan

### v2.0.0 — Memory Model Minimisation

Follow [Plan — Memory Model Minimisation](docs/plans/memory-model-minimisation.md). Remove each slice item after its verified commit.

- [ ] 1. Schema migration (remove expires_at, stale_after, progress JSON, links table; collapse done/superseded → archived; progress_snapshot → no-kind)
- [ ] 2. Kind reduction (remove fact/preference/decision/episode/artifact_ref/progress_snapshot from MEMORY_KINDS)
- [x] 3. Status reduction (active + archived only)
- [x] 4. Tool removal (memory_archive, memory_link, memory_list_active_todos, memory_list_active_handoffs)
- [x] 5. Field removal (expiresAt, staleAfter, progress object)
- [x] 6. Handoff count warning (≥3 active handoffs in same repo → warn)
- [ ] 7. Meta-table audit logging (lastAuditAt + lastAuditSummary after every audit)
- [ ] 8. Agent guidelines update (promptSnippets, README, AGENTS.md)
- [ ] 9. Tests and CHANGELOG

## Quality Reviews

Architecture deepening program: follow [Plan — Architecture Deepening](docs/plans/architecture-deepening.md). Remove each slice item after its verified commit.

No active quality review tasks.

## Open Design Issues

No open design issues. Add new entries here only when fresh design work is accepted.
