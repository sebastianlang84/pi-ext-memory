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

## Open Design Issues

- Research whether local autoresearch tooling can help optimize pi-memory prompt injection for lower token cost without degrading agent behavior.

## Retrieval reliability / memory quality

- Add canonical fact/key support for durable single-source facts such as `git.identity.default`, repo paths, and stable user preferences, so agents can resolve known fact types without relying only on free-text search.
- Make memory retrieval rank exact keys and tag matches ahead of weak semantic/lexical matches; a query containing `git` should surface `git`/`identity`/`commit` tagged memories even if the rest of the query is noise.
- Extend query expansion aliases beyond the initial Git identity fallback: `mailadresse -> email, e-mail, author email`; `repo -> repository, path, checkout`; `push -> git, remote, origin`.
- Add specialized resolver tools or APIs for high-value facts, starting with Git identity and repo path resolution, including repo-local config/history checks and conflict detection.
- Detect conflicting active memories in the same fact cluster, especially Git identity variants, and return an explicit conflict/canonical-candidate report instead of letting agents guess.
- Add memory hygiene/dedup support that can audit clusters such as `git,identity`, recommend a canonical record, and archive stale/conflicting duplicates.
- Improve empty-result behavior by reporting near misses instead of only `No memories matched`.
- Add broader retrieval eval cases beyond the initial Git identity noisy-query regression coverage.
- Harden memory write policy in docs/tool guidance: save only explicit durable facts, handoffs, persistent todos, project paths, or when the user explicitly says to remember; do not save transient preferences from frustration.
- Explore a tiny startup canonical-facts card with only pinned/canonical facts, not all memories, so critical facts can survive poor ad-hoc search queries.

