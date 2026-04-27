---
role: Project guide
contains: What the repo is, why it exists, navigation, setup expectations, and current direction
not-contains: Detailed decision history, durable agent memory, or active task tracking
write-when: Project orientation, setup, usage, or repo structure changes
---

# pi-memory

A lightweight local memory system for coding agents.

Navigation: `AGENTS.md` (rules and routing), `MEMORY.md` (current state), `TODO.md` (active work), `docs/prd-lightweight-local-memory-system.md` (product direction), `docs/plans/pi-extension-v1.md` (working Pi extension plan).

## Why this repo exists
- Build a super-light local memory layer for coding agents.
- Prioritize local persistence, portability, and low operational overhead.
- Support structured memory objects plus hybrid retrieval instead of raw chat archival.
- Start with Pi integration and keep future MCP/OpenAPI exposure possible.

## Current V1 direction
- Local-first, single-user architecture.
- SQLite as the default storage layer.
- Hybrid retrieval with lexical and semantic search.
- German and English retrieval support.
- Pi-first integration via a Pi extension with a thin local core boundary.

## Repo structure
- `AGENTS.md` - normative agent workflow and routing.
- `MEMORY.md` - stable current truth for the next session.
- `TODO.md` - active backlog only.
- `CHANGELOG.md` - user/operator-visible changes.
- `package.json` - repo scripts, including the current extension smoke run.
- `.pi/extensions/pi-memory/index.ts` - project-local Pi extension entry point.
- `src/core/` - thin local core boundary, including SQLite store initialization, schema migrations, validated memory persistence, patch updates, memory links, archive semantics, hybrid lexical/vector retrieval with application-layer ranking and dedupe, and embedding generation/storage behind a narrow adapter.
- `src/pi-extension/` - Pi-facing extension layer, including the `before_agent_start` retrieval hook, explicit memory tools, compact/manual retrieval helpers, memory trigger guidance, and global DB path resolution.
- `test/core/` - core integration tests.
- `test/pi-extension/` - extension-focused tests for context mapping and compact turn injection.
- `docs/` - PRD, ADRs, plans, runbooks, policies, audits, and archive material.
- `.agents/skills/` - optional repo-local skills.

## Getting started
1. Read `MEMORY.md` for the current state.
2. Read `TODO.md` for active priorities.
3. Read `docs/prd-lightweight-local-memory-system.md` for the V1 product direction.
4. Read `docs/plans/pi-extension-v1.md` for the current proposed Pi integration surface.
5. Add ADRs, plans, or implementation docs under `docs/` as decisions harden.

## Current dev checks
- Run `npm test` to verify fresh-DB initialization, validated memory creation, patch updates, memory linking, archive semantics, lexical retrieval, hybrid retrieval/ranking, session-scoped filtering, embedding persistence, adapter injection, persisted readback, global DB path resolution, and compact retrieval-hook injection behavior.
- Run `npm run smoke:memory-status` to load the extension and invoke `/memory-status` in print mode.
- Run `pi -e ./.pi/extensions/pi-memory/index.ts -p "/memory-search <query>"` to smoke-test the manual staged retrieval command.

## Status
- Repo bootstrap complete.
- Product direction documented.
- v0.1 extension/core skeleton implemented.
- v0.2 SQLite store initialization and schema v1 migration are implemented.
- v0.3 validated `memory_save` persistence is implemented in the local core and exposed through the Pi extension.
- v0.4 lexical retrieval is implemented via SQLite FTS5 with metadata filters and exposed through the Pi extension as `memory_search`.
- v0.5 embedding generation/storage is implemented behind a narrow adapter with deterministic built-in default and low-footprint profiles.
- v0.6 hybrid retrieval is implemented by merging lexical FTS and vector candidates, reranking them in application code, and suppressing near-duplicate matches.
- v0.7 turn-start retrieval is implemented via a `before_agent_start` hook that derives session/project/repo context, injects a compact top-N memory block, and auto-enriches saved scoped memories with runtime context.
- v0.8 adds `memory_update`, `memory_link`, `memory_archive`, `/memory-search`, archive-safe retrieval filtering, and tests covering updates, relations, and archive semantics.
- v0.8.1 development now defaults the extension DB to `~/.pi/agent/pi-memory.sqlite` with `PI_MEMORY_DB_PATH` override, and the turn hook always injects compact memory-use triggers.

## License
See `LICENSE`.
