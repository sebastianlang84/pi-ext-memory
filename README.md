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
- `package.json` - Pi package manifest plus local test/smoke scripts.
- `.pi/extensions/pi-memory/index.ts` - project-local dev extension entry point.
- `src/pi-extension/index.ts` - packaged Pi extension entry point referenced by the `pi` manifest.
- `src/core/` - thin local core boundary, including SQLite store initialization, schema migrations, validated memory persistence, patch updates, memory links, archive semantics, hybrid lexical/vector retrieval with application-layer ranking and dedupe, and embedding generation/storage behind a narrow adapter.
- `src/pi-extension/` - Pi-facing extension layer, including the `before_agent_start` retrieval hook, explicit memory tools, compact/manual retrieval helpers, read-only review/session-summary commands, memory trigger guidance, and global DB path resolution.
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

## Install / upgrade / smoke
- Install as a normal Pi package from this repo: `pi install /absolute/path/to/pi-memory` or `pi install .`.
- Upgrade a prior install from the same source with `pi update /absolute/path/to/pi-memory` or by reinstalling the local path after pulling changes.
- Smoke-test the packaged manifest path with `npm run smoke:package-status`.
- Keep the existing project-local dev entry point smoke check via `npm run smoke:memory-status`.

## Embedding configuration
- Default profile now targets a local BGE-M3 command adapter first via `PI_MEMORY_BGE_M3_COMMAND`.
- The command receives JSON on stdin as `{"input": {"title", "summary", "body", "tags"}}` and must print JSON containing one 1024-dimension embedding vector.
- Accepted stdout shapes: a raw vector array, `{"embedding": [...]}`, `{"embeddings": [...]}`, or OpenAI-style `{"data":[{"embedding":[...]}]}`.
- The command has a default synchronous timeout of 15s; override with `PI_MEMORY_BGE_M3_TIMEOUT_MS` if local hardware needs a different bound.
- If `PI_MEMORY_BGE_M3_COMMAND` is unset, the default path falls back to the built-in deterministic `builtin-hash-384-v1`; the low-footprint profile remains `builtin-hash-64-v1`.

## Migration from old repo-local DBs
- Older dev setups may still have `.pi/pi-memory.sqlite` inside a repo.
- The extension now defaults to the global store at `~/.pi/agent/pi-memory.sqlite`.
- To keep old data, stop Pi first, then copy the DB with a safe SQLite backup/copy flow; if copying files directly, include `.pi/pi-memory.sqlite`, `.pi/pi-memory.sqlite-wal`, and `.pi/pi-memory.sqlite-shm` when present.
- Place the resulting DB at `~/.pi/agent/pi-memory.sqlite` before first packaged use, or point Pi at the old file explicitly with `PI_MEMORY_DB_PATH=/path/to/.pi/pi-memory.sqlite` during migration.

## Current dev checks
- Run `npm test` to verify fresh-DB initialization, validated memory creation, patch updates, memory linking, archive semantics, lexical retrieval, hybrid retrieval/ranking, session-scoped filtering, explicit session-summary persistence, save -> search -> review -> session-summary coverage, embedding persistence, command-adapter fallback/storage, adapter injection, persisted readback, global DB path resolution, and compact retrieval-hook injection behavior.
- Run `npm run smoke:package-status` to load the package via its Pi manifest and invoke `/memory-status` in print mode.
- Run `npm run smoke:memory-status` to load the project-local dev extension entry point and invoke `/memory-status` in print mode.
- Run `pi -e . -p "/memory-search <query>"` to smoke-test the packaged manual staged retrieval command.
- Run `pi -e . -p "/memory-review"` to inspect the read-only review helper in the current session context.
- Run `pi -e . -p "/memory-session-save <summary>"` to persist an explicit compact summary into the current session row.

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
- v1.0.0 is closed: pi-memory now ships the local-first Pi extension surface, SQLite-backed memory store, hybrid retrieval, turn-start context injection, manual review/session-summary commands, package manifest, and local BGE-M3 command adapter with deterministic fallback. The lightweight fallback remains shipped while real-machine BGE-M3 latency/quality observations accumulate.

## License
See `LICENSE`.
