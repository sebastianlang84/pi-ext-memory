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
memory_search
memory_save
memory_handoff_save
/memory-search <query>
/memory-handoff
```

Optional configuration:

- `PI_MEMORY_DB_PATH` overrides the SQLite database path.
- `PI_MEMORY_BGE_M3_COMMAND` enables a local BGE-M3 embedding command adapter.

## License

MIT. See `LICENSE`.
