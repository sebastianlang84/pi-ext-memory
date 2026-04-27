---
role: Product requirements document for the V1 local memory system
contains: Problem statement, goals, product decisions, scope, risks, and next work packages
not-contains: Final implementation details, ADR-level decisions, or active task tracking
write-when: Product scope, requirements, or major direction changes
---

# PRD — Lightweight Local Memory System for Coding Agents

## 1. Ziel

Ein **superleichtes lokales Memory-System** für Coding Agents, das auf möglichst vielen PCs zuverlässig läuft, **Deutsch und Englisch** unterstützt und in **V1 primär für Pi** als Extension nutzbar ist.

Das System soll:

- wichtige Erinnerungen dauerhaft speichern,
- semantisch und lexikalisch wiederauffindbar machen,
- ohne zentrale Infrastruktur funktionieren,
- später über **MCP** oder **OpenAPI** auch für andere Agents geöffnet werden können.

Nicht Ziel von V1 ist ein allgemeines Code-Indexierungs- oder Repo-Search-System.

---

## 2. Problem

Coding Agents verlieren zwischen Sessions, Resets, Kompaktierungen oder Modellwechseln wichtigen Kontext.

Typische Probleme:

- Architekturentscheidungen gehen verloren
- Präferenzen des Users werden nicht stabil erinnert
- bereits gelöste Probleme werden erneut untersucht
- wichtige TODOs oder Risiken verschwinden im Chatverlauf
- Kontext ist zwar vorhanden, aber später nicht gut abrufbar

Ein Chatverlauf allein ist dafür ungeeignet, weil er:

- zu unstrukturiert ist,
- zu viel Rauschen enthält,
- schlecht semantisch durchsuchbar ist,
- keine klare Trennung zwischen langfristigem und kurzfristigem Wissen bietet.

---

## 3. Produktvision

Das Produkt ist ein **lokaler Memory-Layer für Agents**.

Er soll wie ein kleines externes Gedächtnis funktionieren:

- lokal,
- portabel,
- billig,
- einfach zu integrieren,
- später standardisiert ansprechbar.

Default-Prinzip:

- **local-first**
- **single-user**
- **single-file storage** wenn sinnvoll
- **hybrid retrieval** statt reiner Vektorsuche
- **Memory-Objekte statt Rohchat-Archiv**

---

## 4. Zielgruppe

### Primär in V1

- Einzelne Entwickler mit Pi Coding Agent
- lokale Nutzung auf Windows, Linux, macOS
- technisch versierte User

### Später

- andere Agent-Harnesses
- mehrere Clients über MCP/OpenAPI
- optional Team-/Shared-Memory-Modi

---

## 5. Kernanforderungen

### Muss in V1

- lokal ausführbar ohne Docker-Zwang
- funktioniert auf normalen Entwickler-PCs
- DE+EN Retrieval
- speichert strukturierte Memory-Objekte
- semantische Suche + exakte Textsuche
- Filter nach Projekt/Scope/Typ
- Session-Summaries speicherbar
- einfache Integration in Pi
- später erweiterbar Richtung MCP/OpenAPI

### Soll in V1

- einfache Konfiguration
- Import/Export einer Memory-Datei
- TTL oder Archivierung für kurzlebige Einträge
- Ranking mit Recency/Importance

### Nicht in V1

- Multi-User-Rechteverwaltung
- Cloud Sync
- komplexe zentrale Serverarchitektur
- vollautomatische Codebase-Indexierung
- schwere Background-Infrastruktur

---

## 6. Produktentscheidungen (aktueller Stand)

### 6.1 Datenbank

**Default: SQLite**

Begründung:

- extrem portabel
- lokal und robust
- einfach zu deployen
- keine separate Server-Komponente nötig
- gut geeignet für strukturierte Metadaten und FTS

### 6.2 Vektor-Layer

**Default: sqlite-vec**

Begründung:

- sehr leichtgewichtig
- passt gut zu SQLite
- local-first
- pre-v1 ist akzeptabel

Risiko:

- unreifer als etabliertere Alternativen
- Breaking Changes möglich

### 6.3 Lexikalische Suche

**Default: SQLite FTS5**

Begründung:

- wichtig für exakte Begriffe, Ticketnummern, Dateinamen, APIs
- ergänzt semantische Suche sinnvoll

### 6.4 Embedding-Modell

**Arbeits-Default: lokaler BGE-M3-Command-Adapter**

Begründung:

- DE+EN ist Pflicht
- multilingual stark
- gut für gemischte Memory-Inhalte
- besserer Fit für zweisprachiges Retrieval als ein rein englisch optimierter Standard-Default

Konfiguration in der aktuellen Richtung:

- Pi-memory nutzt bevorzugt einen lokalen Command-Adapter über `PI_MEMORY_BGE_M3_COMMAND`
- Der Command muss einen validen 1024-dimensionalen BGE-M3-Vektor liefern und läuft mit begrenztem Timeout (`PI_MEMORY_BGE_M3_TIMEOUT_MS`, default 15s)
- Falls kein Command konfiguriert ist, fällt der Default-Pfad deterministisch auf `builtin-hash-384-v1` zurück
- Ein Low-Footprint-Profil bleibt mit `builtin-hash-64-v1` verfügbar

Offene Validierung:

- vor v1.0 auf Zielmaschinen prüfen, ob der BGE-M3-Command schnell genug ist
- deterministischen Fallback beibehalten, bis reale Messungen ein anderes leichtes semantisches Fallback-Modell rechtfertigen

### 6.5 Architekturform

**V1 bevorzugt als lokale Library oder kleiner lokaler Service**

Ziel:

- Pi kann lokal zugreifen
- Kernlogik bleibt von Pi-spezifischer Integration getrennt
- spätere Öffnung über MCP/OpenAPI wird einfacher

Aktuelle Tendenz:

- Core als eigenständige Komponente mit klarer API-Grenze
- Pi-Extension als Adapter

---

## 7. Memory-Modell

Das System speichert **verdichtete Erinnerungen**, nicht primär Rohdialoge.

### Memory-Typen

- **fact** — stabile Fakten
- **preference** — User- oder Projektpräferenzen
- **decision** — getroffene technische/produktbezogene Entscheidungen
- **episode** — relevantes Ereignis oder Arbeitskontext
- **artifact_ref** — Verweis auf Datei, PR, Commit, Ticket, Doc
- **todo** — offene Aufgabe oder Wiedervorlage

### Scope

- **global**
- **project**
- **repo**
- **session**

### Prinzip

Statt kompletter Chat-Historie sollen kompakte Einträge gespeichert werden, z. B.:

- Entscheidung + Begründung
- Problem + Ursache + Fix
- Präferenz + Gültigkeitsbereich
- Session-Zusammenfassung

---

## 8. Retrieval-Modell

Retrieval soll **hybrid** sein.

### Reihenfolge

1. Metadatenfilter
2. FTS-Lexikalsuche
3. Vektorsuche
4. App-Layer-Ranking

### Ranking-Faktoren

- Scope-Match
- Projekt-/Repo-Match
- Recency
- Importance
- Confidence
- exakte Tag-Treffer
- manuell gepinnte Einträge

Ziel:
Nicht nur semantisch „ähnliche“ Erinnerungen finden, sondern die **relevantesten** für den aktuellen Agent-Kontext.

---

## 9. V1 Datenmodell (konzeptionell)

### memories

- id
- kind
- scope
- title
- summary
- body
- tags
- source_agent
- project_id
- repo_path
- branch
- importance
- confidence
- created_at
- updated_at
- last_accessed_at
- expires_at
- embedding

### links

- from_id
- to_id
- relation

### sessions

- session_id
- started_at
- ended_at
- summary
- project_id

### artifacts

- artifact_id
- type
- external_id
- path_or_url
- title
- metadata_json

---

## 10. V1 API-Richtung

Auch wenn V1 lokal-only startet, soll die Kernfunktionalität sauber kapselbar sein.

### Kernoperationen

- create memory
- update memory
- search memory
- get memory by id
- link memories
- pin / unpin memory
- forget / archive memory
- summarize session
- compact memory

Spätere Exposition:

- MCP Tools
- OpenAPI-Endpunkte

---

## 11. Integration mit Pi in V1

### Minimalziel

Pi kann:

- nach relevanten Erinnerungen suchen
- neue Erinnerungen schreiben
- Session-Summaries persistieren
- wichtige Entscheidungen/Facts markieren
- als normales Pi-Paket installiert und per Package-Manifest geladen werden

### Noch offen

- wie stark automatisch extrahiert werden soll
- wann geschrieben wird: explizit, heuristisch oder am Session-Ende
- wie viel Kontrolle der User über Auto-Save bekommen soll

---

## 12. Nicht-funktionale Anforderungen

- lokale Persistenz
- geringer Ressourcenverbrauch
- gute Startzeit
- robust bei Abstürzen
- einfache Backups
- einfache Debugbarkeit
- einfache Migrationen
- plattformübergreifend

---

## 13. Hauptrisiken

### Technisch

- sqlite-vec ist pre-v1
- Embedding-Latenz lokal könnte auf schwachen Maschinen stören
- BGE-M3 könnte für manche Zielrechner zu schwer sein

### Produktseitig

- zu viel automatisch gespeicherter Müll verschlechtert Retrieval
- zu wenig Struktur macht das System wertlos
- falsche Granularität der Memories

---

## 14. Offene Fragen

1. **Welcher Runtime-Ansatz für V1?**
   - reine lokale Library
   - kleiner localhost-Service

2. **Welches Embedding-Fallback für schwächere PCs?**
   - kleineres multilinguales Modell?
   - optional externer Embedder?

3. **Wie erfolgt Memory-Erzeugung?**
   - manuell
   - heuristisch halbautomatisch
   - automatisch mit Review

4. **Welche Einträge dürfen verfallen?**
   - episodes / todos / temporäre Hinweise

5. **Wie wird Compaction umgesetzt?**
   - sessionbasiert
   - eventbasiert
   - explizit durch Agent/User

6. **Wie stark soll Pi intern daran gekoppelt sein?**
   - dünner Adapter
   - tiefe Integration

---

## 15. Vorschlag für V1 Scope

### Enthalten

- SQLite
- sqlite-vec
- FTS5
- DE+EN Embeddings
- lokale Persistenz
- Memory CRUD
- Hybrid Search
- Session Summary speichern
- Fact/Decision/Preference/Todo/Episode
- einfacher Pi-Adapter

### Nicht enthalten

- Team Sharing
- zentrale DB
- Auth
- Rechteverwaltung
- UI mit großem Umfang
- agentübergreifende Remote-Nutzung

---

## 16. Erfolgskriterien für V1

- ein Nutzer kann lokal innerhalb weniger Minuten starten
- Pi kann Erinnerungen lesen und schreiben
- relevante frühere Entscheidungen werden zuverlässig wiedergefunden
- DE+EN Queries liefern brauchbare Treffer
- die Daten sind lokal nachvollziehbar und portabel
- Retrieval verschlechtert sich nicht durch zu viel Rauschen

---

## 17. Nächste sinnvolle Arbeitspakete

1. finale Entscheidung: **Library vs localhost-Service**
2. finale Entscheidung: **BGE-M3 vs kleineres Fallback-Modell**
3. konkretes SQL-Schema definieren
4. Search-/Ranking-Strategie definieren
5. Write-Policy definieren
6. Pi-Integrationsgrenze definieren
7. später MCP/OpenAPI-Zielbild festhalten
