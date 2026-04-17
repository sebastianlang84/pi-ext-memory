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

Each step should land as a small, reviewable, testable commit. `v1.0` is explicitly feature-free: only final review, fixes, cleanup, and release closeout.

### v0.8.1
- Implement `/memory-review` and `/memory-session-save`.
- Persist compact session summaries.
- Finalize the manual-first write policy and candidate review flow.
- Add end-to-end tests for save -> search -> review -> session summary.

### v0.8.2
- Replace the deterministic built-in default embedding path with a real local semantic embedding adapter, targeting BGE-M3 first.
- Validate BGE-M3 retrieval quality and local runtime cost on target machines, and decide whether a lighter fallback model must ship alongside it.
- Make the project installable as a normal Pi extension package instead of only as a repo-local dev extension.
- Document the install/upgrade/smoke-test path for the packaged extension.

### v1.0
- No new features.
- Final code review pass.
- Fix review findings and polish rough edges.
- Update affected docs/changelog/version metadata.
- Create the release-finish commit only after verification is green.
