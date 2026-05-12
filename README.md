# pi-memory

Local, SQLite-backed memory for Pi coding agents. It stores structured facts, decisions, preferences, todos, and handoffs, then retrieves relevant context at the start of a turn.

## Install

```bash
pi install git:github.com/sebastianlang84/pi-ext-memory
```

For local development:

```bash
cd ~/dev/pi-extensions/pi-ext-memory
pi install .
```

## Usage

Check extension status:

```text
/memory-status
```

Common tools and commands:

```text
memory_search                — search durable memory (semantic + lexical)
memory_list                  — filter memories by kind+scope (required), paginated; returns total_count, has_more, next_offset
memory_list_active_todos     — list active todos for a scope (bounded by caps, no pagination)
memory_list_active_handoffs  — list active handoffs for a scope (bounded by caps, no pagination)
memory_stats                 — per-kind counts, cap utilisation, and warnings for a scope
memory_save                  — save facts, decisions, notes, progress snapshots (kind=progress_snapshot)
memory_save_todo             — save actionable open tasks (priority, status, scope)
memory_save_handoff          — save/refresh resumable agent handoff state
memory_update                — patch an existing memory by id (scope, repoPath, projectId, title, summary, body, tags, status, pinned, importance, confidence, expiresAt; priority+nextAction for kind=todo)
memory_archive               — archive obsolete memories
memory_audit                 — report stale todos and old handoffs (report-only, no auto-archive)
memory_link                  — link related memories (optional)
/memory-status               — show extension status and config
/memory-search <query>       — manual memory search
/memory-handoff              — show or archive the active session handoff
/memory-audit                — same as memory_audit tool, output to terminal
```

### Scope identity

`scope` selects the primary identity:

| Scope | Primary identity |
|---|---|
| `global` | none |
| `repo` | `repoPath` |
| `project` | `projectId` |
| `session` | `sessionId` |

Inside a Git repository, ordinary saves and todos default to `repo`; outside a repo they default to `global`. Tools reject contradictory filters such as `scope="repo"` plus `projectId`, avoiding accidental `project_id AND repo_path` misses.

### Active caps

| Scope | Todo hard cap | Handoff hard cap | Todo stale after | Handoff expires after |
|---|---|---|---|---|
| repo / session | 50 | 10 | 30 days | 14 days |
| project | 50 | 10 | 30 days | 14 days |
| global | 20 | 5 | 30 days | 14 days |

Saving past the hard cap returns an `active_*_cap_exceeded` error with cleanup suggestions. Archive or complete existing todos/handoffs first.

Optional configuration:

- By default, pi-memory stores SQLite state at `~/.pi/agent/state/pi-memory/memory.sqlite`.
- On first startup with the default path, if the new DB does not exist but the legacy `~/.pi/agent/pi-memory.sqlite` file does, pi-memory copies the legacy DB plus SQLite `-wal`/`-shm` sidecars into the new state path.
- `PI_MEMORY_DB_PATH` overrides the SQLite database path and disables the legacy default-path copy.
- `PI_MEMORY_BGE_M3_COMMAND` enables a local BGE-M3 embedding command adapter.

## License

MIT. See `LICENSE`.
