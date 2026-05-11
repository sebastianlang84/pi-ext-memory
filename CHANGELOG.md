---
role: Curated outward-facing repo change history
contains: User/operator-relevant changes using Keep a Changelog categories
not-contains: Internal scratch notes, standing defaults, or current-state snapshots
write-when: A user/operator-relevant repo change is introduced
---

# Changelog

All notable user/operator-relevant changes are documented in this file.
This changelog follows the Keep a Changelog format.

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
