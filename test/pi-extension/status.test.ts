import assert from "node:assert/strict";
import test from "node:test";

import { getNextStatusWidgetLines } from "../../src/pi-extension/status.ts";
import type { MemoryCoreStatus } from "../../src/core/index.ts";

const status: MemoryCoreStatus = {
  version: "v1.1.2",
  mode: "local-core",
  storage: "sqlite-session-summary-ready",
  latestSchemaVersion: 4,
  embeddingStrategy: "deterministic-hash",
  defaultEmbeddingModel: "local-bge-m3-command",
  fallbackEmbeddingModel: "builtin-hash-384-v1",
  activeEmbeddingModel: "builtin-hash-384-v1",
  embeddingDimensions: 384,
  availableCommands: ["/memory-status", "/memory-search", "/memory-review", "/memory-session-save"],
  availableTools: ["memory_search", "memory_save", "memory_update", "memory_link", "memory_archive"],
  nextStep: "V1 release is complete; monitor local embedding quality and latency in normal use.",
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
