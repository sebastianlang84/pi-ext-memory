# ADR 001 — Deterministic local embedding baseline for v0.5

- Status: Accepted
- Date: 2026-04-16

## Context

v0.5 needs an embedding generation and storage path so the project can move toward hybrid retrieval in v0.6.

At this stage the repository should stay:
- local-first,
- dependency-light,
- portable across normal developer machines,
- and testable without model downloads or background services.

A heavier local embedding runtime or remote provider would add operational cost before the hybrid retrieval path is validated.

## Decision

For v0.5, the core will use a narrow embedding adapter boundary and ship with a deterministic built-in baseline:

- default profile: `builtin-hash-384-v1`
- low-footprint fallback profile: `builtin-hash-64-v1`
- strategy: deterministic hash vectors over normalized memory content

Embeddings are generated during `createMemory(...)` and stored in SQLite in a dedicated `memory_embeddings` table.

The store initialization path may also accept a custom embedding adapter for tests or future provider swaps.

## Consequences

### Positive
- No new external runtime dependency is required in v0.5.
- The storage schema and adapter boundary are ready for later semantic models.
- Tests remain deterministic and fast.
- We can start hybrid retrieval work in v0.6 on top of persisted vectors.

### Negative
- The built-in baseline is not a true semantic embedding model.
- Retrieval quality from vectors alone will remain limited until a stronger adapter is introduced.

## Follow-up

- Revisit the default semantic model choice when v0.6 hybrid ranking is implemented.
- Keep the adapter boundary narrow so a better local model can replace the deterministic baseline without broad refactors.
- In v0.8.2, the default path is intentionally superseded by a local BGE-M3 command adapter while this deterministic baseline remains the built-in fallback.
