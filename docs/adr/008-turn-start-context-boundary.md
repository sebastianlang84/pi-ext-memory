# ADR 008: Keep Memory Context Turn-Start and Retrieval-Driven

Date: 2026-05-25
Status: Accepted

## Context

A proposed follow-up asked whether pi-memory should provide a memory segment that is read at new context or session startup, similar to `AGENTS.md`.

Current behavior is narrower:

- `session_start` only sets UI status.
- `before_agent_start` runs turn intake for the current prompt.
- Turn intake derives session/repo/project context, preloads the latest matching active handoff when relevant, runs staged retrieval, and injects a hidden `pi-memory-context` message only when there is useful content.
- Turn-start retrieval is capped and measured by the token-injection check.

The risk of a broad startup segment is that it would mix durable memory with normative instructions, increase prompt bloat before relevance is known, and make stale memories feel authoritative.

## Decision

pi-memory will not add a general boot-loaded or AGENTS-like memory segment in the current product line.

Memory context remains:

- retrieval-driven,
- scoped to the current turn/session/repo/global context,
- capped,
- user-overridable,
- non-normative,
- delivered through the Pi turn-start hook rather than a generated instruction file.

Future startup-context ideas must be evidence-gated. A future proposal may be considered only if there are reproducible retrieval misses where existing turn-start retrieval, latest-handoff preload, `memory_search`, `memory_list`, `memory_tag_catalog`, near-key/tag hints, and audit flows are insufficient.

If such evidence appears, the candidate should be a tiny explicit card, not a broad preload: hard-capped, opt-in or narrowly configured, limited to clearly selected records such as pinned/keyed summaries, and measured by `npm run check:token-injection` before release.

## Consequences

- Durable memory stays distinct from normative instruction files such as `AGENTS.md`.
- Startup remains cheap and predictable.
- Existing turn-start retrieval and explicit search/list tools remain the normal way to surface prior context.
- Backlog references to startup cards remain deferred, not active implementation work.
- Any future startup-context work requires an evidence review and likely a follow-up ADR before implementation.
