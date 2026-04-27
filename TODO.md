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

### v1.0
- Run final real-machine BGE-M3 command-adapter retrieval/latency validation; keep the shipped deterministic fallback unless evidence supports a different lighter semantic fallback.
- No new features.
- Final code review pass.
- Fix review findings and polish rough edges.
- Update affected docs/changelog/version metadata.
- Create the release-finish commit only after verification is green.
