---
role: Working plan for simplifying pi-memory scope semantics
contains: Target global/repo/session model, project-scope deprecation path, agent rules, implementation slices, migration risks, and acceptance criteria
not-contains: Final ADR decision, completed implementation notes, or schema migration history
write-when: Scope model, deprecation strategy, migration approach, or agent-facing memory rules change materially
---

# Plan — Memory Scope Simplification

## 1. Purpose

Status: active implementation follow-up to [ADR 005 — Simplified agent-facing memory scopes](../adr/005-simplified-agent-facing-scopes.md), [ADR 004 — Scope-first memory identity](../adr/004-scope-first-memory-identity.md), and the archived [Plan — Memory Scope Identity](../archive/plans/memory-scope-identity.md).

This plan simplifies pi-memory's agent-facing scope model after the v3.0.0 scope-first identity work and the v3.1.0 identity audit/report path.

The new working hypothesis:

- Durable memory normally needs only **global** and **repo** scopes.
- **Session** scope remains useful, but only for handoff/resume/current-run state.
- **Project/projectId** creates more ambiguity than value for current use and should be deprecated from the normal agent-facing API rather than further namespaced.

## 2. Current Problem

ADR 004 made each scope own one primary identity:

| Scope | Primary identity |
| --- | --- |
| `global` | none |
| `repo` | `repoPath` |
| `project` | `projectId` |
| `session` | `sessionId` |

That fixed contradictory filter combinations, but left an open question: what is a `projectId`?

Discussion conclusion so far:

- If a field is called `projectId`, users expect it to be globally unique and stable.
- Repo URLs and local paths are locators, not stable identity; they can change after renames, moves, or transfers.
- For a normal single-repo project, repo scope already captures the durable project context.
- The unclear `project` scope forces agents to choose between repo and project even when there is no real distinction.

## 3. Target Mental Model

Use three agent-facing scopes:

| Scope | Meaning | Primary identity | Use when |
| --- | --- | --- | --- |
| `global` | Cross-repo durable memory | none | The fact/preference/workflow should follow the user/agent everywhere. |
| `repo` | Durable memory for the current repository/worktree | `repoPath` | A future agent in this repo should know it after this task ends. |
| `session` | Short-lived current-run state | `sessionId` | The information is only needed to resume or hand off this active task/session. |

Deprecate `project` as a normal agent-facing scope. Keep historical/internal support only as needed for compatibility until a migration/removal path is safe.

## 4. Agent Decision Rules

Agents should use this routing rule:

- **Global**: stable user/agent preference, cross-repo workflow, or durable fact that applies everywhere.
- **Repo**: stable repo-specific truth, architecture decision, setup command, caveat, progress snapshot, or open work that should survive task end.
- **Session**: temporary working state, handoff, resume point, partial progress, current blocker, or context-loss transfer state.

Short form:

- "Should every repo know this?" → `global`
- "Should future agents in this repo know this?" → `repo`
- "Is this only the current run/handoff?" → `session`
- "Unsure?" → do not save yet, or use a session handoff instead of durable memory.

## 5. Session Scope Boundary

Session scope is retained because repo/global scopes are too durable for in-flight state.

Use session for:

- active handoffs,
- context-reset recovery,
- agent transfer state,
- current task next steps,
- verification still missing in this run,
- temporary blockers that should not become repo truth.

Do not use session for:

- stable repo architecture,
- durable decisions,
- long-lived todos,
- reusable project facts,
- user preferences.

Tool-level consequence:

- `memory_save_handoff` writes session-scoped handoff state.
- Normal `memory_save` should not encourage `session` for ordinary facts.
- `memory_save_todo` should keep defaulting to repo inside a Git repo, unless explicitly global.

## 6. Project Scope Deprecation Strategy

Accepted direction from ADR 005: **soft deprecate first, remove later only if safe**.

Soft deprecation means:

- Keep reading/searching existing `scope="project"` records.
- Keep audit/report visibility for project-scoped records and mixed identifiers.
- Stop presenting `project` as a normal recommended choice in prompts/docs.
- Warn or guide agents toward `repo` unless an explicit legacy/admin path is used.
- Avoid automatic `projectId` defaults for normal global/repo/session use; explicit legacy project-scope calls may keep previous runtime identity resolution during the compatibility period.

Possible later removal means:

- Agent-facing tool schemas remove `project` and `projectId`.
- Existing project records are migrated, archived, or left as read-only legacy records after explicit review.
- SemVer major release, because public tool input behavior changes.

## 7. Target Agent-Facing Tool Surface

Target normal agent-facing tools after simplification:

1. `memory_search` — content search with lexical/semantic retrieval and compact scope filters.
2. `memory_list` — structured browsing, listing, and catalog-style navigation.
3. `memory_save` — durable non-action memories: facts, preferences, decisions, notes, and progress snapshots.
4. `memory_save_todo` — actionable open work with todo-specific status, priority, caps, and stale handling.
5. `memory_save_handoff` — one active session handoff for context-loss, agent-transfer, compaction, or session-end resume state.
6. `memory_update` — correct, close, supersede, archive, or refine existing memories.

Accepted consolidation path from ADR 006:

- `memory_list` is the normal structured listing surface and accepts optional `kind` and `scope` for small active catalog/listing flows.
- `memory_list_active_todos` and `memory_list_active_handoffs` remain callable as compatibility wrappers, but normal agents should prefer `memory_list`.
- `memory_update(status="archived", archiveReason=...)` is the normal archive path.
- `memory_archive` remains callable as a compatibility wrapper.
- `memory_stats` and `memory_link` remain callable as advanced/admin tools.
- `memory_audit` remains available for hygiene, scope identity findings, and read-only migration previews.

`memory_list` should support the navigation pattern needed to replace `MEMORY.md` discovery:

- no scope/identity: list available memory buckets such as global, repo paths, and active sessions with counts and recent examples;
- with scope/identity: list entries across kinds, with `kind` optional;
- with kind/status/tags: narrow structured browsing without requiring full-text search.

Do not collapse todo or handoff creation into generic `memory_save` unless their special behavior can be preserved without making the generic save schema confusing.

## 8. Compatibility and Migration Approach

Do not migrate automatically in the first slice.

1. Use `memory_audit` identity findings to inventory existing `project` records and mixed identifiers.
2. Classify each existing project record:
   - should become `repo`,
   - should become `global`,
   - should remain legacy/read-only,
   - should be archived.
3. Add a report-only migration preview before any write operation.
4. Only after user approval, provide targeted migration tooling or manual update guidance.

Important compatibility requirement:

- Existing project-scoped memories must remain discoverable during the deprecation period.

## 9. Implementation Slices

### Slice 1 — Decision docs

Status: complete.

- ADR 005 accepts the simplified global/repo/session model and soft-deprecates normal project/projectId use.
- `MEMORY.md`, `TODO.md`, and this plan were updated after the ADR was accepted.
- ADR 004 remains historical context and points to ADR 005 for the project-scope follow-up.

### Slice 2 — Prompt and docs cleanup

Status: complete.

- README and tool descriptions teach global/repo/session as the normal model.
- Session scope is documented as handoff/resume/current-run state.
- `project`/`projectId` are marked legacy/advanced wherever still exposed in normal docs/tool descriptions.

### Slice 3 — Tool/API deprecation behavior

Status: complete.

- Explicit `scope="project"` remains accepted for compatibility and emits a notice guiding normal repository memory to `scope="repo"` with `repoPath`.
- The compatibility path preserves previous explicit project-scope identity resolution; no new normal project defaults were introduced.
- No new project-facing affordances were added.
- Save/list/search defaults continue to avoid inferring project scope from repo names.

### Slice 4 — Retrieval compatibility

Status: complete.

- Regression coverage proves project-scoped records remain discoverable by `projectId` alone, even when legacy `repoPath` metadata is present.
- Turn-start retrieval keeps project and repo stages separate and does not add `repoPath` to the project stage.
- Repo/global/session retrieval remains unchanged.

### Slice 5 — Audit and migration preview

Status: complete.

- `memory_audit` and `/memory-audit` now include a read-only project migration preview separate from hard identity violations.
- The preview classifies active legacy project-scoped records as repo/global/archive/legacy-read-only/needs-human-review candidates.
- No migration, archive, or metadata write is performed by the preview.

### Slice 6 — Tool surface simplification

Status: complete.

- ADR 006 defines the normal-vs-advanced tool surface.
- `memory_list` now covers optional kind/scope catalog-style listing without requiring active-list wrappers.
- `memory_update(status="archived", archiveReason=...)` now covers normal archive flows.
- Specialized wrappers remain callable as advanced/compatibility tools; no hard removal was done.

### Slice 7 — Tests and SemVer

- Add regression tests for global/repo/session routing rules.
- Add tests proving ordinary repo saves do not create project identity.
- Add compatibility tests for legacy project records.
- Treat removal/rejection of `project` in public tools as a major SemVer change.
- Treat hard removal of callable compatibility/admin tools as a major SemVer change.

## 10. Acceptance Criteria

The simplification is accepted when:

- Agents have exactly three normal scope choices: global, repo, session.
- Normal repo work never requires `projectId`.
- Session state is clearly limited to handoff/resume/current-run use.
- Existing project-scoped records remain visible or are explicitly reported for review.
- Tool descriptions no longer make agents choose between repo and project for simple repo work.
- Tests cover durable global/repo memory, session handoffs, and legacy project compatibility.

## 11. Non-goals

- Do not remove database columns in the first simplification slice.
- Do not automatically migrate or delete existing project-scoped records.
- Do not solve multi-repo product grouping until a concrete use case requires it.
- Do not introduce remote services, background daemons, or non-local identity registries.

## 12. Open Questions

Resolved by ADR 005:

1. Do not reject `scope="project"` immediately; accept it as legacy/advanced compatibility while guiding normal use toward `global`, `repo`, and `session`.
2. Treat legacy `projectId` values as plain legacy labels for audit/migration guidance; do not define global or repo-relative namespace semantics in this slice.
3. Keep existing project-scoped records discoverable during the compatibility period.
4. Do not introduce a future `workspace`/`group` concept until a concrete multi-repo product grouping use case requires it.
5. Use a non-major release for docs/guidance/warnings; reserve a SemVer-major release for hard rejection or schema/tool removal.
