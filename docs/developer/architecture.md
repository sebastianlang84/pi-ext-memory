---
role: Developer-facing architecture guide for pi-memory
contains: Component boundaries, storage model, runtime integration, testing orientation, and source-of-truth links
not-contains: User command reference, product requirements, changelog history, or active backlog
write-when: Core architecture, module boundaries, storage/runtime seams, or development workflows change
---

# Developer Architecture — pi-memory

pi-memory is a local-first Pi extension with an independent core and a thin Pi integration layer.

## Source layout

```text
src/core/          memory model, validation, migrations, storage, embeddings, retrieval policy
src/pi-extension/  Pi commands, tools, turn-start intake, formatting, runtime-store integration
test/core/         core regression tests
test/pi-extension/ Pi integration and tool/command tests
docs/product/      product intent and scope
docs/user/         user-facing usage and configuration
docs/adr/          durable architecture decisions
```

## Core boundary

`src/core/` owns the portable memory system:

- memory input normalization and validation,
- scope identity policy,
- lifecycle and cap policy,
- SQLite schema migrations,
- SQLite store operations,
- embedding generation and query embedding content,
- hybrid lexical/vector search and ranking,
- session summary persistence.

The core should remain usable without Pi-specific command or UI concepts.

## Pi extension boundary

`src/pi-extension/` adapts the core to Pi:

- registers commands and tools,
- resolves runtime context from cwd and Pi session id,
- manages the active SQLite store for the extension runtime,
- formats command/tool output,
- injects compact turn-start memory context,
- exposes audit and handoff flows.

Pi-specific modules should delegate policy decisions to `src/core/` rather than duplicating them.

## Storage

The default store is one local SQLite database at:

```text
~/.pi/agent/state/pi-memory/memory.sqlite
```

`PI_MEMORY_DB_PATH` overrides the database path. With the default path, startup performs a one-time copy from the legacy default `~/.pi/agent/pi-memory.sqlite` when needed, including SQLite `-wal` and `-shm` sidecars.

Current schema state is tracked by `LATEST_MEMORY_SCHEMA_VERSION` in `src/core/migrations.ts` and reported through `createMemoryCore().getStatus()`.

## Embeddings and retrieval

The embedding path is local-first:

- optional BGE-M3 command adapter via `PI_MEMORY_BGE_M3_COMMAND`,
- bounded timeout via `PI_MEMORY_BGE_M3_TIMEOUT_MS`,
- deterministic built-in fallback when no command is configured.

Search combines SQLite FTS, vector similarity, scope/context matching, recency, importance, confidence, and lexical/tag signals. Exact tag and `metadata.canonicalKey` matches are internal ranking signals; they do not add prompt-facing tools or turn-start text.

## Tool surface

The normal tool path is intentionally small:

- `memory_search`,
- `memory_list`,
- `memory_save`,
- `memory_save_todo`,
- `memory_save_handoff`,
- `memory_update`,
- `memory_audit`,
- `memory_tag_catalog`.

`memory_tag_catalog` is read-only and derives tag inventory from active memories on demand; it does not write audit metadata or maintain a separate authoritative tag table.

`memory_stats` remains callable as an advanced/admin health and capacity tool, not as a normal first-choice agent path.

The durable decision is documented in [ADR 006](../adr/006-normal-and-advanced-tool-surface.md). The minimized memory model is documented in [ADR 007](../adr/007-memory-model-minimisation.md).

## Token injection footprint

Run the dependency-free prompt footprint check when tool metadata, tool schemas, or turn-start memory text changes:

```bash
npm run check:token-injection
```

The check reports estimated tokens and char counts for registered tool prompt metadata, tool schema strings, and representative turn-start memory injections. Regression limits are guardrails only; the target is still as little injected text as possible. The estimate is intentionally simple (`ceil(normalized chars / 4)`) so the check stays local-first and dependency-light.

## Version metadata

For release-relevant commits, keep these in sync:

- `package.json` version,
- `package-lock.json` root package version,
- `src/core/memory-core.ts` runtime status version,
- `CHANGELOG.md` release entry.

## Verification

Use the smallest relevant check for the change. Common checks:

```bash
npm test
npm run check:token-injection
git diff --check
```

For Pi package or runtime status changes, also consider:

```bash
npm run smoke:package-status
npm run smoke:memory-status
```

Only run smoke checks when the local Pi environment is expected to be healthy.
