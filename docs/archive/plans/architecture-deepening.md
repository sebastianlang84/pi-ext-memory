---
role: Historical completed/superseded architecture plan
contains: Completed refactor slice summary, historical acceptance criteria, and verification baseline for architecture deepening
not-contains: Active task tracking, current implementation instructions, or new work items
write-when: Historical status or archival routing changes
---

# Plan — Architecture Deepening

Status: completed and superseded as an active plan.

This document is retained as historical context for the architecture-deepening program. It is not an active delivery plan and should not be used as the current task queue. Active work belongs in `TODO.md`.

## 1. Original Purpose

The plan turned an architecture review into small, reviewable refactor slices that deepened shallow modules without changing pi-memory's product direction.

Original goals:

- Improve **Locality**: scope identity, lifecycle, runtime store, turn intake, and tool execution rules each get one main place to change.
- Improve **Leverage**: callers and tests exercise deeper modules through compact interfaces instead of knowing implementation ordering details.
- Keep behavior stable unless a slice explicitly says otherwise.
- Preserve local-first, dependency-light, Pi-first operation.

Relevant accepted decisions at the time:

- [ADR 001 — Deterministic local embedding baseline](../adr/001-deterministic-embedding-baseline.md)
- [ADR 002 — Global memory store default](../adr/002-global-memory-store-default.md)
- [ADR 003 — Local BGE-M3 command adapter as the default embedding target](../adr/003-local-bge-m3-embedding-adapter.md)
- [ADR 004 — Scope-first memory identity](../adr/004-scope-first-memory-identity.md)
- [ADR 005 — Simplified agent-facing memory scopes](../adr/005-simplified-agent-facing-scopes.md)
- [ADR 006 — Normal and Advanced Tool Surface](../adr/006-normal-and-advanced-tool-surface.md)

## 2. Historical Slices

Completed/superseded slices:

1. Deepen memory identity policy.
2. Deepen memory lifecycle policy.
3. Deepen extension runtime store seam.
4. Deepen turn intake.
5. Deepen Pi tool execution shell.

These slices are no longer active tasks. Later code and changelog entries are the source of truth for what landed.

## 3. Historical Non-goals

- Do not change the SQLite schema unless a slice proves it is necessary.
- Do not remove legacy project-scope compatibility in this program.
- Do not introduce remote dependencies, background services, or heavy infrastructure.
- Do not design new TypeScript interfaces before the relevant slice reaches implementation planning.

## 4. Historical Verification Baseline

For code slices, the expected baseline was:

- `npm test`
- `npm run smoke:package-status` when Pi extension registration, package metadata, or runtime status text changed
- `npm run smoke:memory-status` only when the global smoke environment was healthy; unrelated extension blockers were to be documented instead of treated as slice failures

For docs-only updates, the expected baseline was:

- `git diff --check`
- link/path inspection for referenced plan and ADR files
