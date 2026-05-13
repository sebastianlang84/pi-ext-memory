---
role: Primary bootstrap document for follow-up agent sessions
contains: Current state, long-term memory, recent tasks, open decisions, next steps, and durable risks
not-contains: Rules, procedural runbooks, or diary-style work logs
write-when: Stable truth, project state, open decisions, next steps, or durable risks change
---

# MEMORY

last_updated: 2026-05-13
scope: always-loaded bootstrap; keep lean

## 1) Current State
- GitHub/local repo identity is `pi-ext-memory`; package/runtime identity remains `pi-memory`, a lightweight local memory system for coding agents.
- Root living docs and `docs/` baseline were aligned to the `~/agentic-coding` governance structure.
- Product direction for V1 is documented in `docs/prd-lightweight-local-memory-system.md`.
- The original Pi Extension V1 working plan is archived at `docs/archive/plans/pi-extension-v1.md`; the scope-first identity implementation plan is archived at `docs/archive/plans/memory-scope-identity.md`; the lifecycle/tooling design plan is archived at `docs/archive/plans/tool-and-lifecycle-design.md`; the completed memory quality review fixing plan is archived at `docs/archive/plans/memory-quality-review-fixing-plan.md`; current active planning lives in `docs/plans/architecture-deepening.md`.
- The historical project-local Pi extension shim under `.pi/extensions/pi-memory/` has been removed; pi-memory is intended to load once via the global Pi package install, backed by the thin local core under `src/core/` and Pi-facing modules under `src/pi-extension/`.
- The local core now supports SQLite store initialization, schema migrations via `PRAGMA user_version`, schema v2 FTS5 lexical indexing, schema v3 persisted embeddings, and schema v4 FTS trigger fixes for reliable memory updates/archives.
- v0.3 implemented validated memory creation: the core normalizes and persists memory records with immediate readback, and the Pi extension registers a `memory_save` tool.
- v0.4 is now implemented for lexical retrieval: the core supports metadata-filtered FTS5 search with compact result shaping, and the Pi extension now registers a `memory_search` tool.
- v0.5 now adds embedding generation/storage behind a narrow adapter: schema v3 persists embeddings in `memory_embeddings`, the store supports injected adapters, and the built-in deterministic profiles are `builtin-hash-384-v1` (default) and `builtin-hash-64-v1` (low-footprint fallback).
- v0.6 now implements hybrid retrieval in the local core: lexical FTS candidates and vector candidates are merged and reranked in application code using lexical/semantic match, scope/context, recency, importance, and confidence.
- v0.6 also adds basic near-duplicate suppression for search results and ranking-focused hybrid retrieval tests, including mixed German/English semantic cases via a mock embedding adapter.
- v0.7 now implements the Pi `before_agent_start` retrieval hook: the extension derives session/project/repo context from the active Pi session, runs staged retrieval, and injects a compact top-N memory block into the turn.
- v0.7 also auto-enriches `memory_save` writes for scoped memories with runtime project/repo/session context, and the core now supports session-aware filtering plus automatic `sessions` row creation when session-scoped memories are persisted.
- v0.8 now implements `memory_update`, `memory_link`, and `memory_archive` in the local core and registers the corresponding Pi tools plus `/memory-search`.
- v0.8 also adds patch/update embedding refresh, idempotent memory relations, archive-safe retrieval filtering, and a schema v4 fix for FTS update/delete triggers.
- v0.8.1 now adds compact turn-start memory triggers even when no memories match: search before guessing about prior/project/workflow context, and save/update durable corrections, decisions, facts, preferences, and todos.
- v0.8.1 also adds `/memory-review` as a read-only/manual review helper plus `/memory-session-save <summary>` for explicit session recap persistence into the existing `sessions.summary` column, with the manual-first write policy and candidate review flow finalized.
- The Pi extension now defaults to a namespaced global state store at `~/.pi/agent/state/pi-memory/memory.sqlite` with `PI_MEMORY_DB_PATH` override; on first default-path startup it copies an existing legacy `~/.pi/agent/pi-memory.sqlite` DB and SQLite sidecars into the new state path when the new DB is absent; project/repo/session scopes remain metadata filters instead of separate repo-local databases.
- v0.8.2 targets a real local BGE-M3 command adapter first via `PI_MEMORY_BGE_M3_COMMAND`, synchronously piping JSON on stdin, accepting common embedding JSON stdout shapes, enforcing finite 1024d vectors plus a bounded timeout, and falling back to the built-in deterministic 384d profile when no command is configured; the low-footprint profile remains deterministic 64d.
- v1.0.0 is closed as the first stable local-first Pi extension release after green automated tests and Pi smoke checks; no v0.8.3 debug release was needed.
- v1.0.1 fixes `/memory-review` UI behavior so running the command a second time clears the review widget instead of leaving it stuck until session shutdown.
- v1.1.0 closes the post-v1 quality hardening pass: staged retrieval now avoids unscoped fallback injection, reuses a single query embedding across stages, skips blank session IDs, clears `/memory-review` before DB/search work, separates core search and row-mapping helpers from the store, exposes injectable embedding command config with timeout tests, and splits Pi tool registration into a focused module with executor coverage.
- v1.1.2 documents the clone-behind upgrade flow for local installs: `git pull`, then `pi update .` or reinstall with `pi install .`.
- v1.2.0 adds `memory_list` for query-free structured memory listing/filtering; `memory_search` remains content search.
- v1.3.0 adds Handoff V1: `kind: handoff`, `memory_handoff_save`, `/memory-handoff`, one active handoff per session, session-safe save/update behavior for concurrent Pi instances, and deterministic latest matching active handoff preload ahead of normal turn retrieval.
- v3.0.0 adopts scope-first memory identity: `global` has no identity, `repo` uses `repoPath`, `project` uses `projectId`, and `session` uses `sessionId`; tool/core validation now rejects contradictory manual filters to avoid `project_id AND repo_path` fragmentation, while runtime enrichment may still store extra metadata.
- v3.1.0 extends `memory_audit` and `/memory-audit` with report-only scope identity findings for active records that miss primary identifiers or carry identifiers contradicting their scope.
- v3.2.0 extends `memory_audit` and `/memory-audit` with a read-only migration preview that classifies active legacy project-scoped records before any approved migration.
- v3.3.0 simplifies the recommended agent-facing tool path: `memory_list` now covers optional kind/scope catalog-style listing, `memory_update(status="archived", archiveReason=...)` covers normal archiving, and specialized wrappers remain callable as advanced/compatibility tools.
- v3.3.1 completes the memory quality review fixing pass: scope identity and handoff relevance now have dedicated Pi-extension modules, retrieval ranking constants live behind a default policy module, expired active handoffs are excluded from preload/archive/list flows, and regression coverage was added for tool validation, audit filters, handoff ordering, and retrieval quality.
- v3.3.2 deepens memory identity policy: core list/search validation, Pi tool identity resolution, and runtime create-input enrichment now share one core identity policy Module while preserving scope-first behavior and legacy project compatibility.
- v3.3.3 deepens memory lifecycle policy: store lifecycle defaults/cap checks, handoff relevance, and audit stale/expired recommendations now share one core lifecycle policy Module while preserving public behavior.
- v3.3.6 deepens the Pi tool execution shell: all tool `execute` bodies now delegate store lookup, turn context, identity resolution, and legacy-project notice wrapping to a focused `tool-shell` module, so individual tools focus on memory operation behavior.
- v3.3.5 deepens the turn intake seam: `before_agent_start` now delegates all turn-message orchestration (context derivation, handoff lookup, staged retrieval, hygiene assembly) to a focused `turn-intake` module; also fixes a silent bug where `buildTurnMemoryMessage` result was used as a string object instead of `.content`.
- v3.3.4 deepens the extension runtime store seam: hooks, tools, and commands now share one Pi-extension runtime store Module for SQLite store creation, reuse, replacement, and shutdown while preserving DB path behavior.
- `package.json` now exposes a normal Pi package manifest pointing at `src/pi-extension/index.ts`; smoke scripts cover the global install path and package manifest path without relying on a project-local dev shim.
- ADR 001 records the v0.5 embedding baseline decision; ADR 002 records the global memory store default; ADR 004 records scope-first memory identity; ADR 005 records the simplified normal scope model and soft-deprecates `project`/`projectId` for normal agent-facing use; ADR 006 records the normal-vs-advanced tool surface.
- Verification paths now exist via `npm test` for fresh DB, migration, save-validation, persisted-readback, lexical retrieval, session-filtered retrieval, hybrid retrieval/ranking, handoff save/preload behavior, patch updates, relations, archive semantics, embedding persistence, retrieval-hook injection checks, command-level handoff/review/session-summary checks, save -> search -> review -> session-summary end-to-end coverage, default embedding fallback status, and command-backed embedding persistence, plus global/package smoke checks with `npm run smoke:memory-status` and `npm run smoke:package-status`, and manual `/memory-search` and `/memory-handoff` smoke paths for the extension.
- Current V1 direction from the PRD and plan: local-first, single-user, SQLite-based, hybrid retrieval, Pi-first extension surface, thin local core boundary, no heavy server infrastructure.

## 2) Long-Term Memory
- Primary product goal: durable, local, structured memory for coding agents rather than raw chat archival.
- V1 must support German and English retrieval.
- V1 target integration is Pi first; later exposure via MCP or OpenAPI should stay possible.
- Retrieval quality matters more than aggressive auto-save volume.
- `pi-memory` should be globally useful across repos; avoid designs that fragment durable memory into per-repo databases by default.

## 3) Recent Tasks
- 2026-05-13 — Completed memory-model-minimisation Slice 5: removed expiresAt/staleAfter from all inputs, outputs, store methods, policy functions, and tools; bumped to v3.3.11.
- 2026-05-13 — Completed memory-model-minimisation Slice 4: removed `memory_archive`, `memory_link`, `memory_list_active_todos`, `memory_list_active_handoffs` tools; removed all link-related store methods, types, and exports; updated available-tools list and formatters; bumped package to v3.3.10.
- 2026-05-13 — Completed memory-model-minimisation Slice 3: removed `done` and `superseded` from `MEMORY_STATUSES` (now `active`+`archived` only), updated `memory_stats` tool description and kindStatuses, updated handoff test to use `archived` instead of `superseded`, updated lifecycle-policy test; bumped package metadata to v3.3.9.
- 2026-05-13 — Completed memory-model-minimisation Slice 2: added schema migration v8 making `kind` nullable, migrated removed kinds to NULL, reduced MEMORY_KINDS to `["todo","handoff"]`, removed `kind`/`progress` from `memory_save`, updated migration runner for FK-safe table recreation; bumped package metadata to v3.3.8.
- 2026-05-13 — Completed memory-model-minimisation Slice 1: added schema migration v7 that drops `expires_at`, `stale_after`, `links` table, and collapses `done`/`superseded` → `archived`; bumped package metadata to v3.3.7.
- 2026-04-16 — Bootstrapped repo living-doc structure and added the initial PRD under `docs/`.
- 2026-04-16 — Added `docs/plans/pi-extension-v1.md` with the proposed V1 extension tools, commands, hooks, and write-policy shape.
- 2026-04-16 — Implemented the v0.1 Pi extension/core bootstrap skeleton with a working `/memory-status` smoke path.
- 2026-04-16 — Implemented v0.2 SQLite store initialization, schema v1 migrations, and core integration tests.
- 2026-04-16 — Implemented v0.3 validated `memory_save` persistence with normalized writes, low-information rejection, persisted readback, and Pi tool registration.
- 2026-04-16 — Implemented v0.4 lexical retrieval with schema v2 FTS5 indexing, metadata filters, compact `memory_search` results, and retrieval-focused tests.
- 2026-04-16 — Implemented v0.5 embedding generation/storage with schema v3, a narrow adapter boundary, deterministic built-in default/fallback profiles, and adapter-focused tests.
- 2026-04-16 — Implemented v0.6 hybrid retrieval with lexical/vector candidate merging, application-layer ranking inputs, basic dedupe, Pi result formatting updates, and multilingual ranking-focused tests.
- 2026-04-16 — Implemented v0.7 turn-start retrieval with Pi `before_agent_start` injection, scope-aware runtime context mapping/enrichment, session-aware filtering, and compact injection-focused tests.
- 2026-04-17 — Implemented v0.8 memory updates, links, archive semantics, the `/memory-search` command, schema v4 FTS trigger fixes, and v0.8 verification coverage.
- 2026-04-27 — Added explicit turn-start memory triggers and switched the extension default DB to the global Pi-agent memory store.
- 2026-04-27 — Implemented `/memory-review`, `/memory-session-save`, and explicit session summary persistence via `sessions.summary`.
- 2026-04-27 — Closed v0.8.1 by finalizing the manual-first review flow, adding save -> search -> review -> session-summary end-to-end coverage, and setting package metadata to `0.8.1`.
- 2026-04-27 — Closed v0.8.2 by adding the local `PI_MEMORY_BGE_M3_COMMAND` adapter, shipping a Pi package manifest, and documenting install/upgrade/smoke plus repo-local -> global DB migration.
- 2026-04-28 — Closed v1.0.0 after `npm test`, `npm run smoke:memory-status`, and `npm run smoke:package-status` passed; `PI_MEMORY_BGE_M3_COMMAND` was not configured, so validation covered the deterministic fallback path.
- 2026-04-28 — Closed v1.0.1 by making `/memory-review` toggle/clear its UI widget and rerunning `npm test`, `npm run smoke:memory-status`, and `npm run smoke:package-status`.
- 2026-04-28 — Closed v1.1.0 for the post-v1 quality hardening pass with worker/reviewer subagents; final verification passed with `npm test` (44/44), `npm run smoke:memory-status`, and `npm run smoke:package-status`.
- 2026-04-28 — Removed the repo-local `.pi/extensions/pi-memory/` dev shim after installing pi-memory globally, and repointed `npm run smoke:memory-status` at the global extension path.
- 2026-04-28 — Bumped pi-memory to v1.1.1 and shortened the Pi status-line text.
- 2026-04-29 — Bumped pi-memory to v1.1.2 and documented the local clone upgrade flow.
- 2026-05-04 — Added `memory_list` so agents can list/filter active todos and other structured memories without relying on full-text query matches; bumped package/status metadata to v1.2.0.
- 2026-05-09 — Added Handoff V1 with `memory_handoff_save`, `/memory-handoff`, session-isolated active handoff updates, latest handoff turn-start preload, and v1.3.0 status/package metadata.
- 2026-05-12 — Added ADR 004 and implemented v3.0.0 scope-first identity validation/defaults to avoid `projectId`/`repoPath` filter fragmentation.
- 2026-05-12 — Added v3.1.0 report-only scope identity findings to `memory_audit` and `/memory-audit`.
- 2026-05-13 — Completed the first docs plan inventory pass and archived the historical/superseded Pi Extension V1, scope-first identity, and tool/lifecycle plans under `docs/archive/plans/`.
- 2026-05-13 — Accepted ADR 005: normal agent-facing scopes are `global`, `repo`, and `session`; `project`/`projectId` are soft-deprecated for normal use while legacy records remain discoverable.
- 2026-05-13 — Updated README and Pi tool descriptions to present `global`/`repo`/`session` as the normal scope model and mark `project`/`projectId` as legacy/advanced compatibility.
- 2026-05-13 — Added compatibility notices for explicit `scope="project"` tool calls while keeping legacy project-scoped reads/writes accepted.
- 2026-05-13 — Added regression coverage proving legacy project-scoped records remain discoverable by `projectId` alone without adding `repoPath` to project-scope retrieval.
- 2026-05-13 — Extended `memory_audit` and `/memory-audit` with a read-only migration preview that classifies active legacy project-scoped records as repo/global/archive/legacy-read-only/needs-human-review candidates and bumped package/runtime metadata to v3.2.0.
- 2026-05-13 — Accepted ADR 006 and simplified the recommended tool surface for v3.3.0: normal listing goes through `memory_list`, normal archiving goes through `memory_update`, and specialized wrappers are advanced/compatibility only.
- 2026-05-13 — Completed the memory quality review fixing plan for v3.3.1: added focused regression tests, extracted scope identity and handoff relevance seams, localized the default retrieval policy, excluded expired handoffs from active relevance flows, archived the plan, and cleared the TODO item.
- 2026-05-13 — Added `docs/plans/architecture-deepening.md` and linked its five-slice refactor queue from `TODO.md`.
- 2026-05-13 — Completed architecture-deepening slice 1: added the core memory identity policy Module, routed core/Pi/runtime identity handling through it, added policy-level tests, removed the completed TODO slice, and bumped package/runtime metadata to v3.3.2.
- 2026-05-13 — Completed architecture-deepening slice 2: deepened the core memory lifecycle policy Module, routed store defaults/caps plus audit/handoff classification through it, added lifecycle policy/store tests, removed the completed TODO slice, and bumped package/runtime metadata to v3.3.3.
- 2026-05-13 — Completed architecture-deepening slice 5: added the `tool-shell` Pi-extension module, extracted common execution mechanics from all 12 tool `execute` bodies, added 5 tool-shell tests, removed the last TODO slice, and bumped package/runtime metadata to v3.3.6; Architecture Deepening Program complete.
- 2026-05-13 — Completed architecture-deepening slice 4: added the `turn-intake` Pi-extension module, extracted all turn-message orchestration from `before_agent_start`, fixed the `buildTurnMemoryMessage` object-vs-string bug, added 5 turn-intake tests, removed the completed TODO slice, and bumped package/runtime metadata to v3.3.5.
- 2026-05-13 — Completed architecture-deepening slice 3: added the Pi-extension runtime store Module, routed extension hooks/tools/commands through one store lifecycle seam, added runtime-store tests, removed the completed TODO slice, and bumped package/runtime metadata to v3.3.4.
- 2026-04-30 — Renamed the GitHub/local repository from `pi-memory` to `pi-ext-memory`; package/runtime names remain `pi-memory`.

## 4) Open Decisions
- Whether a post-V1 runtime should remain a pure local library or grow into a small localhost service if future evidence requires it.
- How much post-V1 memory creation should become assisted beyond the current manual-first write policy.

## 5) Next Steps
1. Continue memory-model-minimisation v2.0.0: next is Slice 6 — Handoff count warning.
2. Monitor real-machine BGE-M3 command-adapter retrieval quality and latency in normal use; keep the shipped deterministic fallback unless evidence supports a different lighter semantic fallback.
3. Keep the runtime-boundary decision explicit as an ADR if later evidence pushes beyond the current in-process extension plan.

## 6) Known Risks / Blockers
- Application-layer vector search may need a specialized local index if stores grow much larger.
- `node:sqlite` is currently experimental in this Node runtime.
- Local embedding latency on weaker machines.
- Memory quality can degrade quickly if write policy is too permissive.
