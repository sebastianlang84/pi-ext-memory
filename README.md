# pi-memory

Local, SQLite-backed memory for Pi coding agents. It stores structured facts, decisions, preferences, todos, and handoffs, then retrieves relevant context at the start of a turn so agents do not have to rely on chat history.

## What it can do

- Save durable structured memories with kind, scope, tags, importance, and confidence.
- Search memories with hybrid lexical + semantic retrieval.
- List memories by structured filters without a search query.
- Update, link, and archive memories instead of duplicating or deleting context.
- Maintain one active structured handoff per Pi session.
- Preload the latest relevant handoff before normal memory retrieval.
- Store data locally in SQLite, by default at `~/.pi/agent/pi-memory.sqlite`.

## Tools

| Tool | Use it for |
| --- | --- |
| `memory_search` | Search memory text with optional kind/scope/tag/project/repo filters. |
| `memory_list` | List known structured memories, especially active todos or handoffs, without full-text search. |
| `memory_save` | Create a durable fact, decision, preference, todo, episode, or artifact reference. |
| `memory_handoff_save` | Create or update the active handoff for the current Pi session. |
| `memory_update` | Correct or refine an existing memory. |
| `memory_link` | Link related memories with relations such as `related_to`, `supersedes`, or `blocks`. |
| `memory_archive` | Archive stale or completed memories so they stop influencing active retrieval. |

## Commands

| Command | Use it for |
| --- | --- |
| `/memory-status` | Show pi-memory bootstrap/status information. |
| `/memory-search <query>` | Run a manual staged memory search. |
| `/memory-review` | Show relevant memories and suggested memory actions without saving anything. |
| `/memory-handoff` | Show the latest relevant active handoff. |
| `/memory-handoff archive` | Archive the active handoff for the current session. |
| `/memory-session-save <summary>` | Save a compact summary for the current Pi session. |

## Install

From a local clone:

```bash
cd /absolute/path/to/pi-ext-memory
pi install .
```

Upgrade an existing local install:

```bash
cd /absolute/path/to/pi-ext-memory
git pull
pi update .
```

If `pi update .` is not available for your install source, run `pi install .` again after pulling.

## Configuration

- `PI_MEMORY_DB_PATH` overrides the SQLite database path.
- `PI_MEMORY_BGE_M3_COMMAND` enables a local BGE-M3 embedding command adapter.
- Without a BGE-M3 command, pi-memory uses a deterministic built-in embedding fallback.

## Quick checks

```bash
npm test
npm run smoke:package-status
npm run smoke:memory-status
```

## License

MIT. See `LICENSE`.
