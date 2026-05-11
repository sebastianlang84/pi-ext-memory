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
memory_search          — search durable memory (semantic + lexical)
memory_list            — filter memories by kind, scope, tags, status
memory_save            — save facts, preferences, decisions, notes, progress snapshots (kind=progress_snapshot)
memory_save_todo       — save actionable open tasks (priority, status, scope)
memory_save_handoff    — save/refresh resumable agent handoff state
memory_update          — patch an existing memory by id
memory_archive         — archive obsolete memories
memory_audit           — report stale todos and old handoffs (report-only, no auto-archive)
memory_link            — link related memories (optional, V2)
/memory-status         — show extension status and config
/memory-search <query> — manual memory search
/memory-handoff        — show or archive the active session handoff
/memory-audit          — same as memory_audit tool, output to terminal
```

Optional configuration:

- `PI_MEMORY_DB_PATH` overrides the SQLite database path.
- `PI_MEMORY_BGE_M3_COMMAND` enables a local BGE-M3 embedding command adapter.

## License

MIT. See `LICENSE`.
