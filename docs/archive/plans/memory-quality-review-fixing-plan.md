# Memory Quality Review Fixing Plan

Date: 2026-05-13
Status: completed/archived
Scope: retrieval/memory quality, Module seams, testability, agent navigability, and regression coverage for scope identity, audit, handoffs, and tool validation.

## Completion Outcome

Completed as v3.3.1 with a deliberately bounded scope:
- Added focused regression coverage for tool identity validation, audit filters, handoff relevance, and retrieval quality.
- Extracted the high-value seams: `tool-identity`, `handoffs`, and default retrieval policy.
- Fixed expired-handoff relevance so expired active handoffs are not preloaded, archived by current-session lookup, or listed as active relevant handoffs.
- Deferred the broad Phase 4 tool-family split because the smaller seam extractions gave the needed locality without risking unnecessary public-tool churn.

## Review Inputs

- Architecture review lens: `improve-codebase-architecture` vocabulary and deletion test.
- TDD review lens: behavior through public interfaces, integration-style tests, one red test per behavior.
- Existing constraints: local-first, SQLite-backed, Pi-first extension surface, scope-first identity, and legacy `project` compatibility.
- Concurrency note: this plan is docs-only; do not touch the existing dirty `src/pi-extension/tools.ts` worktree change unless you own that in-progress work.

## Architecture Findings

### 1. Scope identity is implemented across several shallow Modules

Files:
- `src/core/memories.ts` — normalizes search/list filter identity via `validateScopeIdentityFilters`.
- `src/pi-extension/tools.ts` — validates tool-facing identity via `resolveToolIdentity` and `resolveSingleScopeSearchIdentity`.
- `src/pi-extension/retrieval.ts` — derives turn context, enriches writes, and builds staged scope search plans.
- `src/pi-extension/audit.ts` — reports scope identity violations and previews legacy project migration candidates.

Problem:
- The scope identity Interface is not a single obvious test surface. Callers must understand overlapping rules in the core normalizers, Pi tool adapters, retrieval enrichment, and audit reporting.
- Deletion test: deleting any one helper does not delete the concept; the same rules reappear elsewhere. That is a shallow Module signal.

Deepening opportunity:
- Create a dedicated scope identity Module with a small Interface for: deriving primary identity, validating compatible filter identity, enriching runtime metadata, and describing identity errors/notices.
- Keep Pi-specific text/adapters outside the core, but move the shared rules behind one seam.

Expected leverage/locality:
- One Module becomes the Interface for scope identity behavior.
- Scope changes can be tested once and reused by tools, retrieval, and audit without duplicating cases.
- Agents can navigate identity behavior by reading one file first.

### 2. Tool registration has too much behavior behind one large Module

Files:
- `src/pi-extension/tools.ts` — registers all tools, validates identity, builds todo/handoff payloads, formats output, and exposes active-list/stats helpers.
- `test/pi-extension/tools.test.ts` — broad mixed coverage for registration, identity, audit, handoff, archive, update, todo, and stats behavior.

Problem:
- `registerMemoryTools` is a wide Interface with many behaviors hidden in one file. It is deep for Pi integration, but shallow for maintainers because unrelated tool behaviors share one Implementation and one large test file.
- Agent navigability suffers: a change to `memory_stats` or `memory_list_active_handoffs` requires scanning save/update/handoff code too.

Deepening opportunity:
- Split tool adapters by behavior family while keeping the external Pi tool Interface unchanged:
  - `tool-identity.ts` for identity resolution/notices.
  - `tool-save.ts` for save/todo/handoff payload construction.
  - `tool-list.ts` for list/search/active-list/stats filters.
  - `tool-formatters.ts` for tool output formatting.
- Keep `tools.ts` as the composition Module that registers adapters.

Expected leverage/locality:
- Smaller read-first files; fewer merge conflicts during parallel work.
- Tests can target each public tool behavior while sharing fixture builders.
- Tool API stays stable for agents.

### 3. Handoff lookup has multiple related seams

Files:
- `src/pi-extension/retrieval.ts` — `findLatestHandoffForTurn` exact session lookup plus repo/project fallback.
- `src/pi-extension/commands.ts` — `/memory-handoff archive` has a separate exact-session helper.
- `src/pi-extension/tools.ts` — `memory_list_active_handoffs` widens repo/project lookups to session-scoped handoffs with matching metadata.

Problem:
- Handoff relevance is a product concept, but the Interface is distributed across retrieval preload, command archive, and active-list tools.
- Deletion test: deleting one helper would force callers to recreate subtle relevance ordering and fallback rules.

Deepening opportunity:
- Extract a handoff relevance Module with explicit operations: latest for turn, latest exact session for archive, list relevant active handoffs for scope.
- Keep command/tool formatting as adapters.

Expected leverage/locality:
- Fallback ordering and archive safety live in one place.
- Tests can cover handoff relevance independent of Pi command/tool formatting.

### 4. Retrieval ranking quality is configurable only by editing implementation constants

Files:
- `src/core/search.ts` — candidate limits, minimum vector similarity, scope scores, and hybrid weights are constants in the Implementation.
- `test/core/memory-hybrid-search.test.ts` and `test/pi-extension/retrieval.test.ts` cover ranking and staged retrieval behavior.

Problem:
- Retrieval quality is central to the product, but the ranking Interface is implicit. Tests can detect regressions, but operators/maintainers cannot inspect or vary policy without editing internals.

Deepening opportunity:
- Introduce a retrieval policy Module with a small Interface for weights, scope scores, candidate limits, and dedupe thresholds.
- Keep default policy local-first and deterministic; do not add remote/config-heavy infrastructure.

Expected leverage/locality:
- Retrieval quality tuning becomes localized.
- Tests can name policy behavior rather than internal constants.

## TDD / Test-Coverage Findings

Strengths:
- Scope-first retrieval has good integration-style coverage for staged search, blank session IDs, no unscoped fallback, and legacy project lookup.
- Audit coverage verifies read-only migration preview and scope identity violation reporting.
- Tool coverage verifies registration, prompt snippets, save/list/update/archive/handoff behavior, project-scope notices, and several identity rejections.

Gaps to close:

1. Scope identity validation is not tested consistently across all public tool Interfaces.
   - Existing strong example: `memory_save` default repo identity and hidden contradictory ID rejection.
   - Missing equivalents: `memory_save_todo`, `memory_list`, `memory_list_active_todos`, `memory_list_active_handoffs`, `memory_stats`, and `memory_search` multi-scope identity combinations.

2. Core create/update identity policy is ambiguous by design.
   - `normalizeSearchMemoriesInput` and `normalizeListMemoriesInput` validate identity filters.
   - `normalizeCreateMemoryInput` currently permits historical invalid records, which audit tests rely on.
   - Plan must preserve the ability to create historical fixtures while deciding whether new public writes are guarded only at Pi-tool seams or also at a core write seam.

3. Audit behavior lacks focused regression tests for filtered audit semantics.
   - Current tests cover full-store preview and identity violation output.
   - Missing: `scopeFilter` excluding project preview, `repoPathFilter` limiting candidates, and tool/command output consistency for filtered vs unfiltered audit.

4. Handoff relevance needs more edge coverage.
   - Current tests cover exact session preference, repo fallback, active-list widening, archive by id, and content-edit blocking through `memory_update`.
   - Missing: fallback ordering when both repo and project candidates exist, expired handoffs exclusion in preload/list flows, session handoff with repo/project metadata that must not be overwritten from fallback, and active cap behavior per relevant scope.

5. Tool validation tests are broad and monolithic.
   - `test/pi-extension/tools.test.ts` is useful but mixes many behaviors, making future regressions harder for agents to localize.
   - Add focused tests before refactoring so the split remains behavior-preserving.

## Fixing Plan

### Phase 0 — Coordination and baseline

1. Coordinate with the other active agent before touching code.
   - Check `git status --short --branch`.
   - Do not overwrite the current `src/pi-extension/tools.ts` modification unless it is explicitly handed over.
2. Run baseline verification once the worktree owner says it is safe:
   - `npm test`
   - `npm run smoke:package-status`
   - Run `npm run smoke:memory-status` only when the global Pi extension environment is known healthy.
3. If this becomes a code change commit, update `CHANGELOG.md` and package/runtime version per SemVer before commit.

### Phase 1 — Add red tests for public behavior

Add focused tests first. Keep each test to one behavior.

1. Scope identity / tool validation tests in `test/pi-extension/tools.test.ts` or a new `test/pi-extension/tool-identity.test.ts`:
   - `memory_save_todo` rejects `scope="repo"` with explicit `projectId` and no manual `repoPath` override.
   - `memory_list` rejects `scope="session"` with explicit `repoPath` or `projectId`.
   - `memory_list_active_todos` rejects `scope="global"` with any identity parameter.
   - `memory_list_active_handoffs` rejects `scope="project"` with `repoPath` and emits the legacy-project notice only for valid project lookups.
   - `memory_stats` rejects `scope="repo"` with `projectId` and accepts runtime-derived `repoPath` when omitted inside a Git repo.
   - `memory_search` rejects multiple identity filters when no single compatible scope is provided, and accepts a single `repoPath` filter only when scope is `repo` or scope is omitted with no other identity.

2. Audit tests in `test/pi-extension/audit.test.ts`:
   - `runMemoryAuditFull(store, ["repo"])` does not include project migration preview candidates.
   - `runMemoryAuditFull(store, undefined, "/repo/a")` includes only records with that `repoPath`.
   - `formatAuditResults` keeps migration preview marked read-only when mixed with stale todos and identity violations.

3. Handoff tests in `test/pi-extension/retrieval.test.ts` and focused tool tests:
   - `findLatestHandoffForTurn` chooses exact session over repo fallback over project fallback.
   - Fallback handoff message includes the fallback warning and should not instruct agents to overwrite it.
   - Expired or archived handoffs are excluded from latest-for-turn and active-list results.
   - `memory_save_handoff` updates only the current session active handoff, not a fallback handoff from another session with matching repo metadata.

4. Retrieval quality tests in `test/core/memory-hybrid-search.test.ts`:
   - Regression test that a repo-scoped exact lexical hit beats an unrelated global semantic-only hit when query and repo filter are provided.
   - Regression test that near-duplicate suppression does not hide two different actionable todos with similar titles but different next actions.

### Phase 2 — Deepen the scope identity Module

1. Add a core or pi-extension-local Module such as `src/pi-extension/tool-identity.ts` first; move code only after Phase 1 tests fail/pass correctly.
2. Extract these operations behind a small Interface:
   - resolve identity for a single requested scope;
   - resolve search/list identity filters;
   - format scope identity errors;
   - format legacy project-scope notice.
3. Preserve existing external tool schemas and output text unless a test explicitly documents an intentional wording change.
4. Run:
   - `npm test -- --test-name-pattern "identity|memory_save|memory_list|memory_search|memory_stats"`
   - then full `npm test`.

### Phase 3 — Deepen handoff relevance

1. Add `src/pi-extension/handoffs.ts` or equivalent.
2. Move relevance logic into the new Module:
   - latest exact session handoff;
   - latest handoff for turn with fallback ordering;
   - relevant active handoff filter for list tools.
3. Keep `/memory-handoff`, `memory_save_handoff`, `memory_list_active_handoffs`, and turn-start preload as adapters over that Interface.
4. Run:
   - `npm test -- --test-name-pattern "handoff"`
   - then full `npm test`.

### Phase 4 — Split tool registration by behavior family

1. After identity/handoff tests are green, split `src/pi-extension/tools.ts` without changing registered tool names or schemas.
2. Suggested files:
   - `src/pi-extension/tool-registration.ts` or keep `tools.ts` as the composition root.
   - `src/pi-extension/tool-save.ts`
   - `src/pi-extension/tool-list.ts`
   - `src/pi-extension/tool-formatters.ts`
3. Move fixtures from `test/pi-extension/tools.test.ts` into shared helpers only if that reduces duplication without hiding behavior.
4. Run full `npm test` after each small move.

### Phase 5 — Retrieval policy seam

1. Introduce a retrieval policy Module only after behavior tests protect current ranking.
2. Keep the default policy identical to current constants in `src/core/search.ts`.
3. Add tests that assert default policy behavior through `searchMemories`, not private constants.
4. Do not add runtime config, remote dependencies, or a service process in this pass.

### Phase 6 — Closeout

1. Update docs only if public behavior or contributor navigation changes:
   - `README.md` for user-visible tool behavior.
   - `MEMORY.md` for stable current truth.
   - `CHANGELOG.md` and package/runtime version for any commit-worthy code change.
2. Verification before handoff/commit:
   - `npm test`
   - `npm run smoke:package-status`
   - optional `npm run smoke:memory-status` if global install is healthy.
3. If work is interrupted, save a pi-memory handoff only when another agent must resume from lost context; otherwise keep progress in this plan/TODO.
