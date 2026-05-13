import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { initializeMemoryStore, MemoryValidationError } from "../../src/core/index.ts";

function createTempDbPath(): string {
  const tempRoot = mkdtempSync(join(tmpdir(), "pi-memory-save-"));
  return join(tempRoot, "memory.sqlite");
}

test("createMemory persists a normalized memory record", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    const memory = store.createMemory({
      kind: "decision",
      scope: "project",
      title: "  Use SQLite store  ",
      summary: "  Use a local SQLite file for durable memory persistence.  ",
      body: "  Chosen for portability and low setup overhead.  ",
      tags: [" Storage ", "storage", " V1 "],
      importance: 0.9,
      confidence: 0.8,
      pinned: true,
      sourceAgent: "test-suite",
      metadata: { adr: "ADR-001" },
    });

    assert.equal(memory.kind, "decision");
    assert.equal(memory.scope, "project");
    assert.equal(memory.title, "Use SQLite store");
    assert.equal(memory.summary, "Use a local SQLite file for durable memory persistence.");
    assert.equal(memory.body, "Chosen for portability and low setup overhead.");
    assert.deepEqual(memory.tags, ["storage", "v1"]);
    assert.equal(memory.importance, 0.9);
    assert.equal(memory.confidence, 0.8);
    assert.equal(memory.status, "active");
    assert.equal(memory.pinned, true);
    assert.equal(memory.sourceAgent, "test-suite");
    assert.deepEqual(memory.metadata, { adr: "ADR-001" });
    assert.match(memory.id, /^[0-9a-f-]{36}$/i);
    assert.match(memory.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(memory.updatedAt, memory.createdAt);
  } finally {
    store.close();
  }
});

test("createMemory rejects low-information writes", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    assert.throws(
      () =>
        store.createMemory({
          kind: "fact",
          scope: "repo",
          title: "Note",
          summary: "misc",
        }),
      (error: unknown) => {
        assert.equal(error instanceof MemoryValidationError, true);
        assert.match((error as Error).message, /summary/i);
        return true;
      },
    );
  } finally {
    store.close();
  }

  const db = new DatabaseSync(dbPath);

  try {
    const countRow = db.prepare("SELECT COUNT(*) AS count FROM memories;").get() as { count: number };
    assert.equal(countRow.count, 0);
  } finally {
    db.close();
  }
});

test("createMemory applies lifecycle defaults for todos and handoffs", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    const before = Date.now();
    const todo = store.createMemory({
      kind: "todo",
      scope: "repo",
      repoPath: "/repo/a",
      title: "Follow up on lifecycle policy",
      summary: "Follow up on lifecycle policy after the architecture-deepening slice lands.",
    });
    const handoff = store.createMemory({
      kind: "handoff",
      scope: "session",
      sessionId: "session-1",
      repoPath: "/repo/a",
      title: "Lifecycle handoff",
      summary: "Lifecycle handoff defaults should include a bounded expiry timestamp.",
    });
    const after = Date.now();

    assert.ok(todo.staleAfter, "expected todo staleAfter default");
    assert.ok(handoff.expiresAt, "expected handoff expiresAt default");
    assert.ok(Date.parse(todo.staleAfter) >= before + 29 * 24 * 60 * 60 * 1000);
    assert.ok(Date.parse(todo.staleAfter) <= after + 31 * 24 * 60 * 60 * 1000);
    assert.ok(Date.parse(handoff.expiresAt) >= before + 13 * 24 * 60 * 60 * 1000);
    assert.ok(Date.parse(handoff.expiresAt) <= after + 15 * 24 * 60 * 60 * 1000);
  } finally {
    store.close();
  }
});

test("createMemory supports persisted readback after reopening the store", () => {
  const dbPath = createTempDbPath();
  const firstStore = initializeMemoryStore({ dbPath });

  const createdMemory = firstStore.createMemory({
    kind: "todo",
    scope: "session",
    title: "Remember follow-up",
    summary: "Follow up on retrieval ranking after v0.3 lands.",
    tags: ["next-step", "ranking"],
  });

  firstStore.close();

  const reopenedStore = initializeMemoryStore({ dbPath });

  try {
    const loadedMemory = reopenedStore.getMemory(createdMemory.id);
    assert.deepEqual(loadedMemory, createdMemory);
  } finally {
    reopenedStore.close();
  }
});
