---
role: Working plan for pi-memory scope identity simplification
contains: Scope identity policy, simple-repo and monorepo target behavior, implementation slices, compatibility risks, and acceptance criteria
not-contains: Final ADR decision, completed implementation notes, or schema migration history
write-when: Scope/identifier semantics, planned validation, defaults, or migration approach changes materially
---

# Plan — Memory Scope Identity

## 1. Purpose

Status: archived/superseded. The first implementation slice was accepted in [ADR 004 — Scope-first memory identity](../../adr/004-scope-first-memory-identity.md). The audit/report follow-up is implemented as report-only `memory_audit` identity findings. ADR 005 resolves the remaining project-id namespace question by soft-deprecating normal project/projectId use.

This plan resolves the `scope` / `projectId` / `repoPath` ambiguity in pi-memory without losing the two core use cases:

- **Case A: simple repo** — one repository, repo name equals project/product name, agents need memory without thinking about identifiers.
- **Case B: monorepo** — one repository contains many services, packages, products, or recurring workstreams that need separate memory contexts.

The goal is to make the agent-facing API simpler while preserving internal context richness for retrieval quality.

## 2. Current Problem

pi-memory currently exposes several related identifiers at once:

- `scope="repo"` with `repoPath`
- `scope="project"` with `projectId`
- optional combinations of `scope`, `repoPath`, `projectId`, and `sessionId`

This creates failure modes for agents:

- A simple repo can be saved sometimes as `repo`, sometimes as `project`, sometimes with both identifiers.
- List/search filters use separate predicates, so wrong combinations can become an accidental `project_id = ? AND repo_path = ?` trap.
- Agents must understand product/repo/monorepo semantics before using memory safely.
- Weaker or overloaded models can be overwhelmed by too many plausible tool inputs.

## 3. Design Goals

1. **Agent-facing simplicity** — ordinary repo work should not require choosing between `projectId` and `repoPath`.
2. **Monorepo usefulness** — services/topics inside one repo must remain separable through project-like identity.
3. **No memory fragmentation** — avoid split memories caused by inconsistent identifier combinations.
4. **Local-first global store** — keep one SQLite store with metadata filters; do not create per-repo databases.
5. **Runtime enrichment over model guessing** — Pi/runtime context should fill identifiers when possible.
6. **Explicit validation** — invalid identifier combinations should fail clearly instead of returning misleading empty results.

## 4. Target Mental Model

`scope` determines the primary identity.

| Scope | Primary identity | Agent-facing rule | Runtime/internal enrichment |
| --- | --- | --- | --- |
| `global` | none | no `projectId`, `repoPath`, or `sessionId` | none |
| `repo` | `repoPath` | default for normal work inside a Git repo | derive `repoPath`; may store `projectId` as metadata |
| `project` | `projectId` | use for service/package/product/topic context | derive/store `repoPath` as namespace when available |
| `session` | `sessionId` | use for handoff/current-session state | derive `sessionId`; may store `repoPath`/`projectId` for fallback |

Important distinction:

- **Agent-facing filters** use only the primary identity for the selected scope.
- **Stored records** may keep extra derived metadata for ranking, display, compatibility, and fallback retrieval.

## 5. Case A — Simple Repo Behavior

Example: a repo named `partflow`, where repo name and project name are effectively the same.

Expected agent behavior:

```ts
memory_save({
  scope: "repo",
  kind: "progress_snapshot",
  title: "partflow project state",
  summary: "..."
})
```

The agent should not need to provide `repoPath` or `projectId`. The runtime derives the repo path from `cwd`.

Defaults:

- If `cwd` is inside a Git repo and no narrower project/service context is explicit, default ordinary durable memories and todos to `repo`.
- `global` is reserved for cross-repo user/agent facts and preferences.
- `project` is not required for the simple-repo case unless the user explicitly names a product/workstream distinct from the repo.

## 6. Case B — Monorepo Behavior

Example: a repo named `ai_stack` containing `newsletter-writer`, `transcript-miner`, and `openclaw`.

Expected agent behavior for repo-wide facts:

```ts
memory_save({
  scope: "repo",
  kind: "decision",
  title: "ai_stack repo layout",
  summary: "..."
})
```

Expected agent behavior for a service/topic:

```ts
memory_save({
  scope: "project",
  projectId: "newsletter-writer",
  kind: "progress_snapshot",
  title: "newsletter-writer state",
  summary: "..."
})
```

The runtime may store `repoPath` internally with that project memory, so `newsletter-writer` in one monorepo does not silently collide with a same-named project elsewhere.

Open design point for implementation:

- Define whether `projectId` is globally unique, repo-relative, or displayed as plain `projectId` while internally namespaced with `repoPath`.

## 7. Validation Rules

Implement one shared scope-identity normalizer/validator used by tool handlers and core-facing inputs.

Proposed strict agent-facing rules:

- `scope="global"`: reject manual `projectId`, `repoPath`, and `sessionId`.
- `scope="repo"`: require or derive `repoPath`; reject manual `projectId` as a filter/control input.
- `scope="project"`: require or derive/provide `projectId`; reject manual `repoPath` as an agent filter unless an advanced/admin path explicitly allows it.
- `scope="session"`: require or derive `sessionId`; do not require agents to pass repo/project identifiers.

Runtime enrichment exception:

- Trusted runtime code may attach extra `repoPath`/`projectId` metadata after validation, but those fields must not become extra manual filter requirements for agents.

## 8. Search/List Semantics

Search/list should avoid accidental AND-fragmentation:

- For `scope=repo`, filter primarily by `repoPath`.
- For `scope=project`, filter primarily by `projectId`, with runtime namespace handling where needed.
- For `scope=session`, filter primarily by `sessionId`.
- Do not accept mixed manual identifiers that narrow results unexpectedly.

Compatibility path:

- Existing records with both identifiers should remain discoverable.
- Existing records with suspicious or missing primary identifiers should be surfaced by audit before any migration.

## 9. Implementation Slices

### Slice 1 — ADR and tests first

Status: implemented for the first strict-validation slice.

- Write an ADR for the final scope identity policy.
- Add tests that capture Case A and Case B before changing behavior.
- Add tests for rejection of contradictory manual identifiers.

### Slice 2 — Shared normalizer/validator

- Add a shared scope identity helper in core or Pi-extension boundary code.
- Use it from save, todo, handoff, update, list, search, stats, and active-list helpers as appropriate.
- Keep runtime enrichment separate from agent-provided identity.

### Slice 3 — Defaults and enrichment

- Ensure ordinary repo work defaults to `repo` when `cwd` is in a Git repo.
- Preserve `project` for monorepo service/topic contexts.
- Make current resolved identities visible in `/memory-review` or status-style output so humans can diagnose what the runtime inferred.

### Slice 4 — Tool API and prompt simplification

- Shorten tool descriptions to explain one primary identity per scope.
- Remove or reject misleading optional identifier combinations.
- Review related tool names, including `memory_list_active_handoffs` vs `memory_list_handoffs`, as part of the same API clarity pass.

### Slice 5 — Compatibility and audit

Status: audit/report path implemented for active records; migration remains intentionally manual.

- `memory_audit` and `/memory-audit` now report active records that violate primary identity expectations.
- Decide whether to leave, backfill, or migrate existing records only after reviewing audit output.

## 10. Acceptance Criteria

The change is done when:

- A simple repo agent can save/list/search repo memory without manually choosing `projectId` vs `repoPath`.
- A monorepo agent can store and retrieve service/topic memory separately from repo-wide memory.
- Passing contradictory identifiers produces a clear error or guided correction, not a silent empty result.
- Existing mixed-identifier records remain discoverable or are clearly flagged for repair.
- Tests cover simple repo, monorepo, same project name in different repos, session handoff fallback, and invalid combinations.
- Tool descriptions teach the simplified model in one or two short rules.

## 11. Non-goals

- Do not remove `project_id` or `repo_path` columns in this pass.
- Do not split the global SQLite store into per-repo databases.
- Do not make automatic memory creation more aggressive.
- Do not solve all tool naming questions beyond tracking them for the API clarity pass.

## 12. Open Decisions Before Implementation

1. Should invalid manual combinations be hard-rejected immediately, or normalized with warnings for one compatibility release?
2. Is `projectId` globally unique, repo-relative, or internally namespaced by `repoPath`?
3. Should `memory_save_todo` default to `repo` inside a Git repo, or should scope become required?
4. Which tool surfaces are considered advanced/admin and may still accept explicit secondary metadata?
5. What is the SemVer impact: minor hardening with compatibility warnings, or breaking `2.0.0` if strict rejection changes the public tool API?
