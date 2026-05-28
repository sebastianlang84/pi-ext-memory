import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { formatMemoryStatus } from "../../src/pi-extension/status.ts";
import type { MemoryCoreStatus } from "../../src/core/index.ts";

const status: MemoryCoreStatus = {
  version: "v1.3.0",
  mode: "local-core",
  storage: "sqlite-session-summary-ready",
  latestSchemaVersion: 4,
  embeddingStrategy: "deterministic-hash",
  defaultEmbeddingModel: "local-bge-m3-command",
  fallbackEmbeddingModel: "builtin-hash-384-v1",
  activeEmbeddingModel: "builtin-hash-384-v1",
  embeddingDimensions: 384,
  availableCommands: ["/memory-status", "/memory-search", "/memory-handoff", "/memory-session-save"],
  availableTools: ["memory_search", "memory_list", "memory_save", "memory_save_todo", "memory_save_handoff", "memory_update", "memory_audit", "memory_tag_catalog", "memory_stats"],
  nextStep: "V1 release is complete; use memory_list for structured listing and monitor local embedding quality in normal use.",
};

test("formatMemoryStatus renders all key fields", () => {
  const output = formatMemoryStatus(status, "/repo");

  assert.match(output, /^pi-memory status/);
  assert.match(output, /version: v1\.3\.0/);
  assert.match(output, /embedding_model_active: builtin-hash-384-v1/);
  assert.match(output, /cwd: \/repo/);
});

test("session_start status string stays short", () => {
  const indexSource = readFileSync(new URL("../../src/pi-extension/index.ts", import.meta.url), "utf8");

  assert.match(indexSource, /Memory ✓/);
  assert.match(indexSource, /Memory ✗/);
  assert.doesNotMatch(indexSource, /pi-memory v1\.3\.0 ready/);
});
