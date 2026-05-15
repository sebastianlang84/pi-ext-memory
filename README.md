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

Normal tools and commands:

```text
memory_search                — search durable memory (semantic + lexical)
memory_list                  — list/filter structured memories; kind and scope are optional; paginated with total_count, has_more, next_offset
memory_save                  — save kindless durable notes, facts, decisions, and context
memory_save_todo             — save actionable open tasks (priority, status, scope)
memory_save_handoff          — save/refresh resumable agent handoff state
memory_update                — patch, close, or archive an existing memory by id; use archiveReason with status=archived when archiving
memory_audit                 — report scope identity issues and read-only legacy project migration preview
/memory-status               — show extension status and config
/memory-search <query>       — manual memory search
/memory-review               — show relevant existing memories and suggested cleanup/save actions
/memory-handoff              — show or archive the active session handoff
/memory-session-save <summary> — persist an explicit session summary
/memory-audit                — same as memory_audit tool, output to terminal
```

Use `memory_list` for normal listing and `memory_update(status="archived", archiveReason=...)` for normal archive flows.

### Scope identity

Normal agent-facing scopes are:

| Scope | Use when |
|---|---|
| `global` | The memory should apply across repositories. |
| `repo` | Future agents in the current repository/worktree should know it. |
| `session` | The state is short-lived handoff/resume/current-run context. |

Inside a Git repository, ordinary saves and todos default to `repo`; outside a repo they default to `global`. Tools reject contradictory filters such as `scope="repo"` plus `projectId`, avoiding accidental `project_id AND repo_path` misses.

`project` / `projectId` remains available only as legacy/advanced compatibility. Explicit `scope="project"` tool calls return a compatibility notice; new normal agent use should prefer `repo` with `repoPath`.

### Active caps

| Scope | Todo hard cap | Handoff hard cap |
|---|---|---|
| repo / session | 50 | 10 |
| global | 20 | 5 |
| legacy project | 50 | 10 |

Saving past the hard cap returns an `active_*_cap_exceeded` error with cleanup suggestions. Archive or complete existing todos/handoffs first.

Optional configuration:

- By default, pi-memory stores SQLite state at `~/.pi/agent/state/pi-memory/memory.sqlite`.
- On first startup with the default path, if the new DB does not exist but the legacy `~/.pi/agent/pi-memory.sqlite` file does, pi-memory copies the legacy DB plus SQLite `-wal`/`-shm` sidecars into the new state path.
- `PI_MEMORY_DB_PATH` overrides the SQLite database path and disables the legacy default-path copy.
- `PI_MEMORY_BGE_M3_COMMAND` enables a local BGE-M3 embedding command adapter.

## License

MIT. See `LICENSE`.
