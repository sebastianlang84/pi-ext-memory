---
role: Product requirements document for the V1 local memory system
contains: Problem statement, goals, product decisions, scope, risks, and next work packages
not-contains: Final implementation details, ADR-level decisions, or active task tracking
write-when: Product scope, requirements, or major direction changes
---

# PRD — Lightweight Local Memory System for Coding Agents

## 1. Goal

Build a **lightweight local memory system** for coding agents that runs reliably on ordinary developer machines, supports German and English retrieval, and is usable in V1 primarily as a Pi extension.

The system should:

- persist important agent memories,
- make those memories findable through hybrid semantic and lexical retrieval,
- work without central infrastructure,
- stay portable and dependency-light,
- leave room for later MCP or OpenAPI exposure if a second integration surface becomes concrete.

V1 is not a general code indexing or repository search system.

---

## 2. Problem

Coding agents lose useful context across sessions, resets, compactions, and model changes.

Typical failures:

- architecture decisions disappear,
- user preferences are not remembered reliably,
- already solved problems are investigated again,
- important todos, handoffs, or risks remain only in chat history,
- saved context exists but cannot be retrieved with enough precision later.

Chat history alone is not a sufficient memory store because it is noisy, weakly structured, hard to search semantically, and does not clearly separate durable knowledge from short-lived session state.

---

## 3. Product Vision

pi-memory is a **local memory layer for agents**.

Default principles:

- local-first,
- single-user,
- single-file storage where practical,
- hybrid retrieval rather than vector-only retrieval,
- compact memory objects rather than raw chat archives,
- manual-first writes with explicit tools and commands.

---

## 4. Target Users

### Primary V1 users

- individual developers using Pi Coding Agent,
- local use on Linux, macOS, or Windows,
- technically capable users who can inspect local files and environment variables.

### Later possible users

- other agent harnesses,
- multiple local clients through MCP or OpenAPI,
- optional team or shared-memory modes if explicitly designed later.

---

## 5. V1 Requirements

### Must have

- run locally without requiring Docker,
- work on normal developer machines,
- support German and English retrieval,
- store structured memory objects,
- combine semantic search with exact lexical search,
- filter by scope, repo/session identity, optional kind, and tags,
- save explicit session summaries,
- integrate as a Pi package/extension,
- remain open to later MCP/OpenAPI exposure without adding a V1 service.

### Should have

- simple configuration,
- explicit lifecycle hygiene through audit warnings and manual archiving,
- no automatic TTL or expiry in the current V1 line,
- ranking signals for recency, importance, confidence, scope, and lexical/tag matches.

### Not in V1

- multi-user access control,
- cloud sync,
- central server architecture,
- automatic codebase indexing,
- heavy background infrastructure,
- general memory import/export commands.

---

## 6. Current Product Decisions

Durable architecture decisions live in ADRs; this PRD only summarizes the product direction.

- Storage default: local SQLite. See [ADR 002](../adr/002-global-memory-store-default.md).
- Embeddings: deterministic built-in fallback plus optional local BGE-M3 command adapter. See [ADR 001](../adr/001-deterministic-embedding-baseline.md) and [ADR 003](../adr/003-local-bge-m3-embedding-adapter.md).
- Scope identity: normal agent-facing scopes are `global`, `repo`, and `session`; `project` remains legacy/advanced compatibility. See [ADR 004](../adr/004-scope-first-memory-identity.md) and [ADR 005](../adr/005-simplified-agent-facing-scopes.md).
- Tool surface: normal agents should use the small tool path; `memory_stats` is advanced/admin only. See [ADR 006](../adr/006-normal-and-advanced-tool-surface.md).
- Memory model: generic kindless memories plus explicit `todo` and `handoff` flows. See [ADR 007](../adr/007-memory-model-minimisation.md).

---

## 7. Memory Model

The system stores **condensed memories**, not raw conversations.

Current memory categories:

- generic kindless memories for notes, facts, decisions, preferences, and context,
- `todo` for explicit open tasks and follow-ups,
- `handoff` for explicit resumable session, reset, or agent-transfer context.

Current statuses:

- `active` — included in normal active flows,
- `archived` — retained but removed from normal active flows.

Current scopes:

- `global`,
- `repo`,
- `session`,
- `project` as legacy/advanced compatibility only.

Typical memory examples:

- a decision and rationale as a kindless memory,
- a problem, root cause, and fix as a kindless memory,
- a durable user preference with its scope,
- an explicit todo through `memory_save_todo`,
- an explicit handoff through `memory_save_handoff`,
- a session summary through `/memory-session-save`.

---

## 8. Retrieval Model

Retrieval should be hybrid and context-aware.

Expected flow:

1. apply metadata filters,
2. use SQLite FTS lexical search,
3. use vector search,
4. rank in the application layer.

Ranking should consider:

- scope match,
- repo/project/session identity match,
- recency,
- importance,
- confidence,
- lexical hits in title, summary, body, and tags,
- optional metadata and tag filters.

The goal is not only to find semantically similar memories, but to find the memories most relevant to the current agent context.

---

## 9. V1 Conceptual Data Model

### `memories`

Key conceptual fields:

- id,
- optional kind (`todo` or `handoff`; generic memories stay kindless),
- status (`active` or `archived`),
- scope,
- title, summary, body, tags,
- source agent metadata,
- project/repo/session identity metadata,
- branch,
- importance and confidence,
- created/updated/accessed timestamps.

### `memory_embeddings`

Key conceptual fields:

- memory id,
- model,
- dimensions,
- vector JSON,
- content hash,
- created/updated timestamps.

### `sessions`

Key conceptual fields:

- session id,
- started/ended timestamps,
- summary,
- project/repo metadata.

Current V1 no longer includes `expires_at`, link relations, or separate artifact APIs.

---

## 10. V1 API Direction

Core operations:

- create a generic memory,
- save an explicit todo,
- save an explicit handoff,
- update a memory,
- search memories,
- list/filter memories,
- get a memory by id,
- archive through a status update,
- save a session summary.

Not current V1 APIs:

- link-memory operations,
- artifact APIs,
- TTL/expiry operations,
- pin/unpin flows,
- general import/export flows.

Possible later exposure:

- MCP tools,
- OpenAPI endpoints.

---

## 11. Pi Integration in V1

Pi can:

- search for relevant memories,
- save new memories explicitly,
- persist session summaries,
- mark important decisions and facts through normal memory saves,
- install and load the extension through the Pi package manifest.

Open product questions:

- how much memory extraction should be automated after V1,
- whether later writes should stay explicit, become heuristic, or happen at session end,
- how much user control any auto-save flow would need.

Current posture: manual-first writes with explicit tools and commands.

---

## 12. Non-Functional Requirements

- local persistence,
- low resource use,
- fast startup,
- crash robustness,
- simple backups,
- simple debugging,
- simple migrations,
- cross-platform operation where Pi and Node support it.

---

## 13. Main Risks

### Technical risks

- application-layer vector search may need redesign for very large stores,
- local embedding latency may hurt weaker machines,
- BGE-M3 may be too heavy for some target machines.

### Product risks

- saving too much noisy context can make retrieval worse,
- too little structure can make memory entries unhelpful,
- overly fine-grained memories can fragment context,
- overly broad automatic writes can erode user trust.

---

## 14. Post-V1 Open Questions

1. Should a later runtime boundary go beyond the in-process Pi extension?
   - Only if evidence justifies a small localhost service or another integration boundary.

2. Should the deterministic fallback embedding path be replaced?
   - Only if real measurements justify another lightweight semantic fallback.

3. How far should memory creation be automated after V1?
   - Current posture remains manual-first.
   - Later options include review-based, heuristic, or automatic saves.

4. Which active entries need hygiene or archival rules?
   - Current V1 has no automatic expiry.
   - Audit surfaces old handoffs and stale todos; archiving remains explicit.

5. How should compaction support evolve?
   - Possible strategies: session-based, event-based, or explicit user/agent command.

6. How tightly should Pi couple to the memory system?
   - Current posture: thin adapter over an independent core.

7. Should import/export become a product feature?
   - Not in current V1.
   - Revisit only when backup, migration, or cross-tool portability needs become concrete.

---

## 15. V1 Scope Summary

### Included

- SQLite storage,
- persisted vectors with application-layer ranking,
- SQLite FTS5,
- German and English retrieval support,
- local persistence,
- memory CRUD,
- hybrid search,
- session summary saves,
- kindless memories plus dedicated `todo` and `handoff` flows,
- a simple Pi adapter.

### Excluded

- team sharing,
- central database,
- authentication and authorization,
- large UI surface,
- remote multi-agent usage,
- automatic codebase indexing,
- general import/export commands.

---

## 16. V1 Success Criteria

- A user can start locally within a few minutes.
- Pi can read and write memories.
- Relevant earlier decisions are retrieved reliably.
- German and English queries produce useful matches.
- Data remains local, inspectable, and portable.
- Retrieval quality does not collapse under routine memory growth.

---

## 17. Post-V1 Follow-Up

1. Observe BGE-M3 command-adapter quality and latency on real machines.
2. Keep the deterministic fallback until measurements justify another lightweight fallback model.
3. Revisit the runtime boundary in an ADR if evidence later argues against the in-process extension.
4. Record the MCP/OpenAPI target model when a second integration surface becomes concrete.
5. Reassess import/export only when a concrete backup, migration, or interoperability workflow needs it.
