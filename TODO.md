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

## Open Design Issues

### [DESIGN] Redundante Identifier — scope, repoPath, projectId

**Problem:** Das Tool erlaubt drei Identifier gleichzeitig für dasselbe Konzept:
- `scope="repo"` + `repoPath="/path/to/repo"`
- `scope="project"` + `projectId="name"`
- Kombinationen aus allen dreien

Für ein single-repo Projekt wie partflow könnte ein Agent theoretisch alle drei setzen obwohl alle dasselbe meinen. Es gibt keine erzwungene Regel wann welche Kombination gilt. Das führt zu:
- Inkonsistenten Saves (einmal `repoPath`, einmal `projectId`, einmal beides)
- Split-Memories die nicht zusammen gelistet werden weil Identifier nicht matchen
- Agent-Verwirrung weil zu viele Optionen ohne klare Konvention

**Erwartetes Verhalten / Lösungsoptionen:**
1. Entweder `repoPath` oder `projectId` — niemals beide gleichzeitig sinnvoll
2. Klare Regel dokumentieren: `scope="repo"` + `repoPath` für single-repo, `scope="project"` + `projectId` für multi-repo
3. Oder: Tool-Validierung die warnt/blockt wenn beide gesetzt sind
4. Oder: `scope` wird aus `repoPath`/`projectId` automatisch abgeleitet — ein Identifier reicht

**Impact:** Hoch — betrifft jeden Agent der project-scoped Memories schreiben will. Ohne klare Konvention ist konsistente Nutzung nicht möglich.
