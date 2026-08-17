import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryCore } from "../../src/core/index.ts";

function readJson(relativePath: string): { version: string; packages?: Record<string, { version: string }> } {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

test("runtime status version stays in sync with package.json and package-lock.json", () => {
  const packageVersion = readJson("../../package.json").version;
  const lock = readJson("../../package-lock.json");

  assert.equal(createMemoryCore().getStatus().version, `v${packageVersion}`);
  assert.equal(lock.version, packageVersion);
  assert.equal(lock.packages?.[""].version, packageVersion);
});
