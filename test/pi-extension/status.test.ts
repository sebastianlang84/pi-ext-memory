import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getNextStatusWidgetLines } from "../../src/pi-extension/status.ts";
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
  availableCommands: ["/memory-status", "/memory-search", "/memory-review", "/memory-handoff", "/memory-session-save"],
  availableTools: ["memory_search", "memory_list", "memory_save", "memory_save_handoff", "memory_update", "memory_link", "memory_archive"],
  nextStep: "V1 release is complete; use memory_list for structured listing and monitor local embedding quality in normal use.",
};

test("getNextStatusWidgetLines shows the status widget when currently hidden", () => {
  const lines = getNextStatusWidgetLines(false, status, "/repo");

  assert.ok(lines);
  assert.equal(lines?.[0], "pi-memory status");
  assert.match(lines?.join("\n") ?? "", /embedding_model_active: builtin-hash-384-v1/);
});

test("getNextStatusWidgetLines clears the status widget when currently visible", () => {
  const lines = getNextStatusWidgetLines(true, status, "/repo");

  assert.equal(lines, undefined);
});

test("session_start status string stays short", () => {
  const indexSource = readFileSync(new URL("../../src/pi-extension/index.ts", import.meta.url), "utf8");

  assert.match(indexSource, /memory ✓/);
  assert.match(indexSource, /memory ✗/);
  assert.doesNotMatch(indexSource, /pi-memory v1\.3\.0 ready/);
});
