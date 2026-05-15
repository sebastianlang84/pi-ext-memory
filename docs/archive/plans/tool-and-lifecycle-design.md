# pi-ext-memory — Schlankes Tool- und Lifecycle-Design

Status: archived/superseded by later ADRs and implementation.

> Archived note: this document is historical design context. Current behavior is defined by code, `README.md`, `TODO.md`, and accepted ADRs; stale mentions of removed kinds/tools are not active guidance.

## Ausgangsproblem

`pi-ext-memory` ist eine SQLite-basierte Memory-Extension für den Pi Coding Agent. Sie speichert strukturierte Erinnerungen wie Facts, Decisions, Todos und Handoffs über Sessions hinweg.

Das Designproblem:

- LLM-Tools und interne Jobs nutzen aktuell dieselbe Query-/Validierungsschicht.
- `listMemories()` hat ein hartes Limit von 20.
- Dieses Limit ist für Tool-Ausgaben sinnvoll, aber für interne Jobs wie den Audit falsch.
- `memory_list` ohne Pagination ist irreführend, weil der Agent nie weiß, ob er alles gesehen hat.
- Ohne Caps und Lifecycle-Regeln kann die aktive DB-Nutzung zur ungepflegten Müllhalde werden.

## Grundsatz

```txt
LLM-output cap: ja
Internal query cap: nein
Active working-set cap: ja
Archive/history cap: weich
```

Das Problem ist nicht `limit: 20` selbst, sondern dass dasselbe Limit für Tool-Ausgabe und interne Logik verwendet wird.

---

# 1. Schichten: einfach halten

Kein unnötiger Service-Layer nötig, solange das Projekt klein bleibt.

Empfohlen reicht:

```txt
Store/Core:
- direkte SQLite-Zugriffe
- interne Queries ohne Tool-Cap
- Lifecycle-Helfer wie expire/cleanup

Tool-Handler:
- LLM-sichere Outputs
- Validierung der Tool-Inputs
- Pagination/Limit für Agent-Ausgaben
```

## Store-Funktionen

```ts
store.listForTool(filter, { limit, offset })
store.listAllInternal(filter) // no hard result cap
store.count(filter)
store.save(memory)
store.update(id, patch)
store.archive(id)
```

`listAllInternal()` reicht für lokales SQLite völlig aus. Bei typisch unter 1000 Einträgen ist ein AsyncIterator übertrieben.

Wichtig:

```txt
Interne Jobs dürfen nie über Tool-Limits laufen.
```

Der Audit nutzt also:

```ts
store.listAllInternal(filter)
```

Nicht:

```ts
memory_list(...)
```

---

# 2. `memory_search` vs. `memory_list`

## `memory_search`

Für inhaltliches Retrieval.

Beispiele:

```txt
Was hatten wir zu memory_audit entschieden?
Welche frühere Entscheidung betraf stale handoffs?
Gab es schon eine Notiz zu SQLite pagination?
```

Typisch:

```ts
memory_search({
  query?: string,  // optional; wenn leer: gefilterte Recent-Suche, sortiert nach updated_at DESC
  kind?: [
    "fact",
    "decision",
    "todo",
    "handoff",
    "episode",
    "artifact_ref",
    "progress_snapshot"
  ],
  scope?: "repo" | "project" | "global",
  limit?: number
})
```

## `memory_list`

Nur als State-Inspector sinnvoll, nicht als generisches Browse-Tool.

Beispiele:

```txt
Zeig aktive Todos im aktuellen Repo.
Zeig aktive Handoffs im aktuellen Repo.
Zeig die letzten Decisions.
```

Generisches `memory_list` sollte nur strikt gefiltert und paginiert existieren:

```ts
memory_list({
  kind: "todo" | "handoff" | "decision" | "fact" | "episode" | "artifact_ref" | "progress_snapshot",
  status?: "active" | "done" | "archived" | "superseded",
  stale?: boolean,          // computed, not stored
  scope: "repo" | "project" | "global",
  repoPath?: string,        // optional; narrows repo scope when available
  projectId?: string,       // optional; narrows project scope when available
  limit?: number,
  offset?: number
})
```

Antwort immer mit Pagination-Metadaten:

```ts
{
  items: [...],
  count: 20,          // items in this page
  total_count: 123,   // total matching records
  has_more: true,
  next_offset: 20
}
```

Statuswerte werden kind-spezifisch validiert:
- `done` ist nur für `todo` gültig
- `superseded` ist nur für `decision` / `fact` gültig
- `handoff` kennt nur `active` / `archived`

## Empfehlung

Kein freies `memory_list({})`.

Besser als normale Agent-Tools:

```ts
memory_search
memory_save              // fact | decision | episode | artifact_ref | progress_snapshot
memory_save_todo
memory_save_handoff
memory_update
memory_archive
memory_list_active_todos
memory_list_active_handoffs
```

Optional für Debug/Admin:

```ts
memory_list_filtered_paginated
memory_stats
```

Tool-Semantik:

```txt
memory_search               = "Was weißt du inhaltlich zu X?" (semantisches Retrieval)
memory_list                 = "Zeig Einträge dieses Typs in diesem Scope." (gefilterte Inspection)
memory_list_active_todos    = "Zeig aktuellen Todo-Arbeitszustand." (convenience shortcut)
memory_list_active_handoffs = "Zeig aktuellen Übergabezustand." (convenience shortcut)
internal listAll            = vollständige DB-Prüfung (Audit, nie LLM-Tool)
```

Policy:

```txt
memory_list darf nie ohne kind + scope laufen.
memory_list muss immer paginiert und tool-output-capped sein.
memory_list ist kein interner Audit-Pfad.
```

---

# 3. Statusmodell: `stale` nicht persistieren

`stale` sollte berechnet bleiben, kein eigener DB-Status werden.

Warum:

- Keine Migration nötig.
- Kein Background-Job nötig.
- Kein Risiko, dass persistierter Status und Zeitlogik auseinanderlaufen.

Persistierte Status bleiben klein:

```txt
todo: active | done | archived
handoff: active | archived
decision: active | archived | superseded
fact: active | archived | superseded
```

Berechnete Flags:

```txt
stale = now > stale_after
expired = now > expires_at
near_cap = active_count >= warn_threshold
```

Beispiel:

```ts
const isTodoStale = todo.status === "active" && todo.stale_after && now > todo.stale_after
const isHandoffExpired = handoff.status === "active" && handoff.expires_at && now > handoff.expires_at
```

---

# 4. Caps pro Scope

Caps müssen für Repo-, Project- und Global-Scope gelten.

## Repo-Scope

```txt
Active handoffs per repo:
- warning: 7
- hard cap: 10

Active todos per repo:
- warning: 30
- hard cap: 50
```

## Project-Scope

Ein Project kann mehrere Repos umfassen. Deshalb gilt dieselbe Todo-Obergrenze wie für Repo, aber Handoffs bleiben kurzlebig.

```txt
Active handoffs per project:
- warning: 7
- hard cap: 10

Active todos per project:
- warning: 30
- hard cap: 50
```

## Global-Scope

Global Memories sind gefährlicher, weil sie überall geladen oder gesucht werden können. Deshalb bleiben die Caps enger.

```txt
Active global handoffs:
- warning: 3
- hard cap: 5

Active global todos:
- warning: 10
- hard cap: 20
```

## Nicht in Active-Caps zählen

```txt
done
archived
superseded
```

## Warum Todo-Hard-Cap 50 für Repo/Project?

Mehr als 50 aktive Todos pro Repo oder Project sollte es nicht geben. Wenn diese Grenze erreicht wird, wird `pi-ext-memory` wahrscheinlich als Backlog-System missbraucht.

Projektweite, versionierte oder teamrelevante Todos gehören eher in:

```txt
TODO.md
Issues
Projektmanagement-System
```

`pi-ext-memory` Todos sind lokale Agent-/Inter-Task-Arbeit, nicht das zentrale Projekt-Backlog.

---

# 5. Handoff-Policy

Handoffs sind kurzlebiger Übergabe-/Session-Kontext.

## Zielwerte

```txt
Repo handoffs:
- ideal: 0–5 active
- warning: >7
- hard cap: 10

Project handoffs:
- ideal: 0–5 active
- warning: >7
- hard cap: 10

Global handoffs:
- ideal: 0–2 active
- warning: >3
- hard cap: 5
```

## Felder

```ts
kind: "handoff"
scope: "repo" | "project" | "global"
repoPath?: string    // optional; narrows repo scope when available
projectId?: string   // optional; narrows project scope when available
status: "active" | "archived"
expires_at: Date
```

## Regeln

```txt
Default expires_at: now + 14 days
Expired handoffs werden im Audit gemeldet.
Expired handoffs zählen weiter als active, bis sie archiviert werden.
Bei Hard-Cap wird save abgelehnt.
```

Beispiel bei Cap-Überschreitung:

```json
{
  "error": "active_handoff_cap_exceeded",
  "scope": "repo",
  "active_count": 10,
  "hard_max": 10,
  "suggested_cleanup": [
    "archive expired handoffs",
    "merge or replace older handoff"
  ]
}
```

---

# 6. Todo-Policy

Todos sind lokale Agent-Arbeitsitems.

## Zielwerte

```txt
Repo todos:
- ideal: <20 active
- warning: >30
- hard cap: 50

Project todos:
- ideal: <20 active
- warning: >30
- hard cap: 50

Global todos:
- ideal: <5 active
- warning: >10
- hard cap: 20
```

## Felder

```ts
kind: "todo"
scope: "repo" | "project" | "global"
repoPath?: string      // optional; narrows repo scope when available
projectId?: string    // optional; narrows project scope when available
status: "active" | "done" | "archived"
priority?: "P0" | "P1" | "P2"
stale_after?: Date
```

## Regeln

```txt
Default stale_after: now + 30 days
Stale wird berechnet, nicht gespeichert.
Done-Todos können später archiviert werden.
Bei Hard-Cap wird save abgelehnt.
```

Beispiel:

```json
{
  "error": "active_todo_cap_exceeded",
  "scope": "repo",
  "repoPath": "/path/to/repo",
  "active_count": 50,
  "hard_max": 50,
  "suggested_cleanup": [
    "complete stale todos",
    "archive obsolete todos",
    "move long-term backlog to TODO.md or issues"
  ]
}
```

## Unterschied zu `TODO.md`

```txt
TODO.md:
- repo-sichtbar
- versioniert
- committet
- für andere Projektteilnehmer sichtbar
- eher langfristige Projekt-/Backlog-Todos

pi-ext-memory todos:
- lokal/agent-operational
- nicht zwingend committet
- inter-task next actions
- schnell speicherbar
- oft bald erledigt oder archiviert
```

---

# 7. Decision-Policy

Decisions sind langlebig und sollten nicht mit kleinen Active-Caps begrenzt werden.

## Felder

```ts
kind: "decision"
status: "active" | "archived" | "superseded"
supersedes?: memory_id[]
source?: string
```

## Regeln

```txt
Neue Entscheidung kann alte Decision superseden.
Keine harte 20er-Cap wie bei Todos.
Audit kann viele Decisions melden, aber nicht blockieren.
Bei widersprüchlichen Decisions: Warnung, kein automatisches Löschen.
```

---

# 8. Fact-Policy

Facts sind stabile Gegenwartswahrheiten, keine Chatlogs.

## Felder

```ts
kind: "fact"
status: "active" | "archived" | "superseded"
source?: string
```

## Regeln

```txt
Nur speichern, wenn längerfristig nützlich.
Keine reinen Verlaufsnotizen.
Bei Änderung update oder supersede.
Keine kleinen Caps wie bei Todos/Handoffs.
```

Optional kann der Audit warnen, wenn sehr viele globale active Facts existieren, aber nicht hart blockieren.

---

# 9. Dedupe: erstmal einfach halten

Fingerprint-/Fuzzy-Dedupe ist für die erste Version zu riskant, wenn nicht exakt definiert.

## Nicht empfohlen für v1

```txt
Fuzzy semantic duplicate detection
Embedding similarity als Save-Blocker
Unklare Content-Fingerprints
```

Risiken:

```txt
false positives -> wichtige Memories werden nicht gespeichert
false negatives -> Komplexität ohne Nutzen
schwer erklärbares Agent-Verhalten
```

## V1-Empfehlung

Nur einfache, transparente Duplikat-Hinweise:

```txt
Exact duplicate check:
- same kind
- same scope
- normalized title/content exactly equal
- same repoPath when scope=repo
- same projectId when scope=project
- global scope when scope=global
```

Verhalten:

```txt
Exact duplicate -> existing entry zurückgeben oder Update anbieten
Near duplicate -> höchstens warnen, nicht blockieren
```

Später optional:

```txt
memory_search vor save nutzen, um ähnliche Einträge dem Agent zu zeigen
Agent entscheidet, ob update oder new save
```

---

# 10. Save-Pipeline

Müllvermeidung muss beim Schreiben passieren. Alle Save-Tools (`memory_save`, `memory_save_todo`, `memory_save_handoff`) laufen durch dieselbe interne Pipeline.

## Interne Save-Pipeline prüft

```txt
1. Ist kind erlaubt?
2. Ist scope klar?
3. Wird ein Active-Cap überschritten?
4. Fehlen Default-Zeitfelder?
5. Gibt es ein exaktes Duplikat?
6. Ist der Eintrag für Memory sinnvoll oder eher Scratch/Chatlog?
```

Beispiel:

```ts
saveMemory(input) {
  const normalized = normalize(input)

  applyDefaults(normalized)
  // memory_save_todo:    stale_after  = now + 30d
  // memory_save_handoff: expires_at   = now + 14d
  // memory_save applies no time defaults (fact/decision/episode/artifact_ref/progress_snapshot)

  const cap = getActiveCap(normalized.kind, normalized.scope)
  if (cap && activeCount(normalized.kind, normalized.scope) >= cap.hardMax) {
    return rejectWithCleanupCandidates(normalized)
  }

  const exactDuplicate = findExactDuplicate(normalized)
  if (exactDuplicate) {
    return { status: "duplicate", existing: exactDuplicate }
  }

  return store.save(normalized)
}
```

---

# 11. Audit-Design

Kein Background-Timer nötig.

## Trigger

```txt
Sessionstart: Audit für aktuellen Repo/Scope
Manual: memory_audit für Debug/Admin
On-save: lokale Invariantenprüfung
```

Kein täglicher Background-Audit, solange die Extension kein allgemeines Background-Konzept hat.

## Interne Query

```ts
const memories = store.listAllInternal({
  scope: currentScope,
  kind: ["todo", "handoff"],
  status: ["active"]
})
```

## Audit prüft

```txt
active todo count vs warning/hard cap
active handoff count vs warning/hard cap
stale todos via stale_after
expired handoffs via expires_at
old done todos, die archiviert werden könnten
```

## Ausgabe an Agent

Kompakt, keine lange Liste ohne Bedarf.

```json
{
  "scope": "repo",
  "active_todos_count": 36,
  "stale_todos_count": 4,
  "active_handoffs_count": 8,
  "expired_handoffs_count": 2,
  "warnings": [
    "Active todo count above warning threshold: 36 active, warn at 30, hard cap 50",
    "Active handoff count above warning threshold: 8 active, warn at 7, hard cap 10",
    "2 handoffs expired"
  ],
  "suggested_actions": [
    "Review stale todos",
    "Archive expired handoffs"
  ]
}
```

---

# 12. `memory_stats` definiert

`memory_stats` ist optional, aber sinnvoll als Debug-/Health-Tool.

## Zweck

Nicht Inhalte anzeigen, sondern Zustand der Memory-DB zusammenfassen.

## Beispiel-Output

```json
{
  "scope": "repo",
  "counts": {
    "todo": {
      "active": 36,
      "done": 8,
      "archived": 40,
      "stale_computed": 4
    },
    "handoff": {
      "active": 8,
      "archived": 12,
      "expired_computed": 2
    },
    "decision": {
      "active": 18,
      "superseded": 3,
      "archived": 4
    },
    "fact": {
      "active": 25,
      "superseded": 2,
      "archived": 7
    }
  },
  "caps": {
    "active_todos": "36/50",
    "active_handoffs": "8/10"
  },
  "warnings": [
    "active todos: 36 active, warn at 30, hard cap 50",
    "active handoffs: 8 active, warn at 7, hard cap 10"
  ]
}
```

## Tool-Status

```txt
memory_stats: optional behalten
memory_compact: vorerst nicht anbieten
```

`memory_compact` wäre ein eigenes Feature und sollte erst definiert werden, wenn klar ist, ob alte Memories zusammengefasst, archiviert oder gelöscht werden sollen.

---

# 13. Konkretes v1-Toolset

## Normale Agent-Tools

```ts
memory_search
memory_list              // required: kind + scope; paginated
memory_save              // fact | decision | episode | artifact_ref | progress_snapshot
memory_save_todo         // todo only
memory_save_handoff      // handoff only
memory_update
memory_archive
memory_list_active_todos
memory_list_active_handoffs
```

`memory_list` ist das generische gefilterte List-Tool für alle Kinds. Es ersetzt fehlende spezifische List-Tools (z. B. für `decision`, `fact`, `episode`). `kind` und `scope` sind Pflichtfelder — freies `memory_list({})` wird abgelehnt.

## `memory_save_todo` und `memory_save_handoff`

Beide bleiben als vollwertige Agent-Tools erhalten.

Grund: Sie verwenden kind-spezifische Schemata mit Pflichtfeldern, die ein generisches `memory_save` nicht abdecken kann:

- `memory_save_todo`: `priority`, `nextAction`, `status`, `repoPath`/`projectId`
- `memory_save_handoff`: `goal`, `currentState`, `nextSteps`, `handoffReason`, `recipient`

Ein generisches `memory_save({ kind: "todo" })` würde diese Felder optional oder verloren gehen lassen. Der Agent würde schlechtere, unvollständigere Inputs liefern.

## `memory_list_active_todos`

Keine Pagination nötig, weil aktive Todos durch Caps begrenzt sind.

```ts
memory_list_active_todos({
  scope: "repo" | "project" | "global",
  repoPath?: string,   // optional; used to narrow repo scope when available
  projectId?: string,  // optional; used to narrow project scope when available
})
```

Maximale Ausgabe:

```txt
repo: <= 50 active todos
project: <= 50 active todos
global: <= 20 active todos
```

## `memory_list_active_handoffs`

Keine Pagination nötig, weil aktive Handoffs durch Caps begrenzt sind.

```ts
memory_list_active_handoffs({
  scope: "repo" | "project" | "global",
  repoPath?: string,   // optional; used to narrow repo scope when available
  projectId?: string,  // optional; used to narrow project scope when available
})
```

Maximale Ausgabe:

```txt
repo: <= 10 active handoffs
project: <= 10 active handoffs
global: <= 5 active handoffs
```

## Decisions abrufen

`memory_list_decisions` wird nicht als eigenes Tool angeboten. Decisions werden über `memory_search` abgerufen:

```ts
memory_search({
  kind: ["decision"],
  scope?: "repo" | "project" | "global",
  query?: string,
  limit?: number
})
```

Chronologische Inspection ist kein eigenständiger Kern-Use-Case, der ein eigenes Tool rechtfertigt.

## Optional Admin/Debug

```ts
memory_stats
memory_audit
```

## Nicht anbieten

```ts
memory_get_all
memory_dump
memory_list_unfiltered
memory_list_without_pagination
memory_list_decisions  // gestrichen; Decisions laufen über memory_search
memory_complete_todo
memory_recent_decisions
memory_compact         // erst später definieren
```

---

# 14. Default-Konfiguration v1

```ts
const MEMORY_POLICY = {
  repo: {
    todo: {
      activeWarnAt: 30,
      activeHardMax: 50,
      defaultStaleAfterDays: 30,
    },
    handoff: {
      activeWarnAt: 7,
      activeHardMax: 10,
      defaultTtlDays: 14,
    },
  },

  project: {
    todo: {
      activeWarnAt: 30,
      activeHardMax: 50,
      defaultStaleAfterDays: 30,
    },
    handoff: {
      activeWarnAt: 7,
      activeHardMax: 10,
      defaultTtlDays: 14,
    },
  },

  global: {
    todo: {
      activeWarnAt: 10,
      activeHardMax: 20,
      defaultStaleAfterDays: 30,
    },
    handoff: {
      activeWarnAt: 3,
      activeHardMax: 5,
      defaultTtlDays: 14,
    },
  },

  activeListTools: {
    pagination: false,
    reason: "active todos/handoffs are bounded by hard caps",
  },

  debugListTool: {
    defaultLimit: 20,
    maxLimit: 50,
    pagination: "offset-limit",
    requireFilters: true,
  },

  audit: {
    trigger: ["sessionstart", "manual"],
    useInternalUncappedList: true,
    noBackgroundTimer: true,
  },

  dedupe: {
    exactDuplicateOnly: true,
    fuzzyBlocker: false,
  },
}
```

---

# 15. Wichtigste Designentscheidungen

```txt
1. Kein AsyncIterator für lokales SQLite v1.
2. Kein zusätzlicher Service-Layer, solange Store + Tool-Handler reichen.
3. stale bleibt berechnet, nicht persistiert.
4. Dedupe nur exakt und transparent.
5. Active Todo Hard-Cap für repo/project: 50.
6. Active Handoff Hard-Cap für repo/project: 10.
7. Project-Scope ist gleichwertig zu repo/global zu definieren.
8. memory_list mit required kind + scope ist normales Agent-Tool — deckt alle Kinds ab (decision, fact, episode, etc.). Freies memory_list({}) ohne Filter wird abgelehnt. Keine Pagination nötig für memory_list_active_todos/handoffs, weil Caps die Ausgabe begrenzen.
9. Pagination nur für Debug/Admin-Listen, v1 mit offset + limit.
10. Kein täglicher Background-Audit ohne Background-Konzept.
11. memory_save_todo und memory_save_handoff bleiben als vollwertige Tools — kind-spezifische Pflichtfelder können nicht durch generisches memory_save abgedeckt werden.
12. memory_save ist auf fact/decision/episode/artifact_ref/progress_snapshot beschränkt — todo und handoff laufen über eigene Save-Tools.
13. memory_list_decisions gestrichen — Decisions laufen über memory_search.
14. projectId/repoPath sind optional, nicht required — fehlende Context-IDs schränken nur die Filtergenauigkeit ein.
15. memory_stats definieren oder weglassen; memory_compact weglassen.
16. Caps auch für global scope definieren.
```

---

# Merksatz

```txt
pi-ext-memory soll den aktuellen Agent-Arbeitszustand klein und abrufbar halten — nicht zur zweiten ungepflegten Projektmanagement-Datenbank werden.
```

