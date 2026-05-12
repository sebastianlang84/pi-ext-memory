---
role: Active open work backlog
contains: Open tasks with priority and status
not-contains: Completed history, durable decisions, or implementation notes
write-when: Active work or priorities change
---

# TODO / Active Backlog

Purpose: Active work only.
Rule: Completed items are removed, not checked off.

## Versioned delivery plan

No active release tasks; add new tasks here only when fresh work is accepted.

## Quality Reviews

### [REVIEW] Architecture review with `improve-codebase-architecture`

Run an architecture review using the `improve-codebase-architecture` skill after the current scope-identity follow-ups are stable. Focus on retrieval/memory quality, module boundaries, testability, and agent-navigability.

### [REVIEW] TDD review with `tdd`

Run a TDD/test-coverage review using the `tdd` skill. Focus on missing red/green coverage, regression gaps around scope identity, audit behavior, handoffs, and tool-facing validation.

## Open Design Issues

### [DESIGN] Tool surface simplification

**Problem:** The current normal tool surface still includes transitional convenience/admin tools from the archived lifecycle plan.

**Questions to check:**
- Should `memory_stats`, `memory_list_active_todos`, and `memory_list_active_handoffs` fold into `memory_list` defaults/catalog output?
- Should `memory_archive` fold into `memory_update(status="archived")` with an archive reason?
- Should `memory_link` become advanced/admin-only or be removed from normal agent exposure?
- Does `memory_list` need a no-scope catalog/bucket mode for navigation, or is filtered pagination enough?

**Impact:** Medium — affects agent clarity and future API shape, but should follow the scope simplification decision.

### [DESIGN] Tool-Naming — `memory_list_active_handoffs`

**Problem:** The tool name `memory_list_active_handoffs` feels very specific and may be unnecessarily long. It is still open whether a simpler name such as `memory_list_handoffs` would be clearer for agents.

**Questions to check:**
- Is `active` necessary in the name because the tool intentionally lists only active handoffs?
- Or is `memory_list_handoffs` enough if status, caps, and active defaults are clear in the schema and description?
- Should naming be unified as part of the planned tool API and scope-identity simplification?

**Impact:** Medium — affects agent clarity and tool API consistency, but does not block the scope-identifier decision.
