# ADR 009: Neutralize the Deterministic-Hash Semantic Channel; Defer Real Embeddings

Date: 2026-07-07
Status: Accepted

## Context

The default embedding adapter derives vectors from a SHA-256 hash of the content (`createDeterministicVector` in `src/core/embeddings.ts`). Two different texts produce uncorrelated pseudo-random vectors, so cosine similarity carries no semantic signal. With `minVectorSimilarity` at 0.15, most hash "matches" are noise, yet the hybrid ranker still spent a `semantic` weight (0.35) and ran a per-query vector scan on that dead channel. Real semantic search only activates when the operator configures `PI_MEMORY_BGE_M3_COMMAND`.

A researched alternative — bundling `@huggingface/transformers` with `bge-small-en-v1.5` (384-dim) — would deliver genuine local semantic search, but requires making the entire embedding path asynchronous (Transformers.js is Promise-based; the current store/search API is synchronous), adds a native `onnxruntime-node` dependency, and downloads a model on first run. That is a large, hard-to-reverse change for a deliberately lightweight extension.

## Decision

Neutralize the placeholder channel rather than let it pollute ranking:

- When the active embedding model is a `builtin-hash*` placeholder, skip the semantic candidate query entirely (`isPlaceholderEmbeddingModel` in `src/core/search.ts`). Ranking falls back cleanly to lexical + scope + recency + importance + pinned; the unused `semantic` term contributes 0 for all candidates, preserving relative order.
- Report the state to operators: `/memory-status` shows `semantic_search: inactive (deterministic-hash placeholder — set PI_MEMORY_BGE_M3_COMMAND for real embeddings)`.

Defer the full in-process embedding integration (async refactor + `onnxruntime-node` + model download) as a separate, explicitly approved change. The recommended target if pursued: `@huggingface/transformers` + `bge-small-en-v1.5` at 384 dims with a `minVectorSimilarity` around 0.55, lazy model load, and lexical-only fallback on load failure (never the hash vector). The existing `WHERE e.model = ? AND e.dimensions = ?` filter already makes stale vectors invisible, so a model swap is an incremental re-embed, not a schema break.

## Consequences

- Default installs no longer waste ranking weight or query work on a meaningless semantic channel, and operators can see that semantic search is off.
- No new native dependency or startup download is imposed on existing users.
- The command-based BGE-M3 adapter remains the supported way to get real semantic search today.
- Adopting bundled in-process embeddings requires a follow-up decision because it changes the store/search API surface (sync → async) and adds a heavyweight dependency.
