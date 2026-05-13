import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initializeMemoryStore } from "../../src/core/index.ts";

function createTempDbPath(): string {
  const tempRoot = mkdtempSync(join(tmpdir(), "pi-memory-v08-"));
  return join(tempRoot, "memory.sqlite");
}

test("updateMemory patches fields and refreshes the persisted embedding", async () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    const memory = store.createMemory({
      kind: "todo",
      scope: "project",
      title: "Use lexical baseline",
      summary: "Keep lexical retrieval as the first quality gate for the initial rollout.",
      body: "Original notes.",
      tags: ["retrieval", "baseline"],
      importance: 0.7,
      confidence: 0.6,
    });

    const originalEmbedding = store.getMemoryEmbedding(memory.id);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = store.updateMemory({
      id: memory.id,
      summary: "Keep lexical retrieval as the first quality gate while hybrid reranking matures.",
      body: null,
      tags: ["retrieval", "hybrid"],
      importance: 0.9,
      pinned: true,
    });

    const updatedEmbedding = store.getMemoryEmbedding(memory.id);

    assert.equal(updated.id, memory.id);
    assert.equal(updated.title, memory.title);
    assert.equal(updated.summary, "Keep lexical retrieval as the first quality gate while hybrid reranking matures.");
    assert.equal(updated.body, undefined);
    assert.deepEqual(updated.tags, ["retrieval", "hybrid"]);
    assert.equal(updated.importance, 0.9);
    assert.equal(updated.pinned, true);
    assert.notEqual(updated.updatedAt, memory.updatedAt);
    assert.ok(updatedEmbedding);
    assert.ok(originalEmbedding);
    assert.notEqual(updatedEmbedding?.contentHash, originalEmbedding?.contentHash);
  } finally {
    store.close();
  }
});

test("updateMemory patches scope", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });
  try {
    const memory = store.createMemory({
      kind: "todo",
      scope: "session",
      title: "Temporary session fact",
      summary: "This fact was captured during a session and should be promoted to project scope.",
    });
    assert.equal(memory.scope, "session");

    const updated = store.updateMemory({ id: memory.id, scope: "project" });
    assert.equal(updated.scope, "project");
  } finally {
    store.close();
  }
});

test("archiveMemory keeps the record but removes it from active search results", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    const memory = store.createMemory({
      kind: "todo",
      scope: "repo",
      title: "Legacy fallback investigation",
      summary: "Legacyneedle investigation tracked an older fallback path that should stop influencing retrieval now.",
      tags: ["legacy"],
    });

    const archived = store.archiveMemory({
      id: memory.id,
      reason: "Superseded by the v0.8 manual search command and archive flow.",
    });

    const loaded = store.getMemory(memory.id);
    const results = store.searchMemories({ query: "legacyneedle", limit: 5 });

    assert.equal(archived.status, "archived");
    assert.equal(loaded?.status, "archived");
    assert.equal(results.length, 0);
    assert.deepEqual(loaded?.metadata.archive, {
      archivedAt: archived.updatedAt,
      archivedReason: "Superseded by the v0.8 manual search command and archive flow.",
    });
  } finally {
    store.close();
  }
});
