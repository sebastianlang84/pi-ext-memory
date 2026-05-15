---
role: Backlog review notes for current TODO.md items
contains: Evidence-based review of TODO items for sense, gain, lightweight fit, and suggested consolidation
not-contains: Final implementation decisions, completed history, or detailed code design
write-when: TODO backlog is re-reviewed or priorities materially change
---

# TODO Backlog Review — 2026-05-15

## Purpose

Review all current `TODO.md` items for:

- **Sinnhaftigkeit**: does the item address a real observed/product-relevant problem?
- **Gewinn**: expected retrieval quality, agent reliability, or token-cost benefit.
- **Lightweight fit**: preserves local-first, dependency-light, minimal tool-surface direction.

## Evidence snapshot

- `docs/product/prd-lightweight-local-memory-system.md` requires local-first, hybrid retrieval, DE/EN support, and low resource use.
- `docs/adr/007-memory-model-minimisation.md` intentionally removed most structured kinds, links, auto-expiry, and semantic duplicate detection; new work should not re-grow that surface casually.
- Current search in `src/core/search.ts` is hybrid lexical + semantic with scope/recency/importance/confidence weights, including exact tag and `metadata.canonicalKey` ranking signals.
- Strict FTS zero-hit searches retry with a bounded relaxed fallback; `memory_search` zero-hit output now adds request-local empty-result hints for near canonical keys and broader retries.
- Retrieval eval coverage now includes Git identity, GitHub SSH push, repo path, tag-only lexical retrieval, alias-removal negative controls, and unrelated-noise negative controls.
- `src/pi-extension/retrieval.ts` already keeps turn-start injection small: staged session/project/repo/global search, result limit 3, no broad unscoped fallback.
- `CHANGELOG.md` `2.0.9` through `2.0.11` record prompt/guidance compaction, retrieval fallback, and documentation/status freshness work, so more prompt-injection optimization should be measurement-led.
- `src/pi-extension/audit.ts` handles lifecycle and identity hygiene, but not canonical-key conflicts or keyed/tag-cluster deduping.
- Normal `memory_save`/`memory_update` tool schemas do not expose `metadata` or `canonicalKey`, so new canonical-key write support would add prompt-facing schema surface.
- `README.md` no longer advertises removed `progress_snapshot` writes after the v2.0.11 documentation refresh; broader write-policy hardening remains open.
- `npm run eval:prompt-routing` now provides an optional developer-only eval fixture set for all memory tools plus no-tool negatives; default mode validates fixtures without a model command and adds no runtime prompt tokens.
- `TODO.md` no longer keeps the completed v2.0.0 section after the v2.0.11 documentation refresh.

## Item-by-item review

| TODO item | Sense | Gain | Lightweight fit | Notes / recommendation |
| --- | --- | --- | --- | --- |
| Research local autoresearch tooling for prompt injection token cost | Medium | Unclear until measured | Good only if local and one-off | Keep as research, but low priority. Recent prompt-shortening work already reduced repeated guidance; next useful step is measurement, not tooling adoption. Avoid adding a resident service or dependency. |
| Preferred-tag seed vs derived catalog | Medium | Medium | Strongest when derived-only | Resolved: use the on-demand derived `memory_tag_catalog`; do not add a curated preferred-tag seed, catalog memory, alias table, or turn-start tag injection. |
| Explicit canonical keys for author-declared memories (`canonicalKey: "git.identity.default"`, repo paths, stable prefs) | Medium hypothesis; low until failures are shown | Low now; read path already exists | Risky unless evidence-gated | Current search already ranks exact tags and existing `metadata.canonicalKey`, and zero-hit search can suggest near canonical keys. The missing piece is write-side explicitness, but adding it to normal tools costs prompt/schema surface. Keep as an evidence gate, not an active implementation package. |
| Rank exact keys and tag matches ahead of weak semantic/lexical matches | High | High | Strong | Implemented as internal exact tag and `metadata.canonicalKey` ranking signals; no separate prompt-facing resolver was added. |
| Specialized resolver tools/APIs for Git identity and repo path | Medium hypothesis | Unproven | Medium at best | Potential deterministic value, but likely belongs outside memory unless repeated failures prove tags/search/audit cannot handle it. Prefer no new normal tools unless a concrete gap survives evidence checks. |
| Detect conflicting active memories in same canonical-key cluster | Medium hypothesis | Low until keyed memories are writable/used | Good only if advisory and gated | Useful only after canonical-key usage exists. Do not build conflict audit for an unused/manual-internal field. |
| Memory hygiene/dedup support for clusters | Medium | Medium only for exact observed clusters | Good if manual/advisory | ADR 007 rejects semantic duplicate detection as a system feature. Keep this limited to exact key/tag clusters and explicit archive recommendations, and require evidence of recurring duplicates first. |
| Improve empty-result behavior with fallback keyword/tag searches and near misses | High | Medium-high | Strong | Implemented for `memory_search` as advisory zero-hit hints for near canonical keys, near tags, and broader retry guidance without broadening recall automatically. |
| Harden write policy docs/tool guidance | High | High | Excellent | README stale `progress_snapshot` wording is fixed. Continue clarifying docs/tool guidance to prevent memory pollution and transient-preference saves. |
| Tiny startup canonical-keys card with pinned/keyed memories | Medium hypothesis | Potentially high only if retrieval gaps recur | Risky unless tiny | Defer until canonical-key evidence and evals prove that search fallback is insufficient. If implemented, cap hard (e.g. only pinned/keyed memories, few lines) and measure token cost. |

## Applied consolidation

`TODO.md` now keeps canonical-key work as an evidence gate plus deferred implementation items, not an active implementation package. The tag-catalog seed question is resolved in favor of the derived catalog:

Resolved tag hygiene/catalog decision:

- Keep the derived tag catalog and field-vs-tag rule together.
- Do not add a curated preferred-tag seed; derive tag reuse signals from active memories and keep suggestions advisory.
- Todo workflow-tag cleanup remains audit-only/manual.

Remaining open packages:

1. **Retrieval quality evidence gate**
   - Collect concrete zero-hit, wrong-hit, or conflict cases where current tags, derived tag catalog, exact tag/`metadata.canonicalKey` ranking, and near-key/tag hints are insufficient.
   - Only promote explicit canonical-key write support if those cases prove a high-value gap and the tool-schema/token cost stays negligible.
   - Preserve ADR 007: no new `fact` kind, knowledge graph, broad registry, or background resolver.

2. **Advisory hygiene and conflict audit**
   - Keep canonical-key conflict audit deferred until keyed memories are actually writable/used.
   - Consider exact tag-cluster dedup recommendations only for observed recurring duplicates; keep archive actions explicit/manual and no automatic conflict resolution.

Deferred items remain visible but gated by evidence:

- optional canonical-key write support and canonical-key conflict audit,
- local autoresearch for prompt-injection token cost,
- specialized resolver tools/APIs,
- startup canonical-keys card.

## Proposed priority order

1. Retrieval-quality evidence gate for canonical-key hypotheses: collect concrete failures before implementation.
2. Optional canonical-key write support, canonical-cluster audit, resolver tools/APIs, token-cost research, and startup canonical-keys card only if evidence still justifies them.

## Lightweight guardrails

- No remote service, no Docker, no background daemon for these items.
- No broad new public tool family unless a single generic resolver proves insufficient.
- No automatic deletion/archive; recommendations only.
- No semantic duplicate detector beyond bounded exact-key/tag cluster checks.
- Keep turn-start injection capped and measured; canonical-key write fields or startup cards must be opt-in/tiny and justified by concrete retrieval failures.
