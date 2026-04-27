import assert from "node:assert/strict";
import { homedir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { resolveMemoryDbPath } from "../../src/pi-extension/config.ts";

test("resolveMemoryDbPath defaults to the global pi agent memory store", () => {
  assert.equal(resolveMemoryDbPath({}), resolve(homedir(), ".pi", "agent", "pi-memory.sqlite"));
});

test("resolveMemoryDbPath supports an explicit override", () => {
  assert.equal(resolveMemoryDbPath({ PI_MEMORY_DB_PATH: "./custom-memory.sqlite" }), resolve("custom-memory.sqlite"));
});
