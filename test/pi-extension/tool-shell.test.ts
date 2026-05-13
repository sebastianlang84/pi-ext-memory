import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initializeMemoryStore } from "../../src/core/index.ts";
import { createToolShell } from "../../src/pi-extension/tool-shell.ts";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("createToolShell: forCwd returns a store matching the injected factory", () => {
  const dbPath = join(createTempDir("pi-memory-tool-shell-store-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });
  try {
    const shell = createToolShell(() => store);
    const ctx = shell.forCwd("/repo", "session-abc");
    assert.equal(ctx.store, store, "store should be the instance returned by getActiveStore");
  } finally {
    store.close();
  }
});

test("createToolShell: forCwd populates turnContext from cwd and sessionId", () => {
  const dbPath = join(createTempDir("pi-memory-tool-shell-ctx-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });
  try {
    const shell = createToolShell(() => store);
    const ctx = shell.forCwd("/repo", "session-xyz");
    assert.equal(ctx.turnContext.sessionId, "session-xyz");
    assert.ok(typeof ctx.turnContext.cwd === "string");
  } finally {
    store.close();
  }
});

test("createToolShell: identityErrorResponse returns formatted content with dbPath", () => {
  const dbPath = join(createTempDir("pi-memory-tool-shell-id-err-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });
  try {
    const shell = createToolShell(() => store);
    const ctx = shell.forCwd("/repo", "session-abc");
    const response = ctx.identityErrorResponse("contradictory scope identity");
    assert.equal(response.content.length, 1);
    assert.equal(response.content[0].type, "text");
    assert.match(response.content[0].text, /contradictory scope identity/);
    assert.equal(response.details.dbPath, dbPath);
  } finally {
    store.close();
  }
});

test("createToolShell: withLegacyNotice wraps text with notice when scope is project", () => {
  const dbPath = join(createTempDir("pi-memory-tool-shell-notice-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });
  try {
    const shell = createToolShell(() => store);
    const ctx = shell.forCwd("/repo", "session-abc");
    const plain = ctx.withLegacyNotice("some output", "repo");
    assert.equal(plain, "some output", "no notice for non-project scope");
    const noticed = ctx.withLegacyNotice("some output", "project");
    assert.match(noticed, /some output/);
    // The notice should append something extra for project scope
    assert.ok(noticed.length > "some output".length, "expected legacy notice to be appended for project scope");
  } finally {
    store.close();
  }
});

test("createToolShell: resolveSearchIdentity and resolveWriteIdentity are functions", () => {
  const dbPath = join(createTempDir("pi-memory-tool-shell-fns-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });
  try {
    const shell = createToolShell(() => store);
    const ctx = shell.forCwd("/repo", "session-abc");
    assert.equal(typeof ctx.resolveSearchIdentity, "function");
    assert.equal(typeof ctx.resolveWriteIdentity, "function");
  } finally {
    store.close();
  }
});
