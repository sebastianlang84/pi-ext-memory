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

### v2.0.0 — Memory Model Minimisation

Complete. All slices verified and implemented.

## Quality Reviews

Architecture deepening program: follow [Plan — Architecture Deepening](docs/plans/architecture-deepening.md). Remove each slice item after its verified commit.

### TDD Review (2026-05-13)

Findings from TDD-lens review of all 20 test files. Fix in priority order; remove each item after its verified commit.

4. **[P2] `identity-policy.test.ts` — Fragilität reduzieren.** Direkte Tests auf interne Policy-Exports (`applyRuntimeIdentityEnrichment`, `resolveMemoryIdentityForScope`) sind auf Modul-Struktur fixiert. Behavior ist bereits via Tool-Layer abgedeckt; prüfen ob direkte Unit-Tests noch Mehrwert liefern oder entfernt werden können. → *Reviewed: Unit-Tests decken Edge-Cases ab, die im Tool-Layer nicht explizit erscheinen. Behalten.*
6. **[P3] Fehlende Tool-Layer-Coverage ergänzen:** Handoff-Preload bei leerem Prompt.

## Open Design Issues

No open design issues. Add new entries here only when fresh design work is accepted.

## Architecture Review — Deepening Candidates

From improve-codebase-architecture skill review (2026-05-13). Each item is a deepening opportunity — resolve by grilling before implementing.

