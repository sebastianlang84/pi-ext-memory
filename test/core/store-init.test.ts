import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { initializeMemoryStore } from "../../src/core/index.ts";

test("initializeMemoryStore creates a fresh database and applies schema v5", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "pi-memory-store-"));
  const dbPath = join(tempRoot, "memory.sqlite");

  const store = initializeMemoryStore({ dbPath });
  store.close();

  assert.equal(existsSync(dbPath), true);
  assert.equal(store.dbPath, dbPath);
  assert.equal(store.schemaVersion, 5);
  assert.equal(store.latestSchemaVersion, 5);
  assert.equal(store.embeddingModel, "builtin-hash-384-v1");
  assert.equal(store.fallbackEmbeddingModel, "builtin-hash-384-v1");
  assert.equal(store.embeddingDimensions, 384);
  assert.equal(store.embeddingStrategy, "deterministic-hash");

  const db = new DatabaseSync(dbPath);

  try {
    const schemaVersion = db.prepare("PRAGMA user_version;").get() as { user_version: number };
    assert.equal(schemaVersion.user_version, 5);

    const coreTables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('artifacts', 'links', 'memories', 'memory_embeddings', 'sessions') ORDER BY name;`,
      )
      .all() as Array<{ name: string }>;

    assert.deepEqual(
      coreTables.map((table) => table.name),
      ["artifacts", "links", "memories", "memory_embeddings", "sessions"],
    );

    const metaTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta';")
      .get() as { name: string } | undefined;
    assert.equal(metaTable?.name, "meta");

    const ftsTable = db
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_fts';`)
      .get() as { name: string; sql: string } | undefined;

    assert.equal(ftsTable?.name, "memory_fts");
    assert.match(ftsTable?.sql ?? "", /fts5/i);

    const triggers = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'memories_a%' ORDER BY name;`)
      .all() as Array<{ name: string }>;

    assert.deepEqual(
      triggers.map((trigger) => trigger.name),
      ["memories_ad", "memories_ai", "memories_au"],
    );

    const memoryColumns = db.prepare("PRAGMA table_info(memories);").all() as Array<{ name: string }>;
    assert.deepEqual(
      memoryColumns.map((column) => column.name),
      [
        "id",
        "kind",
        "scope",
        "session_id",
        "title",
        "summary",
        "body",
        "tags_json",
        "source_agent",
        "project_id",
        "repo_path",
        "branch",
        "importance",
        "confidence",
        "status",
        "pinned",
        "created_at",
        "updated_at",
        "last_accessed_at",
        "expires_at",
        "metadata_json",
      ],
    );

    const embeddingColumns = db.prepare("PRAGMA table_info(memory_embeddings);").all() as Array<{ name: string }>;
    assert.deepEqual(
      embeddingColumns.map((column) => column.name),
      ["memory_id", "model", "dimensions", "vector_json", "content_hash", "created_at", "updated_at"],
    );
  } finally {
    db.close();
  }
});

test("initializeMemoryStore is idempotent for an already-migrated database", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "pi-memory-store-"));
  const dbPath = join(tempRoot, "memory.sqlite");

  const firstStore = initializeMemoryStore({ dbPath });
  firstStore.close();

  const secondStore = initializeMemoryStore({ dbPath, preferLowFootprintEmbeddings: true });

  try {
    assert.equal(secondStore.schemaVersion, 5);
    assert.equal(secondStore.latestSchemaVersion, 5);
    assert.equal(secondStore.embeddingModel, "builtin-hash-64-v1");
    assert.equal(secondStore.fallbackEmbeddingModel, "builtin-hash-64-v1");
    assert.equal(secondStore.embeddingDimensions, 64);
  } finally {
    secondStore.close();
  }
});
