---
role: Curated outward-facing repo change history
contains: User/operator-relevant changes using Keep a Changelog categories
not-contains: Internal scratch notes, standing defaults, or current-state snapshots
write-when: A user/operator-relevant repo change is introduced
---

# Changelog

All notable user/operator-relevant changes are documented in this file.
This changelog follows the Keep a Changelog format.
Older non-monotonic entries are preserved as legacy release-line history.

## [Unreleased]

## [2.0.12] - 2026-05-15

### Changed
- Clarified README and PRD documentation for the current tool surface, admin `memory_stats` tool, no-automatic-TTL lifecycle posture, and kindless/todo/handoff V1 scope.

## [2.0.11] - 2026-05-15

### Changed
- Refreshed documentation and runtime status metadata to match the current kindless memory model, default DB path, command surface, and completed plan state.

## [2.0.10] - 2026-05-15

### Changed
- Shortened memory tool prompt descriptions and guidelines to reduce Pi startup context while preserving tool routing semantics.

### Fixed
- Memory search now retries strict zero-hit lexical queries with a bounded relaxed fallback and small Git identity alias set, so noisy queries such as `uga uga bongo git` can still retrieve relevant Git identity memories while exact `AND` search remains the first pass.

## [2.0.9] - 2026-05-14

### Changed
- Compacted turn-start memory guidance to reduce repeated no-hit boilerplate while preserving memory search/write/precedence instructions and adding targeted pi-memory self-description for introspection prompts.

## [2.0.8] - 2026-05-13

### Fixed
- Fixed turn-start memory injection to return Pi's expected custom-message object instead of a plain string, preventing crashes when pi-memory is enabled and injects context.

## [2.0.7] - 2026-05-13

### Added
- Added test coverage for `runTurnIntake` with empty prompt and active handoff (handoff must be injected even before any user input).

## [2.0.6] - 2026-05-13

### Changed
- Migrated repo-level memory from `MEMORY.md` to pi-ext-memory (repo scope); `MEMORY.md` removed.
- Archived completed plan files (`memory-model-minimisation.md`, `memory-scope-simplification.md`) to `docs/archive/plans/`.
- Updated `AGENTS.md` bootstrap sequence and routing rules to reference pi-ext-memory instead of `MEMORY.md`.

## [2.0.4] - 2026-05-13

### Changed
- Introduced shared DDL builder functions (`buildMemoriesTableDdl`, `buildMemoryFtsDdl`, `buildMemoryFtsTriggersDdl`) in `migrations.ts`; v8 migration now references these builders instead of duplicating schema DDL.
- Removed orphaned `artifacts` table and its indexes from v1 migration (fresh DBs only; existing DBs are unaffected).

## [2.0.3] - 2026-05-13

### Changed
- Deleted pass-through module `tool-identity.ts`; formatters moved to `formatters.ts`, identity wrappers inlined into `tool-shell.ts`.

## [2.0.2] - 2026-05-13

### Changed
- Moved all string-builder/formatter functions from `tools.ts` into `formatters.ts`; deleted dead code (`formatMemoryListResults`, `formatActiveList`); removed unused re-export block from `tools.ts`.

## [2.0.1] - 2026-05-13

### Fixed
- `classifyLifecycleAuditFinding` now returns real stale-todo/expired-handoff findings based on `updatedAt` age (was always returning null).
- Cap enforcement extracted from `store.ts` into `checkActiveCap` in `policy.ts`; identical throw behavior.
- Renamed `isActiveUnexpiredHandoff` → `isActiveHandoff` (name was misleading; no expiry check was ever performed).
- Removed no-op `applyMemoryLifecycleDefaults` function.
- Added `staleAfterDays` / `expireAfterDays` thresholds to `MEMORY_POLICY` per kind.
- Audit `runMemoryAuditFull` now surfaces stale todos and expired handoffs in results.

## [2.0.0] - 2026-05-13

### Breaking Changes
- **Schema**: Dropped `expires_at`, `stale_after` columns and `links` table (migration v7). Collapsed `done`/`superseded` status values to `archived`.
- **Kinds**: Reduced from 8 to 2 — `todo` and `handoff` only (migration v8). `progress_snapshot`, `fact`, `preference`, `decision`, `episode`, `artifact_ref` kinds removed.
- **Status**: Only `active` and `archived` remain. Use `archiveReason` for semantic nuance.
- **Fields removed**: `expiresAt`, `staleAfter` removed from all inputs, outputs, store methods, and policy functions.
- **Tools removed**: `memory_archive`, `memory_link`, `memory_list_active_todos`, `memory_list_active_handoffs`.
- **Policy functions removed**: `computeDefaultExpiresAt`, `computeDefaultStaleAfter`, `isTodoStale`, `isHandoffExpired`, `isMemoryExpired`, `isMemoryPastStaleAfter`.
- **`memory_save`**: No longer accepts `kind` or `progress` parameters.
- **`memory_update`**: No longer accepts `expiresAt` parameter.

### Added
- `memory_save_handoff` warns when ≥ 3 active handoffs exist for the same repoPath.
- `memory_audit` writes `lastAuditAt` and `lastAuditSummary` to the meta table after every run.
- `memory_stats` output includes `last_audit` and `last_audit_summary` lines.

## [3.3.14] - 2026-05-13

### Changed
- Removed stale/expired detection references from `memory_audit` promptSnippet and promptGuidelines.
- README active caps table: dropped `Todo stale after` and `Handoff expires after` columns; removed expired-handoff exclusion note.

## [3.3.13] - 2026-05-13

### Added
- `memory_audit` writes `lastAuditAt` and `lastAuditSummary` to the meta table after every run.
- `memory_stats` output now includes `last_audit` and `last_audit_summary` lines from the meta table.

## [3.3.12] - 2026-05-13

### Added
- `memory_save_handoff` now warns when ≥ 3 active handoffs exist for the same repoPath.

## [3.3.11] - 2026-05-13

### Removed
- `expiresAt` and `staleAfter` fields removed from all inputs, outputs, store methods, and policy functions.
- `computeDefaultExpiresAt`, `computeDefaultStaleAfter`, `isTodoStale`, `isHandoffExpired`, `isMemoryExpired`, `isMemoryPastStaleAfter` removed from public API.
- `expiresAt` parameter removed from `memory_update` tool.

## [3.3.10] - 2026-05-13

### Removed
- `memory_archive` tool removed; use `memory_update(status="archived", archiveReason=...)` instead.
- `memory_link` tool and all link-related store methods/types removed.
- `memory_list_active_todos` tool removed; use `memory_list(kind="todo", status="active")` instead.
- `memory_list_active_handoffs` tool removed; use `memory_list(kind="handoff", status="active")` instead.

## [3.3.9] - 2026-05-13

### Removed
- `done` and `superseded` removed from `MEMORY_STATUSES`; only `active` and `archived` are now valid status values in code and validators.
- `memory_stats` no longer tracks `done` counts for `todo` kind.

## [3.3.8] - 2026-05-13

### Removed
- Schema migration v8: reduced memory kinds from 8 to 2 (`todo`, `handoff`); existing records with removed kinds are migrated to kind-less memories; `kind` column is now nullable.
- `memory_save` tool no longer accepts `kind` or `progress` parameters; kind assignment is reserved for dedicated tools (`memory_save_todo`, `memory_save_handoff`).
- Removed all `expires_at` and `stale_after` column references from store and mapper layer; columns were dropped in v7 but store queries still referenced them, causing a runtime crash.


## [3.3.7] - 2026-05-13

### Removed
- Schema migration v7: dropped `expires_at` and `stale_after` columns from `memories` table, dropped `links` table, and collapsed `done`/`superseded` status values to `archived` in existing records.

## [3.3.6] - 2026-05-13

### Changed
- All Pi tool `execute` bodies now delegate store lookup, turn context, identity resolution, and legacy-project notice wrapping to a new `tool-shell` module; individual tools focus on memory operation behavior.
- Runtime status metadata now reports `v3.3.6`.

## [3.3.5] - 2026-05-13

### Changed
- `before_agent_start` now delegates all turn-message orchestration to a new `turn-intake` module; the hook body is reduced to store resolution, the `runTurnIntake` call, and error handling.
- Fixed a silent bug where `buildTurnMemoryMessage` result was used as a string instead of its `.content` property.
- Runtime status metadata now reports `v3.3.5`.

## [3.3.4] - 2026-05-13

### Added
- Added direct regression coverage for the extension runtime store seam, including store reuse, replacement, close idempotence, and `PI_MEMORY_DB_PATH` resolution.

### Changed
- Extension hooks, tools, and commands now share one runtime store seam for SQLite store creation, reuse, and shutdown while preserving DB path behavior.
- Runtime status metadata now reports `v3.3.4`.

## [3.3.3] - 2026-05-13

### Added
- Added direct regression coverage for the lifecycle policy seam, including defaults, cap identity filters, stale/expired classification, and active handoff relevance.

### Changed
- Store lifecycle defaults/cap checks, handoff relevance filtering, and audit stale/expired recommendations now share the core lifecycle policy Module while preserving public tool behavior.
- Runtime status metadata now reports `v3.3.3`.

## [3.3.2] - 2026-05-13

### Added
- Added a core memory identity policy Module with direct regression coverage for scope identity validation, primary identity derivation, and runtime create-input enrichment.

### Changed
- Core list/search validation, Pi tool identity resolution, and runtime memory enrichment now share the same identity policy seam while preserving scope-first behavior and legacy project compatibility.
- Runtime status metadata now reports `v3.3.2`.

## [3.3.1] - 2026-05-13

### Added
- Added focused regression coverage for tool-facing scope identity validation, filtered audit previews, handoff relevance, and retrieval-quality ranking/deduplication.
- Added dedicated scope identity, handoff relevance, and retrieval policy modules to improve locality and agent navigability without changing public tool names.

### Fixed
- Expired active handoffs are now excluded from turn-start handoff preload, `/memory-handoff archive` lookup, and `memory_list_active_handoffs` compatibility listings.
- `memory_save_handoff` coverage now guards against overwriting fallback handoffs from another matching session.

### Changed
- Runtime status metadata now reports `v3.3.1`.
- Archived the completed memory quality review fixing plan.

## [3.3.0] - 2026-05-13

### Added
- ADR 006 documents the normal-vs-advanced tool surface and keeps specialized wrappers callable as compatibility/admin tools.
- `memory_list` now accepts optional `kind` and `scope`, enabling small active catalog/listing flows without requiring specialized active-list tools.
- `memory_update` now supports `archiveReason` with `status="archived"` for normal archive flows.

### Changed
- README and tool descriptions now guide normal agents toward `memory_list` for structured listing and `memory_update` for archiving.
- `memory_list_active_todos`, `memory_list_active_handoffs`, `memory_stats`, `memory_archive`, and `memory_link` are documented as advanced/compatibility tools rather than normal first-choice tools.
- Runtime status metadata now reports `v3.3.0`.

## [3.2.0] - 2026-05-13

### Added
- ADR 005 documents the simplified normal scope model: `global`, `repo`, and `session` for normal agent use, with `project`/`projectId` soft-deprecated as legacy/advanced compatibility.
- `memory_audit` and `/memory-audit` now include a read-only migration preview for legacy project-scoped records, classifying candidates as repo/global/archive/legacy-read-only/needs-human-review without writing changes.

### Changed
- Archived completed or superseded plan documents and kept `docs/plans/` focused on the active scope simplification plan.
- README and Pi tool descriptions now present `global`, `repo`, and `session` as the normal scope model and mark `project`/`projectId` as legacy/advanced compatibility.
- Tool output for explicit `scope="project"` calls now includes a compatibility notice while preserving legacy project-scope behavior.
- Added regression coverage for legacy project-scoped record discoverability without `projectId AND repoPath` filter fragmentation.
- Runtime status metadata now reports `v3.2.0`.

## [3.1.0] - 2026-05-12

### Added
- `memory_audit` and `/memory-audit` now report active scope identity violations, such as missing primary identifiers or identifiers that contradict scope-first identity rules.
- Audit output and tool details now include `identityViolations` for report-only review before any migration.

### Changed
- Runtime status metadata now reports `v3.1.0`.

## [3.0.0] - 2026-05-12

### Added
- ADR 004 documents the new scope-first memory identity policy for `global`, `repo`, `project`, and `session` memories.
- README now documents primary identity per scope and the repo-default behavior.

### Changed
- **Breaking:** `memory_search`, `memory_list`, active-list tools, and `memory_stats` now reject contradictory manual scope filters such as `scope="repo"` plus `projectId`, or `scope="project"` plus `repoPath`, instead of applying accidental `AND` predicates.
- **Breaking:** `memory_save` and `memory_save_todo` now default to `scope="repo"` when running inside a Git repository; outside a Git repository they still default to `scope="global"`.
- Tool handlers now derive the primary identity for single-scope repo/project/session list/search/stat calls from the active runtime context when the caller omits it.
- Runtime status metadata now reports `v3.0.0` and lists all registered memory tools.

## [2.1.0] - 2026-05-12

### Added
- `memory_archive` can now archive handoffs by id, including handoffs created by another Pi session.
- `memory_update` can now change handoff lifecycle fields (`status`, `expiresAt`) while still rejecting handoff content edits that should go through `memory_save_handoff`.

### Changed
- `memory_list_active_handoffs` repo/project lookups now include matching session-scoped handoffs by `repoPath`/`projectId`, preventing relevant cross-session handoffs from being missed.
- Tool prompt guidance now consistently names the intended memory tool for clearer agent routing.
- Runtime status metadata now reports `v2.1.0`.

## [2.0.2] - 2026-05-11

### Changed
- Default SQLite database path moved from `~/.pi/agent/pi-memory.sqlite` to the namespaced state path `~/.pi/agent/state/pi-memory/memory.sqlite`; `PI_MEMORY_DB_PATH` still overrides it.
- First startup with the default path now copies an existing legacy default DB plus SQLite `-wal`/`-shm` sidecars into the new state path when the new DB does not already exist.
- Runtime status metadata now reports `v2.0.2`.

## [2.0.1] - 2026-05-11

### Fixed
- `memory_update`: `scope`, `repoPath`, and `projectId` were silently ignored — they are now patchable via the tool and core `UpdateMemoryInput`.
- `memory_update`: missing not-found guard now returns a clean error instead of a thrown exception when the memory id does not exist.
- `memory_update`: `priority` and `nextAction` parameters added for `kind=todo` memories; passing them on non-todo memories returns a clear error.
- `memory_update` (todo): updating `priority` now rebuilds the summary prefix (`[P0]`/`[P1]`/`[P2]`) and replaces the priority tag consistently, including when an explicit `summary` is also provided.

## [2.0.0] - 2026-05-11

### Added
- New `memory_list_active_todos` tool: lists active todos for a scope (bounded by caps, no pagination needed).
- New `memory_list_active_handoffs` tool: lists active handoffs for a scope (bounded by caps, no pagination needed).
- New `memory_stats` tool: health overview with per-kind counts, cap utilisation, and warnings.
- New `src/core/policy.ts` module: `MEMORY_POLICY` constants with per-scope caps (`activeWarnAt`, `activeHardMax`, `defaultStaleAfterDays`, `defaultTtlDays`).
- `stale_after` column on `memories` table (DB migration v6) with index — enables precise staleness calculation.
- `store.listAllInternal()`: uncapped DB query for internal jobs (audit, handoff lookup). No tool-output limit applies.
- `store.listForTool()`: capped, paginated query returning `{ items, totalCount, hasMore, nextOffset }` for LLM tool outputs.
- `store.count()`: count-only query for cap enforcement and `memory_stats`.
- Cap enforcement in `store.createMemory()`: `todo` and `handoff` saves are rejected when the active hard cap for their scope is reached. Error includes cleanup suggestions.
- Exact-duplicate check in `store.createMemory()`: returns the existing record instead of creating a duplicate when title + summary + kind + scope + context match.
- Default `stale_after` set automatically on `todo` save (scope-specific, default 30 days).
- Default `expires_at` set automatically on `handoff` save (scope-specific, default 14 days).

### Changed
- **Breaking:** `memory_list` now requires `kind` and `scope` as mandatory scalar fields (not optional arrays). Free `memory_list({})` is rejected.
- **Breaking:** `memory_list` response format changed to `{ items, count, total_count, has_more, next_offset }` with pagination metadata. `offset` parameter added (default 0), max `limit` increased from 20 to 50.
- `memory_save_handoff` internal handoff lookup migrated from `listMemories` to `listAllInternal` — no longer subject to tool-output cap.
- Audit (`runMemoryAudit`, `/memory-audit`) migrated to `listAllInternal` — the previous `limit: 1000` workaround is removed; audit is fully uncapped.
- Audit stale-todo detection now uses `stale_after` column (data-driven) instead of hardcoded `updatedAt`-age heuristic.
- Audit expired-handoff detection now uses `expires_at` column instead of hardcoded age.
- Audit output extended with `activeTodosCount`, `activeHandoffsCount`, cap-threshold warnings, and `suggestedActions`.
- `MEMORY_STATUSES` expanded from `["active", "archived"]` to `["active", "archived", "done", "superseded"]`.

## [1.5.0] - 2026-05-11

### Added
- New `kind: progress_snapshot` for project status snapshots (current state, done, next steps, decisions) — prevents Schema-Gravity misrouting to `memory_save_handoff`.
- New `memory_audit` tool and `/memory-audit` CLI command: reports stale todos and old handoffs. Report-only — no auto-archive.
- Stale-item hygiene check runs on every session start (`before_agent_start`): injects a compact warning if stale todos or old handoffs are found. Silent when all is clean.
- SQLite `meta` table (migration v5) for key/value store metadata. `memory_audit` writes `lastAuditAt` after each run.

### Changed
- `memory_save_handoff` now requires `handoffReason` (context_reset|agent_transfer|compaction|session_end) and `resumeInstruction` as mandatory fields, plus optional `recipient`. Makes genuine transfer intent explicit and unattractive for mere status notes.
- `memory_save` promptSnippet and guidelines updated to positively route progress snapshots via `kind=progress_snapshot`.
- `memory_save_handoff` guidelines clarified: not for project status — use `memory_save kind=progress_snapshot`.

## [1.4.0] - 2026-05-11

### Added
- New tool `memory_save_todo` for actionable open tasks with priority (P0/P1/P2), status, scope, and nextAction fields.

### Changed
- Sharpened tool prompts: `memory_save` restricted to facts/preferences/decisions/notes; `memory_search` trigger weakened to avoid double-retrieval; `memory_update` requires known id; `memory_link` restricted to retrieval-relevant relations.
- `memory_save` now redirects `kind: todo` to `memory_save_todo`.
- `memory_save_handoff` label updated to "Memory Save Handoff".

## [1.3.4] - 2026-05-11

### Changed
- Renamed `memory_handoff_save` → `memory_save_handoff` to align with `memory_<verb>_<object>` naming convention.

## [1.3.3] - 2026-05-11

### Fixed
- Replaced `memory ok` / `memory fehler` footer status with `memory ✓` / `memory ✗`.

## [1.3.2] - 2026-05-09

### Changed
- Improved the README for faster human overview, tool discovery, install/upgrade, and configuration guidance.
- Renamed the GitHub/local repository to `pi-ext-memory`; the package/runtime identity remains `pi-memory`.

## [1.3.1] - 2026-05-09

### Changed
- Shortened the Pi footer status to `memory ok` and show `memory fehler` when turn-start retrieval fails.

## [1.3.0] - 2026-05-09

### Added
- Added Handoff V1: `kind: handoff`, `memory_handoff_save`, `/memory-handoff`, and deterministic turn-start preload of the latest matching active handoff before normal retrieval.
- Added session-id filtering to `memory_list` so handoff save/update and retrieval can isolate concurrent Pi instances safely.

### Changed
- `memory_save` now refuses direct `kind: handoff` writes and directs agents to `memory_handoff_save`, preserving one active handoff per session.

## [1.2.0] - 2026-05-04

### Added
- Added `memory_list`, a query-free structured listing tool/API for filtering memories by kind, scope, tags, project, repo, status, limit, and ordering; active memories are the default so active todos can be listed without full-text search terms.

### Changed
- Clarified `memory_search` as content search and updated status/version metadata for v1.2.0.

## [1.1.2] - 2026-04-29

### Changed
- Documented the upgrade flow for local clones that are behind the repo: `git pull`, then `pi update .` or reinstall with `pi install .`.

### Removed
- Removed the repo-local `.pi/extensions/pi-memory/` dev shim so pi-memory loads only through the global/package install path.

### Changed
- `npm run smoke:memory-status` now smoke-tests the globally installed extension instead of the removed repo-local shim.
- Updated package metadata and extension status/version strings for v1.1.2.

## [1.1.1] - 2026-04-28

### Changed
- Shortened the Pi status-line text to `pi-memory v1.1.1 ready`.

## [1.1.0] - 2026-04-28

### Changed
- Hardened retrieval quality by avoiding unscoped staged-search fallback and reusing a single query embedding across staged searches.
- Hardened `/memory-review` so a second invocation quickly clears the review widget.
- Hardened embedding configuration/timeout handling, core/Pi-extension module boundaries, and Pi tool registration test coverage.
- Updated package metadata and extension status/version strings for v1.1.0.

### Fixed
- Blank session ids no longer add a session-scoped turn retrieval stage, preventing broad session-memory retrieval without a real `session_id`.

## [1.0.1] - 2026-04-28

### Fixed
- `/memory-review` now toggles its UI widget off on a second invocation instead of leaving the manual review widget stuck until session shutdown.

### Changed
- Updated package metadata and extension status/version strings for v1.0.1.

## [1.0.0] - 2026-04-28

### Added
- A v0.8.2 local BGE-M3 command embedding adapter behind `PI_MEMORY_BGE_M3_COMMAND`, accepting JSON on stdin and common embedding JSON shapes on stdout without adding a new npm dependency.
- BGE-M3 command safety checks for finite 1024-dimension vectors plus a bounded synchronous timeout configurable with `PI_MEMORY_BGE_M3_TIMEOUT_MS`.
- A Pi package manifest in `package.json` plus a `npm run smoke:package-status` manifest-path smoke check that disables project-local extension discovery to avoid duplicate dev/package loading.
- Test coverage proving default deterministic fallback status and command-produced embedding persistence via a temporary local embedding command.
- Initial repo bootstrap structure aligned with the `agentic-coding` living-doc baseline.
- Root governance and continuity docs: `AGENTS.md`, `MEMORY.md`, `TODO.md`, and `CHANGELOG.md`.
- Documentation folders under `docs/` for ADRs, plans, runbooks, policies, audits, and archive material.
- Initial PRD for the lightweight local memory system under `docs/prd-lightweight-local-memory-system.md`.
- Working V1 Pi extension plan under `docs/plans/pi-extension-v1.md`, covering the proposed tools, commands, hooks, and write policy.
- A v0.1 project-local Pi extension skeleton with a thin local core boundary and a `/memory-status` command stub.
- A repo smoke-run script via `npm run smoke:memory-status`.
- Initial SQLite store initialization and migration mechanism in the local core, including schema v1 for `memories`, `links`, `sessions`, and `artifacts`.
- Core integration tests covering fresh database creation and idempotent re-initialization via `npm test`.
- A first `memory_save` implementation in the local core with validation, normalization, low-information rejection, and persisted readback.
- Pi extension registration for the `memory_save` tool.
- Core tests covering valid create, invalid create, and persisted readback.
- A first lexical retrieval path using SQLite FTS5 plus metadata filters in the local core.
- Pi extension registration for the `memory_search` tool with compact result formatting.
- Core tests covering exact-term retrieval, kind/scope filtering, and result limits.
- A narrow embedding adapter in the local core with deterministic built-in profiles for default and low-footprint operation.
- SQLite schema v3 support for persisted memory embeddings in a dedicated `memory_embeddings` table.
- Core tests covering deterministic embedding persistence, adapter injection, and low-footprint embedding profile selection.
- ADR 001 documenting the v0.5 deterministic embedding baseline and fallback path.
- A v0.6 hybrid retrieval pipeline in the local core that merges lexical FTS5 and vector candidates before application-layer reranking.
- Ranking inputs for `memory_search`, including lexical strength, semantic similarity, scope/context, recency, importance, and confidence.
- Basic near-duplicate suppression in hybrid search results.
- Hybrid retrieval tests covering vector-only matches, ranking behavior, recency tie-breaking, dedupe, and mixed German/English semantic cases via a mock embedding adapter.
- A v0.7 `before_agent_start` retrieval hook in the Pi extension that derives session/project/repo context and injects a compact top-N memory block into the turn.
- Scope-aware runtime enrichment for `memory_save`, so project/repo/session memories inherit current context automatically.
- Session-aware search filtering in the local core, including automatic session-row creation for persisted session-scoped memories.
- Extension-focused tests covering context mapping, staged retrieval planning, and compact top-N injection behavior.
- A v0.8 `memory_update` flow with patch validation, persisted readback, and embedding refresh on content changes.
- A v0.8 `memory_link` flow backed by the existing `links` table, including idempotent link persistence for simple V1 relations.
- A v0.8 `memory_archive` flow that keeps records durable while removing archived items from active retrieval.
- A `/memory-search` command for manual staged retrieval/debugging in the current session/project/repo context.
- Core tests covering patch updates, relations, and archive semantics.
- A global Pi-agent memory DB default at `~/.pi/agent/pi-memory.sqlite`, with `PI_MEMORY_DB_PATH` override for custom storage locations.
- Compact memory trigger guidance in the turn-start injection so agents search before guessing about prior context and save/update durable corrections, decisions, facts, preferences, and todos.
- A read-only `/memory-review` command that shows relevant existing memories plus explicit suggested actions for manual cleanup/save decisions.
- A `/memory-session-save <summary>` command plus minimal core session-summary persistence using the existing `sessions.summary` column.
- Core and extension tests covering explicit session-summary persistence plus review/session-save formatter behavior.
- Command-level end-to-end coverage for the v0.8.1 save -> search -> review -> session-summary flow.

### Changed
- Promoted package metadata, extension status output, README status, and living docs to v1.0.0 after green automated tests and Pi smoke checks.
- The default embedding target is now `local-bge-m3-command` first, with fallback to `builtin-hash-384-v1` when no command is configured; the low-footprint profile remains `builtin-hash-64-v1`.
- Updated package metadata and extension status/version strings for v0.8.2 packaging.
- Documented normal Pi package install/upgrade/smoke flow and WAL-safe migration guidance from repo-local `.pi/pi-memory.sqlite` to `~/.pi/agent/pi-memory.sqlite`.
- Expanded the root `README.md` from a placeholder to a navigable project guide.
- Updated `README.md` with the current extension/core structure, test entry points, and v0.6 implementation status.
- Updated the Pi extension status/reporting strings to reflect v0.8.1 closure and the next packaging-focused step.
- Finalized the V1 manual-first write policy and candidate review flow around explicit saves, read-only review, and explicit session summary persistence.
- Updated `README.md` with the v0.8 status, verification paths, and manual retrieval command smoke check.
- Changed the Pi extension store resolution from repo-local `.pi/pi-memory.sqlite` to a global store while keeping project/repo/session scopes as metadata filters.

### Fixed
- `/memory-status` now toggles its UI widget off on a second invocation instead of leaving the status block stuck above the editor for the rest of the session.
- FTS5 update/delete trigger behavior via schema v4 so memory updates and archives keep the lexical index consistent instead of failing on row updates.

### Breaking
- None.
