---
role: Working plan for deepening pi-memory architecture
contains: Refactor slices, commit sequencing, acceptance criteria, TODO closeout rules, and verification gates for architecture deepening
not-contains: Final implementation notes, ADR decisions, or detailed TypeScript Interface designs
write-when: Slice order, scope, acceptance criteria, commit strategy, or architectural target changes materially
---

# Plan — Architecture Deepening

## 1. Purpose

Status: active refactor planning.

This plan turns the architecture review into small, reviewable commits that deepen shallow Modules without changing pi-memory's product direction.

Primary goals:

- Improve **Locality**: scope identity, lifecycle, runtime store, turn intake, and tool execution rules should each have one main place to change.
- Improve **Leverage**: callers and tests should exercise deep Modules through compact Interfaces instead of knowing implementation ordering details.
- Keep behavior stable unless a slice explicitly says otherwise.
- Preserve local-first, dependency-light, Pi-first operation.

Relevant accepted decisions:

- [ADR 001 — Deterministic local embedding baseline](../adr/001-deterministic-embedding-baseline.md)
- [ADR 002 — Global memory store default](../adr/002-global-memory-store-default.md)
- [ADR 003 — Local BGE-M3 command adapter as the default embedding target](../adr/003-local-bge-m3-embedding-adapter.md)
- [ADR 004 — Scope-first memory identity](../adr/004-scope-first-memory-identity.md)
- [ADR 005 — Simplified agent-facing memory scopes](../adr/005-simplified-agent-facing-scopes.md)
- [ADR 006 — Normal and Advanced Tool Surface](../adr/006-normal-and-advanced-tool-surface.md)

## 2. Current Friction

Architecture review found five shallow or leaky areas:

1. Memory identity rules are split between core validation, Pi tool identity resolution, and runtime enrichment.
2. Memory lifecycle rules are split between store defaults, cap checks, handoff relevance, and audit classification.
3. Extension store lifecycle is duplicated between extension hooks and commands.
4. Turn-start retrieval requires callers to know ordering across context derivation, staged retrieval, handoff fallback, message formatting, and hygiene.
5. `src/pi-extension/tools.ts` is a large Module where each tool repeats store lookup, context derivation, identity handling, formatting, notices, and details shaping.

Deletion test summary:

- Deleting the current helper Modules would not remove complexity; it would reappear in multiple callers and tests.
- The desired direction is not more seams everywhere. Each new or moved seam must concentrate behavior behind a smaller Interface.
- One Adapter remains hypothetical. Do not add abstract Adapter seams unless at least two concrete Adapters exist or tests need an internal seam inside a Module.

## 3. Target Shape

The target architecture has five deeper Modules:

| Target Module | Interface should hide | Main Leverage | Main Locality |
| --- | --- | --- | --- |
| Memory identity policy | Scope identity validation, primary identity derivation, legacy project notices, runtime enrichment rules | Search/list/save/update callers use one rule set | ADR 004/005 changes land in one place |
| Memory lifecycle policy | Todo stale handling, handoff expiry, active caps, default stale/expiry timestamps, audit lifecycle classification | Store, handoff lookup, audit, and tools share one lifecycle model | Lifecycle bugs and tests concentrate in one Module |
| Extension runtime store | Default DB path resolution, lazy store creation, reuse, close-on-shutdown | Hooks and commands stop duplicating store management | DB path and close/reopen behavior changes once |
| Turn intake | Turn context, staged retrieval, latest handoff, hygiene line, injected message assembly | `before_agent_start` becomes a small caller | Retrieval ordering tests target one Interface |
| Pi tool execution shell | Store/context setup, identity error rendering, legacy notices, details shape, common success/error text | Individual tools focus on memory operation behavior | Pi runtime quirks and error formatting live in one Module |

## 4. Commit Slices

Each slice should be a separate commit unless implementation evidence shows two adjacent slices are safer together. After each committed slice, remove its completed TODO item from `TODO.md` so a later session can resume cleanly.

Each implementation commit must:

- keep the diff small and reviewable;
- update tests for the new Interface;
- run `npm test` at minimum;
- run `npm run smoke:package-status` when package/runtime metadata or Pi-facing registration changes;
- update `CHANGELOG.md`, `MEMORY.md`, `TODO.md`, `package.json`, `package-lock.json`, and `src/core/memory-core.ts` version/status text when the repo release gate requires a versioned commit;
- state SemVer impact explicitly. Expected impact is patch for behavior-preserving internal refactors; any public tool behavior change must be called out and may be minor or major.

### Commit 1 — Deepen memory identity policy

Files likely involved:

- `src/core/memories.ts`
- `src/pi-extension/tool-identity.ts`
- `src/pi-extension/retrieval.ts`
- `test/core/memory-list.test.ts`
- `test/core/memory-search.test.ts`
- `test/pi-extension/retrieval.test.ts`
- `test/pi-extension/tools.test.ts`

Problem:

Scope identity rules are split across normalization, Pi tool resolution, and runtime enrichment. Callers must know too much about when `sessionId`, `projectId`, and `repoPath` are legal, derived, or stored as metadata.

Solution:

Create or deepen a memory identity policy Module that owns:

- primary identity for `global`, `repo`, `project`, and `session`;
- validation of contradictory identities;
- derivation from the Pi turn context;
- legacy project compatibility notice decisions;
- create-input enrichment rules.

Acceptance criteria:

- Core search/list validation and Pi tool validation agree through the same policy concepts.
- Runtime enrichment preserves ADR 004/005 behavior: normal scopes are global/repo/session; project is legacy/advanced compatibility.
- Tests cover valid and invalid identity combinations through the policy Interface, not only through every tool.
- No behavior regression for legacy project records.

### Commit 2 — Deepen memory lifecycle policy

Files likely involved:

- `src/core/policy.ts`
- `src/core/store.ts`
- `src/pi-extension/audit.ts`
- `src/pi-extension/handoffs.ts`
- `test/core/*todo*` or existing store/list tests
- `test/pi-extension/audit.test.ts`
- `test/pi-extension/retrieval.test.ts`
- `test/pi-extension/tools.test.ts`

Problem:

Todo staleness, handoff expiry, active caps, default stale/expiry timestamps, and audit recommendations are spread across several Modules.

Solution:

Deepen lifecycle policy into one Module that owns:

- default stale/expiry calculation;
- active cap lookup and cap identity inputs;
- stale todo and expired handoff classification;
- active/unexpired handoff relevance checks;
- audit lifecycle recommendation primitives.

Acceptance criteria:

- Store create paths use lifecycle policy for todo/handoff defaults and caps.
- Handoff lookup and audit use the same active/expired logic.
- Tests verify lifecycle behavior through the lifecycle Interface plus one integration path.
- No public tool behavior changes unless explicitly documented.

### Commit 3 — Deepen extension runtime store seam

Files likely involved:

- `src/pi-extension/index.ts`
- `src/pi-extension/commands.ts`
- `src/pi-extension/config.ts`
- new `src/pi-extension/runtime-store.ts` or equivalent
- `test/pi-extension/commands.test.ts`
- `test/pi-extension/db-path.test.ts`

Problem:

Extension hooks and commands both manage active store creation, reuse, and shutdown. The same knowledge about default DB paths and closing old stores is duplicated.

Solution:

Create a runtime store Module whose Interface gives callers a current store for a cwd and closes it on shutdown. Keep DB path resolution local-first and compatible with `PI_MEMORY_DB_PATH` and legacy default-path migration.

Acceptance criteria:

- `index.ts` and `commands.ts` no longer duplicate store lifecycle helpers.
- Shutdown still closes the active store once and clears UI widgets as before.
- Tests cover reuse, replacement, and close behavior at the runtime store seam.
- No database path behavior changes.

### Commit 4 — Deepen turn intake

Files likely involved:

- `src/pi-extension/index.ts`
- `src/pi-extension/retrieval.ts`
- `src/pi-extension/handoffs.ts`
- `src/pi-extension/audit.ts`
- `test/pi-extension/retrieval.test.ts`

Problem:

`before_agent_start` currently coordinates context derivation, latest handoff lookup, staged retrieval, message construction, and hygiene. The caller knows ordering facts that belong behind a deeper Interface.

Solution:

Create a turn intake Module that accepts prompt, cwd, session id, and store, then returns the complete message payload or no message.

Acceptance criteria:

- `before_agent_start` only handles Pi event wiring, status errors, and returning the turn-intake result.
- Turn intake preserves latest handoff precedence, staged retrieval order, dedupe behavior, and hygiene line inclusion.
- Tests cover empty prompt, handoff-only, memory-only, hygiene-only, and combined cases through the turn intake Interface.
- No retrieval quality behavior changes unless deliberately documented.

### Commit 5 — Deepen Pi tool execution shell

Files likely involved:

- `src/pi-extension/tools.ts`
- new focused tool modules if useful
- `src/pi-extension/formatters.ts`
- `test/pi-extension/tools.test.ts`

Problem:

`tools.ts` is too broad. Individual tool definitions repeat common Pi execution mechanics and hide real memory operation behavior inside boilerplate.

Solution:

Introduce a tool execution shell that owns common execution mechanics:

- active store lookup;
- turn context derivation;
- identity resolution and identity error formatting;
- legacy project notices;
- common details fields;
- common memory result rendering where appropriate.

Then split high-churn tool behavior only where it improves Depth. Avoid creating many pass-through Modules.

Acceptance criteria:

- Tool behavior remains compatible with ADR 006 normal/advanced tool surface.
- Each tool's implementation becomes easier to read by focusing on its memory operation.
- Common error and notice behavior is tested once through the tool shell plus representative tool integration tests.
- `tools.ts` is materially smaller or has clearer local sections after applying the deletion test.

## 5. TODO Closeout Rule

`TODO.md` is the active queue. During this program:

1. Keep one TODO item per uncommitted slice.
2. Complete exactly one slice per commit unless there is a clear reason to combine adjacent slices.
3. After verification and commit, remove the completed slice item from `TODO.md` in the same commit or immediately after if the commit is specifically the slice closeout.
4. If context is reset between slices, the next agent should read `MEMORY.md`, `TODO.md`, then this plan, and start with the first remaining TODO item.
5. Do not leave checked-off items in `TODO.md`; remove completed work.

## 6. Non-goals

- Do not change the SQLite schema unless a slice proves it is necessary.
- Do not remove legacy project-scope compatibility in this program.
- Do not remove advanced/compatibility tools in this program.
- Do not introduce remote dependencies, background services, or heavy infrastructure.
- Do not design new TypeScript Interfaces before the relevant slice reaches implementation planning.

## 7. Risks and Stop Conditions

Stop and ask before proceeding if:

- a slice would alter public tool behavior beyond a patch-level refactor;
- a refactor requires database schema changes;
- tests reveal existing behavior is unclear rather than merely duplicated;
- `tools.ts` splitting starts creating pass-through Modules with weak Depth;
- unrelated dirty worktree changes appear.

## 8. Verification Baseline

For every code slice:

- `npm test`
- `npm run smoke:package-status` when Pi extension registration, package metadata, or runtime status text changes
- `npm run smoke:memory-status` only when the global smoke environment is healthy; if still blocked by unrelated extensions, document the blocker instead of treating it as this slice's failure

For docs-only updates:

- `git diff --check`
- link/path inspection for referenced plan and ADR files
