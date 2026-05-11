---
role: Durable architecture decision
contains: Decision that pi-memory defaults to one global Pi-agent memory store
not-contains: Implementation plan or migration notes
write-when: This storage-scope decision changes
---

# ADR 002: Global memory store default

Date: 2026-04-27
Status: Accepted

## Context

`pi-memory` must work across repositories. Repo-local databases fragment durable preferences, workflow facts, and cross-project decisions.

## Decision

The Pi extension defaults to one global SQLite store at `~/.pi/agent/pi-memory.sqlite`.

Project, repo, and session scopes remain metadata on memory records. They are not separate databases.

Operators can override the store path with `PI_MEMORY_DB_PATH`.

## Consequences

- Global preferences and environment facts are retrievable from every repo.
- Project/repo filtering still works through stored metadata.
- Existing repo-local dev databases are not the default runtime store anymore.
