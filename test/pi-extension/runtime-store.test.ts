import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import type { InitializeMemoryStoreInput, MemoryStore } from "../../src/core/index.ts";
import { createMemoryRuntimeStore } from "../../src/pi-extension/runtime-store.ts";

function createFakeCore() {
  const opened: string[] = [];
  const closed: string[] = [];

  return {
    opened,
    closed,
    core: {
      initializeStore(input: InitializeMemoryStoreInput): MemoryStore {
        opened.push(input.dbPath);
        return {
          dbPath: input.dbPath,
          close() {
            closed.push(input.dbPath);
          },
        } as MemoryStore;
      },
    },
  };
}

test("runtime store reuses the active store for the same resolved db path", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "pi-memory-runtime-store-")), "memory.sqlite");
  const { core, opened, closed } = createFakeCore();
  const runtimeStore = createMemoryRuntimeStore(core, { resolveDbPath: () => dbPath });

  const first = runtimeStore.getStoreForCwd("/workspace/a");
  const second = runtimeStore.getStoreForCwd("/workspace/b");

  assert.equal(second, first);
  assert.deepEqual(opened, [dbPath]);
  assert.deepEqual(closed, []);
  assert.equal(runtimeStore.activeDbPath, dbPath);
});

test("runtime store replaces and closes the active store when the db path changes", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-memory-runtime-store-"));
  const firstPath = join(root, "first.sqlite");
  const secondPath = join(root, "second.sqlite");
  let resolvedPath = firstPath;
  const { core, opened, closed } = createFakeCore();
  const runtimeStore = createMemoryRuntimeStore(core, { resolveDbPath: () => resolvedPath });

  const first = runtimeStore.getStoreForCwd("/workspace");
  resolvedPath = secondPath;
  const second = runtimeStore.getStoreForCwd("/workspace");

  assert.notEqual(second, first);
  assert.deepEqual(opened, [firstPath, secondPath]);
  assert.deepEqual(closed, [firstPath]);
  assert.equal(runtimeStore.activeDbPath, secondPath);

  runtimeStore.close();
  runtimeStore.close();

  assert.deepEqual(closed, [firstPath, secondPath]);
  assert.equal(runtimeStore.activeDbPath, undefined);
});

test("runtime store honors PI_MEMORY_DB_PATH through the default db path resolver", () => {
  const previousDbPath = process.env.PI_MEMORY_DB_PATH;
  const dbPath = join(mkdtempSync(join(tmpdir(), "pi-memory-runtime-store-")), "configured.sqlite");
  process.env.PI_MEMORY_DB_PATH = dbPath;

  try {
    const { core, opened } = createFakeCore();
    const runtimeStore = createMemoryRuntimeStore(core);

    runtimeStore.getStoreForCwd("/workspace");

    assert.deepEqual(opened, [resolve(dbPath)]);
    runtimeStore.close();
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.PI_MEMORY_DB_PATH;
    } else {
      process.env.PI_MEMORY_DB_PATH = previousDbPath;
    }
  }
});
