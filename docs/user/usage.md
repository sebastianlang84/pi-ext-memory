---
role: User-facing usage guide for pi-memory
contains: Installation, commands, normal tool routing, scopes, caps, configuration, and operational notes
not-contains: Product requirements, durable architectural decisions, internal implementation details, or active backlog
write-when: User-visible commands, tools, configuration, scopes, caps, or workflows change
---

# User Guide — pi-memory

pi-memory is a local, SQLite-backed memory extension for Pi coding agents. It stores durable notes, facts, decisions, preferences, todos, and handoffs, then retrieves relevant context for future turns.

## Install

```bash
pi install git:github.com/sebastianlang84/pi-ext-memory
```

For local development:

```bash
cd ~/dev/pi-extensions/pi-ext-memory
pi install .
```

## Commands

```text
/memory-status                 show extension status and configuration
/memory-search <query>         run a manual memory search
/memory-review                 show relevant existing memories and suggested cleanup/save actions
/memory-handoff                show the active session handoff
/memory-handoff archive        archive the active session handoff
/memory-session-save <summary> persist an explicit session summary
/memory-audit                  run the memory audit and print results
```

## Normal tools

Normal agent-facing tools are:

```text
memory_search                  search durable memory (semantic + lexical)
memory_list                    list/filter structured memories; kind and scope are optional; paginated with total_count, has_more, next_offset
memory_save                    save kindless durable notes, facts, decisions, preferences, and context
memory_save_todo               save actionable open tasks with priority/status/scope
memory_save_handoff            save or refresh resumable agent handoff state
memory_update                  patch, close, or archive an existing memory by id; use archiveReason with status=archived when archiving
memory_audit                   report lifecycle hygiene, legacy workflow-tag hygiene, scope identity issues, and read-only legacy project migration previews
memory_tag_catalog             show existing active tags with counts, scopes/kinds, and recent examples
```

Use `memory_list` for normal listing and `memory_update(status="archived", archiveReason=...)` for normal archive flows.

## Advanced/admin tool

```text
memory_stats                   advanced/admin health, cap, and last-audit summary by scope
```

Use `memory_stats` only for memory-store health or capacity checks. It is intentionally not part of the normal first-choice tool path.

## Scope identity

Normal agent-facing scopes are:

| Scope | Use when |
| --- | --- |
| `global` | The memory should apply across repositories. |
| `repo` | Future agents in the current repository/worktree should know it. |
| `session` | The state is short-lived handoff/resume/current-run context. |

Inside a Git repository, ordinary saves and todos default to `repo`; outside a repo they default to `global`.

Tools reject contradictory filters such as `scope="repo"` plus `projectId`, avoiding accidental `project_id AND repo_path` misses.

`project` / `projectId` remains available only as legacy/advanced compatibility. Explicit `scope="project"` tool calls return a compatibility notice; new normal agent use should prefer `repo` with `repoPath`.

## Memory kinds and status

- Generic memories are kindless and are used for notes, facts, decisions, preferences, and context.
- `todo` memories are created through `memory_save_todo`.
- `handoff` memories are created or refreshed through `memory_save_handoff`.
- Active memories use `status="active"`.
- Closed memories use `status="archived"`; archive semantics should be captured with `archiveReason`.

## Active caps

| Scope | Todo hard cap | Handoff hard cap |
| --- | --- | --- |
| repo / session | 50 | 10 |
| global | 20 | 5 |
| legacy project | 50 | 10 |

Saving past the hard cap returns an `active_*_cap_exceeded` error with cleanup suggestions. Archive or complete existing todos/handoffs first.

## Configuration

- By default, pi-memory stores SQLite state at `~/.pi/agent/state/pi-memory/memory.sqlite`.
- On first startup with the default path, if the new DB does not exist but the legacy `~/.pi/agent/pi-memory.sqlite` file does, pi-memory copies the legacy DB plus SQLite `-wal`/`-shm` sidecars into the new state path.
- `PI_MEMORY_DB_PATH` overrides the SQLite database path and disables the legacy default-path copy.
- `PI_MEMORY_BGE_M3_COMMAND` enables a local BGE-M3 embedding command adapter.
- `PI_MEMORY_BGE_M3_TIMEOUT_MS` configures the BGE-M3 command timeout; the default is 15 seconds.

## Tag catalog

Use `memory_tag_catalog` before creating unfamiliar tags. It is read-only: it derives the current tag inventory from stored memories and does not update audit metadata, rewrite tags, archive records, create a curated tag table, or ship a preferred-tag seed.

Catalog entries show each tag's count, scopes, kinds, and recent example titles. Use the catalog to reuse existing content/context tags instead of creating near-duplicates; preferred tags are inferred from current active usage. The catalog is intentionally on-demand and is not injected at turn start.

When `memory_search` has no results, it can return advisory `empty_result_hints`: near `metadata.canonicalKey` suggestions for likely key typos or token matches, plus a short broaden-search retry hint. When a tag-filtered `memory_search` has no results, or when `memory_save`, `memory_save_todo`, or `memory_update` receives a new tag that looks close to an existing tag, the tool can also return advisory `near_tag_suggestions`. Suggestions never rewrite tags automatically; retry or patch explicitly if the existing tag/key is the intended one.

`memory_audit` also reports active memories that still carry legacy todo workflow tags such as `todo`, `p1`, or `blocked`. These findings are advisory-only: review and patch/archive explicitly if needed; pi-memory does not migrate, rewrite, or archive them automatically.

## Write guidance

Save only explicit durable facts, decisions, preferences, reusable context, persistent todos, handoffs, project paths, or information the user explicitly asks the agent to remember.

Do not save transient frustration, noisy chat history, secrets, credentials, or short-lived implementation details that belong only in the current diff or task plan.

Tags are for topic, subsystem, artifact, activity, or cross-cutting context labels such as `pi-memory`, `tagging`, `agent-context`, or `design`. If a tool has a structured field for a concept, use the field instead of duplicating it as a tag: todo priority belongs in the `memory_save_todo.priority` field, todo workflow state belongs in `memory_save_todo.status`, next action belongs in `nextAction`, memory lifecycle state belongs in `memory_update.status`, and scope belongs in `scope`.
