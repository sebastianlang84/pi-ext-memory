# ADR 005 — Simplified agent-facing memory scopes

- Status: Accepted
- Date: 2026-05-13
- Supersedes: Normal agent-facing `project` guidance from [ADR 004](004-scope-first-memory-identity.md)

## Context

ADR 004 made `scope` the primary identity selector and fixed contradictory `projectId`/`repoPath` filters. That strictness solved fragmentation, but it kept four normal scope choices in front of agents: `global`, `repo`, `project`, and `session`.

The remaining ambiguity is `projectId`. In practice, a project id is not clearly global, repo-relative, or stable across renames and moves. For ordinary single-repo work, `repo` already captures the durable context. Keeping `project` as a normal choice makes agents decide between repo and project even when there is no useful distinction.

## Decision

Use only three normal agent-facing scopes:

| Scope | Use when |
| --- | --- |
| `global` | The memory should apply across repositories. |
| `repo` | Future agents in this repository/worktree should know it. |
| `session` | The state is short-lived handoff/resume/current-run context. |

Soft-deprecate `project` / `projectId` for normal agent-facing use.

Soft deprecation means:

- Existing project-scoped records remain readable and searchable during the compatibility period.
- Tools and docs should stop recommending `project` as a normal choice.
- Runtime defaults must not derive `projectId` from repo name, URL, or path.
- Audit and migration tooling should report project-scoped records before any write operation.
- No automatic migration or deletion happens without explicit user approval.

Hard rejection or removal of `project` from public tool schemas is deferred. If it happens later, it is a SemVer-major change.

## Consequences

### Positive

- Agents have a simpler routing rule: global, repo, or session.
- Normal repository work never requires `projectId`.
- The API avoids pretending that a stable global project identity exists when it has not been defined.
- Existing records are protected from silent migration mistakes.

### Negative

- Multi-repo product grouping remains unsolved until a concrete use case justifies a new concept.
- Legacy project records need explicit audit/migration preview support.
- Tool descriptions and compatibility behavior need a cleanup pass.

## Follow-up

- Update README and tool descriptions to present global/repo/session as the normal model.
- Mark `project` and `projectId` as legacy/advanced wherever they remain exposed.
- Keep legacy project records discoverable in search/list during the compatibility period.
- Add a no-write migration preview that classifies existing project records as repo, global, legacy/read-only, or archive candidates.
