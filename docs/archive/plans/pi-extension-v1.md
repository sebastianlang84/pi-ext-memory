---
role: Historical archived plan for the Pi extension V1 surface
contains: Historical proposed extension shape, tool and command surface, event hooks, write policy defaults, and implementation slices
not-contains: Current implementation instructions, active tasks, or source-of-truth tool behavior
write-when: Historical status or archive routing changes
---

# Plan — Pi Extension V1

## 1. Purpose

This document made the V1 Pi integration concrete enough to implement in small steps.

Status: archived/superseded by implementation and accepted ADRs.

> Archived note: this document is historical planning context. Current behavior is defined by code, `README.md`, `TODO.md`, and accepted ADRs; stale mentions inside this plan are not active guidance.

## 2. Planning Position

For planning purposes, V1 is treated as:

- a **Pi extension** as the user-facing integration surface,
- with an **in-process local core** behind it,
- and **no localhost service by default** in the first implementation.

Reasoning:

- Pi extensions are the native Pi integration mechanism.
- V1 should stay local-first and lightweight.
- A separate service is not needed to validate memory quality.
- The core should still be written behind a narrow interface so later MCP/OpenAPI exposure remains possible.

## 3. V1 Responsibilities Split

### 3.1 Pi extension layer

Responsible for:

- registering Pi tools,
- registering a small set of Pi commands,
- reacting to Pi lifecycle events,
- injecting retrieved memory context into the current turn,
- mapping Pi session/repo context into memory filters,
- rendering concise tool results for the model and user.

### 3.2 Local core layer

Responsible for:

- SQLite access,
- FTS5 indexing,
- vector storage/querying,
- hybrid retrieval and ranking,
- memory validation and normalization,
- import/export and migrations.

### 3.3 Boundary rule

The extension should depend on a small internal interface such as:

- `searchMemories(input)`
- `createMemory(input)`
- `updateMemory(input)`
- `linkMemories(input)`
- `archiveMemory(input)`
- `saveSessionSummary(input)`

The extension should **not** contain SQL or ranking logic directly.

## 4. Proposed V1 Extension Surface

### 4.1 LLM-callable tools

These are the core tools the Pi extension should register first.

### `memory_search`

Purpose:
- Retrieve relevant memories for the current user request.

Inputs:
- `query`
- optional `kind[]`
- optional `scope[]`
- optional `tags[]`
- optional `projectId`
- optional `repoPath`
- optional `limit`

Output:
- compact ranked results with `id`, `kind`, `scope`, `title`, `summary`, score hints, and optional source refs.

Notes:
- This is the most important tool.
- Output should be aggressively compact to protect context quality.

### `memory_save`

Purpose:
- Create a new structured memory.

Inputs:
- `kind` (`fact`, `preference`, `decision`, `episode`, `artifact_ref`, `todo`)
- `scope` (`global`, `project`, `repo`, `session`)
- `title`
- `summary`
- optional `body`
- optional `tags[]`
- optional `importance`
- optional `confidence`
- optional `artifactRefs[]`

Output:
- created `id` plus normalized metadata.

Notes:
- `summary` should be mandatory in V1 to force compact entries.
- The tool should reject low-information writes.

### `memory_update`

Purpose:
- Correct, refine, pin, or close an existing memory.

Inputs:
- `id`
- patchable fields such as `title`, `summary`, `body`, `tags`, `importance`, `confidence`, `expiresAt`, `status`, `pinned`

Output:
- updated memory summary.

Notes:
- Pin/unpin can be modeled as part of update instead of a separate tool.

### `memory_link`

Purpose:
- Link related memories.

Inputs:
- `fromId`
- `toId`
- `relation`

Output:
- link confirmation.

Notes:
- V1 relations can stay simple: `related_to`, `supersedes`, `caused_by`, `implements`, `blocks`.

### `memory_archive`

Purpose:
- Archive or forget short-lived memories without hard-deleting them.

Inputs:
- `id`
- optional `reason`

Output:
- archive confirmation.

Notes:
- Prefer archive over delete in V1.

### 4.2 User-facing slash commands

These commands are for user control and debugging.

### `/memory-status`
Show:
- DB path
- active project/repo scope
- memory counts by kind
- embedding backend
- index health / migration version

### `/memory-search <query>`
Manual search for debugging retrieval quality.

### `/memory-review`
Show relevant existing memories for the current session/project/repo context plus explicit suggested actions, but do not save automatically.

### `/memory-session-save`
Create or update a session summary explicitly from user-provided text.

V1 can ship with these four commands only.

## 5. Proposed Event Hooks

### 5.1 `session_start`

Use for:
- opening or initializing the local store,
- loading config,
- reconstructing lightweight extension state,
- surfacing status or health warnings.

### 5.2 `before_agent_start`

Use for:
- retrieving relevant memories for the incoming user prompt,
- injecting a compact memory-context message into the turn,
- injecting terse memory-use triggers even when no memories match,
- constraining retrieval by current cwd/project/repo/session.

This is the main retrieval hook for V1.

### 5.3 `agent_end`

Use for:
- capturing session-local candidate memories,
- storing draft review items for `/memory-review`,
- optionally updating access stats.

Do **not** auto-save durable memories here in the first V1 cut.

### 5.4 `session_shutdown`

Use for:
- flushing state,
- closing DB handles,
- optionally prompting for explicit session summary creation only if such UX proves useful.

## 6. Retrieval Flow per Turn

### Default flow

1. User sends a prompt.
2. `before_agent_start` derives retrieval context:
   - prompt text
   - cwd
   - repo path
   - project identifier
   - current session identifier
3. Extension calls `searchMemories(...)` with those filters.
4. Core returns hybrid-ranked results.
5. Extension injects a compact memory context block plus memory-use triggers into the turn.
6. Agent can still call `memory_search` explicitly if it needs more detail.

### Injection shape

The injected block should be short and structured, for example:

- stable decisions
- relevant preferences
- open todos
- closely related recent episodes

Hard rule:
- inject only the top few results,
- prefer summaries over bodies,
- keep trigger text terse,
- avoid flooding every turn with low-confidence memories.

## 7. Proposed V1 Write Policy

V1 should be **manual-first, assisted-second, never silent by default**.

Default store: one global SQLite DB at `~/.pi/agent/pi-memory.sqlite`, overridable with `PI_MEMORY_DB_PATH`. Project, repo, and session scopes are metadata filters, not separate DBs. Existing repo-local `.pi/pi-memory.sqlite` dev databases should be migrated or temporarily pinned with `PI_MEMORY_DB_PATH` during upgrade.

### Allowed in V1

- explicit `memory_save`
- explicit `memory_update`
- explicit `/memory-session-save`
- suggested candidates via `/memory-review`

### Candidate review flow

`/memory-review` is read-only in V1. It should show the current session/project/repo context, relevant existing memories, the current session summary if present, and suggested explicit follow-up actions. The operator or agent then chooses one of the explicit write tools (`memory_save`, `memory_update`, `memory_link`, `memory_archive`) or `/memory-session-save`; the review command itself must not persist durable memories.

### Not default in V1

- silent automatic durable writes after every turn
- broad extraction from all tool results
- background summarization daemons

### Quality gates for writes

A memory should normally include:
- a clear kind,
- a valid scope,
- a compact summary,
- enough evidence or reasoning to be useful later,
- no duplicate of an already stronger memory when detected.

## 8. Default Memory Kinds in the Extension UX

V1 should bias toward these practical write cases:

- `decision` — architecture/product decisions with rationale
- `fact` — stable technical truths
- `preference` — user or repo preferences
- `todo` — durable open work worth resurfacing
- `episode` — important incidents, fixes, or investigations

`artifact_ref` should exist, but can remain secondary in the first UX pass.

## 9. Session Summary Shape

A V1 session summary should be stored in the existing `sessions.summary` field rather than as a normal memory record, and should contain:

- what changed,
- what was decided,
- open risks,
- next steps,
- important artifacts touched.

The summary should be compact enough to retrieve later without reloading raw chat history.

## 10. Packaging Direction

Recommended packaging for V1:

- build as a normal TypeScript Pi extension package,
- expose the packaged extension through the `pi.extensions` manifest in `package.json`,
- keep the extension entry point thin,
- place the local core in internal modules inside the same repo/package at first.

That keeps V1 easy to run while preserving a later extraction path.

## 11. Out of Scope for the First V1 Cut

- separate localhost daemon by default
- multi-user sharing
- remote sync
- automatic memory creation from every session event
- rich TUI memory browser
- deep code indexing
- MCP/OpenAPI runtime exposure in the first implementation slice

## 12. Immediate Implementation Slices

### Slice 1
- local core interface
- SQLite schema and migrations
- `memory_search`
- `memory_save`
- `before_agent_start` retrieval injection
- `/memory-status`

### Slice 2
- `memory_update`
- `memory_link`
- `/memory-search`
- better ranking and dedupe

### Slice 3
- `/memory-review`
- `/memory-session-save`
- session summary persistence
- archive/TTL behavior

### Slice 4
- local BGE-M3 command adapter via `PI_MEMORY_BGE_M3_COMMAND`, with bounded timeout and 1024-dimension output validation
- Pi package manifest/install path
- upgrade and DB-migration documentation, including WAL-safe repo-local DB migration guidance

## 13. Post-v1 Decisions To Revisit If Evidence Changes

- whether a localhost service becomes necessary after real-world V1 usage
- whether real-machine embedding measurements justify replacing the deterministic fallback
- whether post-V1 assisted memory creation should expand beyond the manual-first policy

## 14. Working Recommendation

For V1:

- **Pi extension is the product surface**,
- **the core runs in-process**,
- **retrieval happens automatically at turn start**,
- **durable writes stay explicit or review-based**.
