---
role: Retrieval-quality evidence review for canonical-key hypotheses
contains: Evidence collected before considering canonical-key write support, resolver tools, conflict audit, or startup key cards
not-contains: Product requirements, completed release history, or implementation design for deferred features
write-when: The evidence gate is re-run with new concrete retrieval failures
---

# Retrieval Quality Evidence Gate — 2026-05-16

## Question

Do current tags, `memory_tag_catalog`, exact tag / `metadata.canonicalKey` ranking, and zero-hit hints leave a concrete retrieval or conflict gap that justifies adding prompt-facing canonical-key write fields, resolver tools, canonical-cluster audit, or a startup canonical-keys card?

## Method

- Reviewed the active backlog gate in `TODO.md` and the prior backlog analysis in `docs/plans/todo-backlog-review-2026-05-15.md`.
- Inspected current retrieval and tool hint behavior in `src/core/search.ts` and `src/pi-extension/tools.ts`.
- Rechecked existing retrieval-quality coverage in `test/core/memory-search.test.ts` and zero-hit tool coverage in `test/pi-extension/tools.test.ts`.
- Added narrow regressions for two realistic failure hypotheses without changing prompt-facing schemas or runtime behavior.

## Evidence checked

| Hypothesis | Evidence | Result |
| --- | --- | --- |
| Exact canonical-key queries can lose to high-confidence lexical or exact-tag distractors. | Added `searchMemories ranks exact canonicalKey matches ahead of exact tag and lexical distractors`. The fixture disables semantic help, gives distractors higher importance/confidence, and still expects the canonical record first. | Covered by current ranking; no resolver tool justified. |
| Tag-filtered searches can hide a valid canonical-key record and leave the agent without a recovery path. | Added `memory_search explains tag-filter zero hits even when the query names a canonical key`. The tool returns a canonical-key hint plus explicit retry guidance to drop/check tag filters. | Recovery path exists; no canonical-key write field or resolver justified by this case. |
| Typos in canonical-like queries can produce unhelpful zero hits. | Existing `memory_search adds empty-result hints for near canonical keys` covers typo suggestions. | Covered. |
| Ordinary tag drift can block retrieval. | Existing near-tag tests cover tag-filter zero hits and save/update warnings; `memory_tag_catalog` remains the read-only catalog surface. | Covered without curated tag seeds. |
| Stable operational facts such as Git identity, GitHub SSH push, and repo paths are hard to retrieve. | Existing retrieval-quality eval keeps these distinct facts discoverable with lexical/tag signals and negative controls. | Covered by search/tag behavior. |
| Canonical-key conflict audit is needed now. | Normal save/update tool schemas do not expose `canonicalKey`; keyed records exist only through internal metadata paths. No concrete recurring active-key conflict was found. | Defer until real keyed conflicts exist. |

## Conclusion

No concrete failed retrieval or conflict case was found that justifies expanding prompt-facing tool schemas or turn-start context. Keep canonical-key write support, canonical-cluster audit, resolver tools, and startup canonical-key cards deferred.

Re-open this gate only with a reproducible zero-hit, wrong-hit, or conflicting-active-memory case where existing tags, `memory_tag_catalog`, exact tag / `metadata.canonicalKey` ranking, near-key hints, near-tag suggestions, and broaden-search guidance are insufficient.

## Verification

- `npm test -- test/core/memory-search.test.ts`
- `npm test -- test/pi-extension/tools.test.ts`
