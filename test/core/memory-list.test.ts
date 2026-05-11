import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initializeMemoryStore } from "../../src/core/index.ts";

function createTempDbPath(): string {
  const tempRoot = mkdtempSync(join(tmpdir(), "pi-memory-list-"));
  return join(tempRoot, "memory.sqlite");
}

test("listMemories defaults to active memories ordered by newest update", async () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    const older = store.createMemory({
      kind: "fact",
      scope: "repo",
      title: "Older active fact",
      summary: "Older active memory should be listed after the more recently updated record.",
    });

    const archived = store.createMemory({
      kind: "todo",
      scope: "repo",
      title: "Archived todo",
      summary: "Archived todo should not appear in the default active memory list.",
    });

    const newer = store.createMemory({
      kind: "decision",
      scope: "repo",
      title: "Newer active decision",
      summary: "Newer active memory should be listed before the older active record.",
    });

    store.archiveMemory({ id: archived.id });
    await new Promise((resolve) => setTimeout(resolve, 5));
    store.updateMemory({ id: older.id, pinned: true });

    const results = store.listMemories();

    assert.deepEqual(
      results.map((memory) => memory.id),
      [older.id, newer.id],
    );
    assert.ok(results.every((memory) => memory.status === "active"));
  } finally {
    store.close();
  }
});

test("listMemories filters active todos by kind without a query", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    const todo = store.createMemory({
      kind: "todo",
      scope: "project",
      title: "Review active todos",
      summary: "Active todo listing should work by filtering only on the todo memory kind.",
      tags: ["review"],
    });

    store.createMemory({
      kind: "decision",
      scope: "project",
      title: "Review decision",
      summary: "Decision memory shares related wording but should not appear in todo listing.",
      tags: ["review"],
    });

    const results = store.listMemories({ kind: ["todo"] });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, todo.id);
  } finally {
    store.close();
  }
});

test("listMemories applies scope tags project repo status limit and createdAt ordering", async () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    const first = store.createMemory({
      kind: "todo",
      scope: "repo",
      title: "First matching archived todo",
      summary: "First archived todo should match all structured list filters for this repository.",
      tags: ["ops", "v1"],
      projectId: "project-a",
      repoPath: "/repo/a",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = store.createMemory({
      kind: "todo",
      scope: "repo",
      title: "Second matching archived todo",
      summary: "Second archived todo should sort before the first one when ordering by creation time.",
      tags: ["ops", "v1"],
      projectId: "project-a",
      repoPath: "/repo/a",
    });

    store.createMemory({
      kind: "todo",
      scope: "project",
      title: "Wrong scope todo",
      summary: "Wrong scope todo should not match the repository scoped structured list filter.",
      tags: ["ops", "v1"],
      projectId: "project-a",
      repoPath: "/repo/a",
    });

    store.archiveMemory({ id: first.id });
    store.archiveMemory({ id: second.id });

    const results = store.listMemories({
      kind: ["todo"],
      scope: ["repo"],
      tags: ["ops", "v1"],
      projectId: "project-a",
      repoPath: "/repo/a",
      status: "archived",
      limit: 1,
      orderBy: "createdAt",
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, second.id);
  } finally {
    store.close();
  }
});
