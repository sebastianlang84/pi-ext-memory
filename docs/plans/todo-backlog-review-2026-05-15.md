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
- Current search in `src/core/search.ts` is hybrid lexical + semantic with scope/recency/importance/confidence weights, but no first-class key/canonical-fact boost and no pinned boost.
- Strict FTS zero-hit searches retry with a bounded relaxed fallback; broader near-miss reporting and key/tag boosts remain open.
- Retrieval eval coverage now includes Git identity, GitHub SSH push, repo path, tag-only lexical retrieval, alias-removal negative controls, and unrelated-noise negative controls.
- `src/pi-extension/retrieval.ts` already keeps turn-start injection small: staged session/project/repo/global search, result limit 3, no broad unscoped fallback.
- `CHANGELOG.md` `2.0.9` through `2.0.11` record prompt/guidance compaction, retrieval fallback, and documentation/status freshness work, so more prompt-injection optimization should be measurement-led.
- `src/pi-extension/audit.ts` handles lifecycle and identity hygiene, but not canonical fact conflicts or fact-cluster deduping.
- `README.md` no longer advertises removed `progress_snapshot` writes after the v2.0.11 documentation refresh; broader write-policy hardening remains open.
- `TODO.md` no longer keeps the completed v2.0.0 section after the v2.0.11 documentation refresh.

## Item-by-item review

| TODO item | Sense | Gain | Lightweight fit | Notes / recommendation |
| --- | --- | --- | --- | --- |
| Research local autoresearch tooling for prompt injection token cost | Medium | Unclear until measured | Good only if local and one-off | Keep as research, but low priority. Recent prompt-shortening work already reduced repeated guidance; next useful step is measurement, not tooling adoption. Avoid adding a resident service or dependency. |
| Canonical fact/key support (`git.identity.default`, repo paths, stable prefs) | High | High | Good if narrowly scoped | Real problem: agents need deterministic single-source facts. Do not reintroduce `fact` kind; prefer a small canonical key/fact-cluster concept using tags/metadata or one minimal indexed field. |
| Rank exact keys and tag matches ahead of weak semantic/lexical matches | High | High | Strong | Current ranking has lexical/semantic/scope weights but no explicit tag/key boost. This should be part of canonical-fact retrieval, not a separate broad ranking rewrite. |
| Specialized resolver tools/APIs for Git identity and repo path | High | High | Medium-good if surface stays small | Strong deterministic local value via Git config/repo metadata. Prefer internal resolver API or one generic resolver surface over several new normal tools, to avoid prompt/tool bloat. |
| Detect conflicting active memories in same fact cluster | High | High | Good if advisory | Useful once canonical keys exist. Return explicit conflict/canonical-candidate reports; never auto-choose on low evidence. |
| Memory hygiene/dedup support for clusters | Medium | Medium | Good if manual/advisory | ADR 007 rejects semantic duplicate detection as a system feature. Keep this limited to exact key/tag clusters and explicit archive recommendations. |
| Improve empty-result behavior with fallback keyword/tag searches and near misses | High | Medium-high | Strong | Initial strict-zero-hit relaxed fallback is implemented for noisy Git identity queries. Remaining value is near-miss reporting and broader fallback behavior without over-broad recall. |
| Harden write policy docs/tool guidance | High | High | Excellent | README stale `progress_snapshot` wording is fixed. Continue clarifying docs/tool guidance to prevent memory pollution and transient-preference saves. |
| Tiny startup canonical-facts card with pinned/canonical facts | Medium | Potentially high | Risky unless tiny | Defer until canonical keys and evals prove that search fallback is insufficient. If implemented, cap hard (e.g. only pinned canonical facts, few lines) and measure token cost. |

## Applied consolidation

`TODO.md` now groups the open work into four delivery work packages plus evidence-gated deferred items:

1. **Tag hygiene and catalog**
   - Keep the derived tag catalog and field-vs-tag rule together.
   - Include write-policy cleanup and todo workflow-tag cleanup here because all three reduce memory pollution.

2. **Ranking and near-miss retrieval**
   - Combine exact tag/canonical-key boost with empty-result near-miss reporting.
   - Keep this as a retrieval-quality slice, not a broad ranking rewrite.

3. **Minimal canonical facts**
   - Add canonical keys/facts only in the smallest form that solves deterministic fact lookup.
   - Preserve ADR 007: no new `fact` kind, knowledge graph, broad registry, or background resolver.

4. **Advisory hygiene and conflict audit**
   - Add conflict and dedup recommendations for exact canonical-key/tag clusters.
   - Keep archive actions explicit/manual; no automatic conflict resolution.

Deferred items remain visible but gated by evidence:

- local autoresearch for prompt-injection token cost,
- specialized resolver tools/APIs,
- startup canonical-facts card.

## Proposed priority order

1. Tag hygiene and write-policy cleanup, including todo workflow-tag cleanup.
2. Exact tag/canonical-key ranking plus near-miss retrieval behavior.
3. Minimal canonical key/fact support, starting with Git identity and repo path facts only if tests keep the model small.
4. Advisory canonical-cluster conflict/audit support.
5. Resolver tools/APIs, token-cost research, and startup canonical-facts card only if evidence still justifies them.

## Lightweight guardrails

- No remote service, no Docker, no background daemon for these items.
- No broad new public tool family unless a single generic resolver proves insufficient.
- No automatic deletion/archive; recommendations only.
- No semantic duplicate detector beyond bounded exact-key/tag cluster checks.
- Keep turn-start injection capped and measured; canonical facts card must be opt-in or tiny by hard limit.
