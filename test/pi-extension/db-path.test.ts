import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  ensureDefaultMemoryDbPath,
  migrateLegacyMemoryDbPath,
  resolveDefaultMemoryDbPath,
  resolveMemoryDbPath,
} from "../../src/pi-extension/config.ts";

test("resolveMemoryDbPath defaults to the namespaced pi-memory state store", () => {
  assert.equal(resolveMemoryDbPath({}), resolveDefaultMemoryDbPath());
  assert.match(resolveMemoryDbPath({}), /\.pi\/agent\/state\/pi-memory\/memory\.sqlite$/);
});

test("resolveMemoryDbPath supports an explicit override", () => {
  assert.equal(resolveMemoryDbPath({ PI_MEMORY_DB_PATH: "./custom-memory.sqlite" }), resolve("custom-memory.sqlite"));
});

test("ensureDefaultMemoryDbPath skips migration when an explicit override is configured", () => {
  const result = ensureDefaultMemoryDbPath({ PI_MEMORY_DB_PATH: "./custom-memory.sqlite" });

  assert.equal(result.dbPath, resolve("custom-memory.sqlite"));
  assert.equal(result.migrated, false);
  assert.equal(result.skippedReason, "configured_path");
});

test("migrateLegacyMemoryDbPath copies the legacy default DB and SQLite sidecars once", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-memory-db-path-"));
  try {
    const legacyDbPath = join(tempDir, "pi-memory.sqlite");
    const dbPath = join(tempDir, "state", "pi-memory", "memory.sqlite");
    writeFileSync(legacyDbPath, "legacy-db");
    writeFileSync(`${legacyDbPath}-wal`, "legacy-wal");
    writeFileSync(`${legacyDbPath}-shm`, "legacy-shm");

    const migrated = migrateLegacyMemoryDbPath({ dbPath, legacyDbPath });

    assert.equal(migrated.migrated, true);
    assert.equal(readFileSync(dbPath, "utf8"), "legacy-db");
    assert.equal(readFileSync(`${dbPath}-wal`, "utf8"), "legacy-wal");
    assert.equal(readFileSync(`${dbPath}-shm`, "utf8"), "legacy-shm");
    assert.equal(readFileSync(legacyDbPath, "utf8"), "legacy-db");

    writeFileSync(legacyDbPath, "changed-legacy-db");
    const skipped = migrateLegacyMemoryDbPath({ dbPath, legacyDbPath });

    assert.equal(skipped.migrated, false);
    assert.equal(skipped.skippedReason, "target_exists");
    assert.equal(readFileSync(dbPath, "utf8"), "legacy-db");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("migrateLegacyMemoryDbPath skips migration when no legacy DB exists", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-memory-db-path-"));
  try {
    const legacyDbPath = join(tempDir, "pi-memory.sqlite");
    const dbPath = join(tempDir, "state", "pi-memory", "memory.sqlite");

    const skipped = migrateLegacyMemoryDbPath({ dbPath, legacyDbPath });

    assert.equal(skipped.migrated, false);
    assert.equal(skipped.skippedReason, "legacy_missing");
    assert.equal(existsSync(dbPath), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
