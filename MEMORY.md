---
role: Primary bootstrap document for follow-up agent sessions
contains: Current state, long-term memory, recent tasks, open decisions, next steps, and durable risks
not-contains: Rules, procedural runbooks, or diary-style work logs
write-when: Stable truth, project state, open decisions, next steps, or durable risks change
---

# MEMORY

last_updated: 2026-04-28
scope: always-loaded bootstrap; keep lean

## 1) Current State
- Repo initialized for `pi-memory`, a lightweight local memory system for coding agents.
- Root living docs and `docs/` baseline were aligned to the `~/agentic-coding` governance structure.
- Product direction for V1 is documented in `docs/prd-lightweight-local-memory-system.md`.
- A working Pi integration plan now exists in `docs/plans/pi-extension-v1.md`.
- A v0.1 project-local Pi extension skeleton now exists under `.pi/extensions/pi-memory/`, backed by a thin local core under `src/core/` and Pi-facing modules under `src/pi-extension/`.
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
- The Pi extension now defaults to a global store at `~/.pi/agent/pi-memory.sqlite` with `PI_MEMORY_DB_PATH` override; project/repo/session scopes remain metadata filters instead of separate repo-local databases.
- v0.8.2 targets a real local BGE-M3 command adapter first via `PI_MEMORY_BGE_M3_COMMAND`, synchronously piping JSON on stdin, accepting common embedding JSON stdout shapes, enforcing finite 1024d vectors plus a bounded timeout, and falling back to the built-in deterministic 384d profile when no command is configured; the low-footprint profile remains deterministic 64d.
- v1.0.0 is closed as the first stable local-first Pi extension release after green automated tests and Pi smoke checks; no v0.8.3 debug release was needed.
- v1.0.1 fixes `/memory-review` UI behavior so running the command a second time clears the review widget instead of leaving it stuck until session shutdown.
- `package.json` now exposes a normal Pi package manifest pointing at `src/pi-extension/index.ts`, with both dev-entry and package-path smoke scripts; the package smoke script disables project-local extension discovery to avoid loading the dev shim twice.
- ADR 001 records the v0.5 embedding baseline decision; ADR 002 records the global memory store default.
- Verification paths now exist via `npm test` for fresh DB, migration, save-validation, persisted-readback, lexical retrieval, session-filtered retrieval, hybrid retrieval/ranking, patch updates, relations, archive semantics, embedding persistence, retrieval-hook injection checks, command-level review/session-summary checks, save -> search -> review -> session-summary end-to-end coverage, default embedding fallback status, and command-backed embedding persistence, plus `npm run smoke:memory-status`, `npm run smoke:package-status`, and a manual `/memory-search` smoke run for the extension.
- Current V1 direction from the PRD and plan: local-first, single-user, SQLite-based, hybrid retrieval, Pi-first extension surface, thin local core boundary, no heavy server infrastructure.

## 2) Long-Term Memory
- Primary product goal: durable, local, structured memory for coding agents rather than raw chat archival.
- V1 must support German and English retrieval.
- V1 target integration is Pi first; later exposure via MCP or OpenAPI should stay possible.
- Retrieval quality matters more than aggressive auto-save volume.
- `pi-memory` should be globally useful across repos; avoid designs that fragment durable memory into per-repo databases by default.

## 3) Recent Tasks
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

## 4) Open Decisions
- Whether a post-V1 runtime should remain a pure local library or grow into a small localhost service if future evidence requires it.
- How much post-V1 memory creation should become assisted beyond the current manual-first write policy.

## 5) Next Steps
1. Monitor real-machine BGE-M3 command-adapter retrieval quality and latency in normal use; keep the shipped deterministic fallback unless evidence supports a different lighter semantic fallback.
2. Keep the runtime-boundary decision explicit as an ADR if later evidence pushes beyond the current in-process extension plan.

## 6) Known Risks / Blockers
- Application-layer vector search may need a specialized local index if stores grow much larger.
- `node:sqlite` is currently experimental in this Node runtime.
- Local embedding latency on weaker machines.
- Memory quality can degrade quickly if write policy is too permissive.
