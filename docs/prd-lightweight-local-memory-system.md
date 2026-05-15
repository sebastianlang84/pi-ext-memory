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
- Filter nach Scope, Repo-/Session-Identität, optionalem Kind und Tags
- Session-Summaries speicherbar
- einfache Integration in Pi
- später erweiterbar Richtung MCP/OpenAPI

### Soll in V1

- einfache Konfiguration
- Import/Export einer Memory-Datei
- Archivierung und Audit-Hinweise für kurzlebige Einträge; keine automatische TTL/Expiry in der aktuellen V1-Linie
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

**V1-Stand: persistierte JSON-Vektoren plus Application-Layer-Ranking**

Begründung:

- sehr leichtgewichtig
- passt gut zu SQLite ohne zusätzliche native Extension
- local-first und portabel
- ausreichend für den aktuellen V1-Kandidatenumfang

Risiko:

- bei sehr großen Stores kann ein spezialisierter Vektorindex später nötig werden
- Ranking-Performance muss mit wachsender Memory-Menge beobachtet werden

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

Nachlaufende Validierung:

- v1.0.0 wurde mit grünen automatisierten Tests und Pi-Smokes geschlossen; `PI_MEMORY_BGE_M3_COMMAND` war dabei nicht konfiguriert, daher validierte der Release-Gate den deterministischen Fallback-Pfad.
- Auf Zielmaschinen weiter beobachten, ob der BGE-M3-Command schnell genug ist.
- Deterministischen Fallback beibehalten, bis reale Messungen ein anderes leichtes semantisches Fallback-Modell rechtfertigen.

### 6.5 Architekturform

**V1 läuft als lokale In-Process-Pi-Extension mit eigenständigem Core**

Ziel:

- Pi kann lokal zugreifen
- Kernlogik bleibt von Pi-spezifischer Integration getrennt
- spätere Öffnung über MCP/OpenAPI bleibt möglich

Aktueller Stand:

- Core als eigenständige Komponente mit klarer API-Grenze
- Pi-Extension als Adapter
- kein localhost-Service für V1

---

## 7. Memory-Modell

Das System speichert **verdichtete Erinnerungen**, nicht primär Rohdialoge.

### Memory-Arten

- generische, kindlose Memories für dauerhafte Notizen, Fakten, Entscheidungen, Präferenzen und Kontext
- **todo** — explizit strukturierte offene Aufgabe oder Wiedervorlage
- **handoff** — explizit strukturierter Übergabe-/Resume-Kontext für Sessions, Resets oder Agent-Transfers

### Status

- **active** — normal abrufbar
- **archived** — dauerhaft erhalten, aber aus normalen aktiven Flows entfernt

### Scope

- **global**
- **project** — Legacy/Advanced-Kompatibilität
- **repo**
- **session**

### Prinzip

Statt kompletter Chat-Historie sollen kompakte Einträge gespeichert werden, z. B.:

- Entscheidung + Begründung als kindlose Memory
- Problem + Ursache + Fix als kindlose Memory
- Präferenz + Gültigkeitsbereich als kindlose Memory
- explizites Todo über `memory_save_todo`
- expliziter Handoff über `memory_save_handoff`
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
- lexikalische Treffer in Titel, Zusammenfassung, Body und Tags
- optionale Metadaten-/Tag-Filter

Ziel:
Nicht nur semantisch „ähnliche“ Erinnerungen finden, sondern die **relevantesten** für den aktuellen Agent-Kontext.

---

## 9. V1 Datenmodell (konzeptionell)

### memories

- id
- kind — optional; nur dedizierte Flows setzen aktuell `todo` oder `handoff`, generische Memories bleiben kindlos
- status — `active` oder `archived`
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

### memory_embeddings

- memory_id
- model
- dimensions
- vector_json
- content_hash
- created_at
- updated_at

### sessions

- session_id
- started_at
- ended_at
- summary
- project_id

Nicht mehr Teil des aktuellen V1-Modells sind `expires_at`, Link-Relationen oder separate Artifact-Tabellen/APIs.

---

## 10. V1 API-Richtung

Auch wenn V1 lokal-only startet, soll die Kernfunktionalität sauber kapselbar sein.

### Kernoperationen

- create generic memory
- save explicit todo
- save explicit handoff
- update memory
- search memory
- list/filter memories
- get memory by id
- archive memory über Status-Update
- summarize session

Nicht aktuelle V1-API sind Link-Memory-Operationen, Artifact-APIs, TTL/Expiry-Operationen oder Pin/Unpin-Flows.

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

- Application-Layer-Vektorsuche könnte bei sehr großen Stores an Grenzen kommen
- Embedding-Latenz lokal könnte auf schwachen Maschinen stören
- BGE-M3 könnte für manche Zielrechner zu schwer sein

### Produktseitig

- zu viel automatisch gespeicherter Müll verschlechtert Retrieval
- zu wenig Struktur macht das System wertlos
- falsche Granularität der Memories

---

## 14. Post-v1 offene Fragen

1. **Soll ein späterer Runtime-Ansatz über die In-Process-Pi-Extension hinausgehen?**
   - nur wenn Evidenz einen kleinen localhost-Service oder eine andere Integrationsgrenze rechtfertigt

2. **Soll der deterministische Fallback ersetzt werden?**
   - nur wenn reale Messungen ein anderes leichtes semantisches Fallback-Modell rechtfertigen

3. **Wie weit soll Memory-Erzeugung nach V1 automatisiert werden?**
   - aktueller Stand bleibt manual-first mit expliziten Tools/Commands
   - spätere Optionen: heuristisch halbautomatisch oder automatisch mit Review

4. **Welche aktiven Einträge brauchen Hygiene- oder Archivierungsregeln?**
   - aktuelle V1-Linie: keine automatische Expiry; Audit weist auf alte Handoffs und stale Todos hin, Archivierung bleibt explizit

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
- persistierte Vektoren mit Application-Layer-Ranking
- FTS5
- DE+EN Embeddings
- lokale Persistenz
- Memory CRUD
- Hybrid Search
- Session Summary speichern
- kindlose Memories für Fakten, Entscheidungen, Präferenzen und Kontext; dedizierte `todo`- und `handoff`-Flows
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

## 17. Post-v1 Nachlauf

1. Real-machine BGE-M3-Command-Adapter-Qualität und Latenz im normalen Einsatz beobachten.
2. Deterministischen Fallback beibehalten, bis Messungen ein anderes leichtes semantisches Fallback-Modell rechtfertigen.
3. Runtime-Grenze erneut als ADR bewerten, falls Evidenz später gegen die aktuelle In-Process-Pi-Extension spricht.
4. Späteres MCP/OpenAPI-Zielbild festhalten, wenn eine zweite Integrationsoberfläche konkret wird.
