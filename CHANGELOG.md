---
role: Curated outward-facing repo change history
contains: User/operator-relevant changes using Keep a Changelog categories
not-contains: Internal scratch notes, standing defaults, or current-state snapshots
write-when: A user/operator-relevant repo change is introduced
---

# Changelog

All notable user/operator-relevant changes are documented in this file.
This changelog follows the Keep a Changelog format.

## [Unreleased]

### Added
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

### Changed
- Expanded the root `README.md` from a placeholder to a navigable project guide.
- Updated `README.md` with the current extension/core structure, test entry points, and v0.6 implementation status.
- Updated the Pi extension status/reporting strings to reflect v0.8 update/link/archive readiness and the next v0.8.1 implementation slice.
- Updated `README.md` with the v0.8 status, verification paths, and manual retrieval command smoke check.

### Fixed
- `/memory-status` now toggles its UI widget off on a second invocation instead of leaving the status block stuck above the editor for the rest of the session.
- FTS5 update/delete trigger behavior via schema v4 so memory updates and archives keep the lexical index consistent instead of failing on row updates.

### Breaking
- None.
