# pi-memory

Local, SQLite-backed memory for Pi coding agents. It stores durable notes, facts, decisions, preferences, todos, and handoffs, then retrieves relevant context at the start of a turn.

## Install

```bash
pi install git:github.com/sebastianlang84/pi-ext-memory
```

For local development:

```bash
cd ~/dev/pi-extensions/pi-ext-memory
pi install .
```

## Quick start

Check extension status:

```text
/memory-status
```

Search manually:

```text
/memory-search <query>
```

Save an explicit session summary:

```text
/memory-session-save <summary>
```

Normal agent tools are `memory_search`, `memory_list`, `memory_save`, `memory_save_todo`, `memory_save_handoff`, `memory_update`, `memory_audit`, and the read-only `memory_tag_catalog`.

`memory_stats` is available for advanced/admin health and capacity checks, but it is not the normal first-choice tool path.

## Developer checks

```bash
npm test
npm run check:token-injection
```

`check:token-injection` reports estimated token/char counts for prompt-facing tool metadata and turn-start memory injections.

## Documentation

- [User guide](docs/user/usage.md) — commands, tools, scopes, caps, configuration, and write guidance.
- [Product requirements](docs/product/prd-lightweight-local-memory-system.md) — product intent, V1 scope, risks, and success criteria.
- [Developer architecture](docs/developer/architecture.md) — core/extension boundaries, storage, retrieval, and verification.
- [Architecture decisions](docs/adr/) — durable design decisions.
- [Active backlog](TODO.md) — open work only.
- [Changelog](CHANGELOG.md) — user/operator-relevant release history.

## License

MIT. See `LICENSE`.
