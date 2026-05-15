---
role: Active implementation plan for tag catalog and tag-reuse behavior
contains: Scope, decisions, slices, acceptance criteria, and risks for a lightweight pi-memory tag catalog
not-contains: Completed history, release notes, or a final ADR
write-when: Tag-catalog scope, implementation order, or acceptance criteria change
---

# Plan — Lightweight Tag Catalog and Reuse

Status: partially implemented

## Purpose

Prevent tag sprawl while keeping pi-memory flexible. Agents should reuse existing content/context tags such as `agent-context` instead of inventing near-duplicates such as `agentic-context`.

## Agreed direction

- Tags are content/context labels, not the source of truth for fields that already exist.
- If a tool has a field for a concept, use the field instead of duplicating it as a tag.
- Preferred tags should be visible before or during saves.
- A dedicated `memory_tag_catalog` tool is the MVP catalog surface because it is truly read-only; `memory_audit` writes audit metadata and remains focused on hygiene.
- The MVP does not need a formal alias/deprecation system. LLMs can use a visible tag catalog to notice similar tags and retry/search/save with the preferred existing tag.
- Keep the model flat: no heavy ontology, no background service, no remote dependency.

## Current facts

- Tags are stored as normalized lowercase strings in `memories.tags_json` and indexed into FTS.
- `memory_search` and `memory_list` can filter by exact tags.
- Before the first implementation slice, `memory_save_todo` appended `todo`, priority tags such as `p1`, and non-open status tags to the stored tag list, even though the tool accepts todo-specific fields.
- The first implementation slice stops adding those workflow tags for new todos and removes legacy priority tags when todo priority is patched.
- ADR 007 keeps only `todo` and `handoff` as explicit kinds and relies on tags for ordinary note/fact/decision categorization.
- The repo policy prefers retrieval quality over feature count and avoids tool-surface bloat.

## Target behavior

1. Agents can ask for or receive a compact inventory of existing tags, with counts and example records.
2. Save guidance tells agents to check the catalog before creating unfamiliar tags.
3. Tag suggestions are advisory: prefer existing similar tags, but allow deliberate new tags.
4. Todo state uses todo fields/metadata, not content tags like `todo`, `p1`, or `open`.
5. Empty or weak searches can report near tag matches so agents can retry with likely existing tags.

## Implementation slices

### Slice 1 — Document the tag contract — implemented

- Add user/developer guidance: tags are for topic, subsystem, activity, artifact, and cross-cutting context.
- State the field-vs-tag rule clearly: fields win; tags should not duplicate kind/status/priority/scope.
- Add examples of good multi-tag combinations: `pi-memory`, `tagging`, `agent-context`, `design`.

Acceptance:

- Docs explain when to use tags vs structured fields.
- No tool behavior changes yet.

### Slice 2 — Add a derived tag catalog API — implemented

- Derive tag inventory from active memories through existing store read APIs.
- Include tag, count, scopes/kinds seen, and one or two recent example titles.
- Keep it read-only and generated from records; no authoritative tag table.
- Expose it through `memory_tag_catalog`; avoid `memory_audit` because audit runs intentionally write `lastAuditAt` and `lastAuditSummary` metadata.

Acceptance:

- Agent can see existing tags before save work.
- Catalog is scoped/filterable enough to avoid noise: global/repo/session, kind, status.
- No schema migration required.

### Slice 3 — Add near-tag suggestions

- For a proposed or searched tag, compare against the derived catalog.
- Start simple: exact prefix, substring, token overlap, and edit-distance-style similarity if cheap.
- Return suggestions such as: `agentic-context` not found; similar existing tags: `agent-context`.
- Do not auto-rewrite tags in the MVP.

Acceptance:

- Empty tag-filter searches show useful near misses.
- Save/update paths can warn when a new tag looks like an existing tag.

### Slice 4 — Align todo storage with the field-vs-tag rule — partially implemented

- Stop adding workflow tags such as `todo`, `p1`, and non-open status tags as ordinary content tags.
- Preserve todo priority/status/nextAction in structured tool fields and the rendered todo summary; no new columns were needed for this slice.
- Keep backwards compatibility for old records that already have workflow tags.
- Follow-up: decide whether old workflow tags should be reported as cleanup candidates, migrated explicitly, or left as historical data.

Acceptance:

- New todos no longer pollute content-tag inventory with workflow-state tags.
- Existing todo update/list behavior remains stable.
- Tests cover migration/compatibility for old priority tags.

### Slice 5 — Retrieval/ranking polish

- Boost exact tag matches above weak lexical/semantic matches.
- On empty results, show near tag matches instead of only saying no memories matched.
- Keep turn-start context small; do not inject the full tag catalog automatically.

Acceptance:

- Exact tag queries reliably outrank unrelated semantic matches.
- Near-miss output helps agents retry without creating duplicate tags.

## Tests and verification

- Unit tests for tag normalization, catalog derivation, and near-tag suggestions.
- Tool tests for catalog/audit output and save/update warnings.
- Regression tests for todo priority/status/nextAction update behavior.
- Retrieval evals for exact tag ranking and empty-result near misses.
- Docs-only slices: `git diff --check` and link/path inspection.
- Code slices: `npm test` plus relevant smoke checks only when local Pi runtime is healthy.

## Open questions

- Should preferred tags be purely derived from usage, or should there also be a small curated global catalog memory?
- Should old workflow tags be cleaned by audit recommendations only, by an explicit migration, or left as historical data?
- Should save/update paths warn when a new tag is close to an existing catalog tag?

## Risks

- A formal alias system may become ontology bloat; avoid it in the MVP.
- A full catalog in turn-start context would add token cost; keep it on-demand.
- Removing automatic todo tags is behavior-changing and needs compatibility tests.
