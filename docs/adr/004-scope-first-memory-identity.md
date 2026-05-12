# ADR 004 — Scope-first memory identity

- Status: Accepted
- Date: 2026-05-12
- Extended by: [ADR 005 — Simplified agent-facing memory scopes](005-simplified-agent-facing-scopes.md)

## Context

pi-memory stores memories in one local SQLite database with optional metadata for `scope`, `sessionId`, `projectId`, and `repoPath`.

Before this decision, tools could accept multiple identifiers for the same lookup, such as `scope="repo"` plus both `repoPath` and `projectId`. Because list/search predicates are combined, these inputs can accidentally become `project_id = ? AND repo_path = ?`, fragmenting saves and making valid memories look missing.

The design must support both:
- simple repositories where agents should not think about project ids, and
- monorepos where service/topic memory must remain separable.

## Decision

Use `scope` as the primary identity selector:

| Scope | Primary identity |
| --- | --- |
| `global` | none |
| `repo` | `repoPath` |
| `project` | `projectId` |
| `session` | `sessionId` |

Agent-facing tools reject contradictory manual filters:
- `global` does not accept `sessionId`, `projectId`, or `repoPath`.
- `repo` uses `repoPath`; `projectId` is not a filter/control input.
- `project` uses `projectId`; `repoPath` is not a filter/control input.
- `session` uses `sessionId`; repo/project metadata is runtime enrichment only.

Runtime code may still attach extra metadata to stored records for display, ranking, compatibility, and session fallback. The extra metadata must not become an extra manual filter requirement.

Inside a Git repository, ordinary memory and todo saves may default to `scope="repo"`; outside a repo they default to `scope="global"`.

## Consequences

### Positive
- Simple repo work no longer requires agents to choose between repo and project identifiers.
- List/search calls fail clearly on contradictory filters instead of returning misleading empty results.
- Monorepo service/topic memories remain supported through `scope="project"` + `projectId`.
- Existing records with extra metadata remain discoverable by the selected primary identity.

### Negative
- Calls that previously combined `projectId` and `repoPath` as filters must be changed.
- Some tool defaults change from global to repo scope when running inside a Git repository.

## Follow-up

- Add an audit/report path for existing records that violate the new primary identity expectations.
- ADR 005 resolves the project-id namespace question by soft-deprecating `project` / `projectId` for normal agent-facing use instead of defining a new namespace model.
