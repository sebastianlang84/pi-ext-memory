---
role: Active open work backlog
contains: Open tasks with priority and status
not-contains: Completed history, durable decisions, or implementation notes
write-when: Active work or priorities change
---

# TODO / Active Backlog

Purpose: Active work only.
Rule: Completed items are removed, not checked off.

Backlog review notes: [docs/plans/todo-backlog-review-2026-05-15.md](docs/plans/todo-backlog-review-2026-05-15.md)
Evidence gate review: [docs/plans/retrieval-quality-evidence-gate-2026-05-16.md](docs/plans/retrieval-quality-evidence-gate-2026-05-16.md)

## Deferred until new evidence justifies them

- Re-open canonical-key retrieval evidence collection only with concrete zero-hit, wrong-hit, or conflict cases where existing tags, `memory_tag_catalog`, exact tag/`metadata.canonicalKey` ranking, and near-key/tag hints are insufficient.

- Add optional `canonicalKey` write support and canonical-key conflict audit only if the retrieval-quality evidence gate proves a high-value gap; keep assignment explicit and manual.
- Add specialized resolver tools or APIs for high-value facts, starting with Git identity and repo path resolution, only after existing tags/search/audit and any proven canonical-key support still leave a concrete gap; prefer one small generic resolver surface over multiple normal tools.
- Explore a tiny startup canonical-keys card with only pinned/keyed memories, not all memories, only after retrieval evals show search/fallback is insufficient; keep it hard-capped or opt-in.

