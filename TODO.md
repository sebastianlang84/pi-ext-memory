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

## Retrieval quality work packages

### 1. Tag hygiene and catalog

- Add near-tag suggestions so search/save/update paths can warn about likely duplicate tags such as `agentic-context` vs `agent-context`; plan: [docs/plans/tag-catalog-controlled-folksonomy.md](docs/plans/tag-catalog-controlled-folksonomy.md).
- Decide how to handle old workflow tags (`todo`, `p1`, `blocked`) that were written before new todo saves stopped adding them: audit recommendation, explicit migration, or leave as historical data.
- Consider whether a tiny curated preferred-tag seed is needed, or whether the derived `memory_tag_catalog` is sufficient.

### 2. Ranking and near-miss retrieval

- Make memory retrieval rank exact tag and canonical-key matches ahead of weak semantic/lexical matches; a query containing `git` should surface `git`/`identity`/`commit` tagged memories even if the rest of the query is noise.
- Improve empty-result behavior by reporting near tag/key misses instead of only `No memories matched`.

### 3. Minimal canonical facts

- Add canonical fact/key support for durable single-source facts such as `git.identity.default`, repo paths, and stable user preferences, so agents can resolve known fact types without relying only on free-text search.
- Keep canonical facts lightweight: do not reintroduce a `fact` kind, knowledge graph, broad registry, or background resolver; prefer existing tags/metadata or one minimal indexed field if tests prove it necessary.

### 4. Advisory hygiene and conflict audit

- Detect conflicting active memories in the same canonical fact cluster, especially Git identity variants, and return an explicit conflict/canonical-candidate report instead of letting agents guess.
- Add memory hygiene/dedup support for exact key/tag clusters that recommends a canonical record and archive candidates; keep all archive actions explicit/manual.

## Deferred until evidence justifies them

- Research whether local autoresearch tooling can help optimize pi-memory prompt injection for lower token cost without degrading agent behavior.
- Add specialized resolver tools or APIs for high-value facts, starting with Git identity and repo path resolution, only after minimal canonical facts and ranking still leave a concrete gap; prefer one small generic resolver surface over multiple normal tools.
- Explore a tiny startup canonical-facts card with only pinned/canonical facts, not all memories, only after retrieval evals show search/fallback is insufficient; keep it hard-capped or opt-in.

