import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  initializeMemoryStore,
  type MemoryContentForEmbedding,
  type MemoryEmbeddingAdapter,
} from "../../src/core/index.ts";

function createTempDbPath(): string {
  const tempRoot = mkdtempSync(join(tmpdir(), "pi-memory-embeddings-"));
  return join(tempRoot, "memory.sqlite");
}

test("createMemory stores a deterministic embedding with the default adapter fallback when no BGE-M3 command is configured", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    const memory = store.createMemory({
      kind: "fact",
      scope: "repo",
      title: "Embedding baseline",
      summary: "Store a deterministic embedding so hybrid retrieval can build on persisted vectors later.",
      tags: ["embeddings", "retrieval"],
    });

    const embedding = store.getMemoryEmbedding(memory.id);

    assert.ok(embedding);
    assert.equal(embedding?.memoryId, memory.id);
    assert.equal(embedding?.model, "builtin-hash-384-v1");
    assert.equal(store.embeddingModel, "builtin-hash-384-v1");
    assert.equal(store.fallbackEmbeddingModel, "builtin-hash-384-v1");
    assert.equal(embedding?.dimensions, 384);
    assert.equal(embedding?.vector.length, 384);
    assert.match(embedding?.contentHash ?? "", /^[0-9a-f]{64}$/);
    assert.ok(embedding?.vector.some((value) => value !== 0));
  } finally {
    store.close();
  }
});

test("createMemory stores a command-produced embedding when PI_MEMORY_BGE_M3_COMMAND is configured", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "pi-memory-bge-m3-"));
  const dbPath = join(tempRoot, "memory.sqlite");
  const embedderPath = join(tempRoot, "embedder.mjs");
  const runnerPath = new URL("../../src/core/index.ts", import.meta.url).pathname;

  writeFileSync(
    embedderPath,
    [
      'process.stdin.setEncoding("utf8");',
      'let input = "";',
      'process.stdin.on("data", (chunk) => { input += chunk; });',
      'process.stdin.on("end", () => {',
      '  const payload = JSON.parse(input);',
      '  const tags = Array.isArray(payload?.input?.tags) ? payload.input.tags.length : 0;',
      '  const titleLength = typeof payload?.input?.title === "string" ? payload.input.title.length : 0;',
      '  const embedding = Array.from({ length: 1024 }, (_, index) => index === 0 ? titleLength : index === 1 ? tags : index === 2 ? 0.5 : 0);',
      '  process.stdout.write(JSON.stringify({ data: [{ embedding }] }));',
      '});',
    ].join("\n"),
  );

  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      [
        `import { initializeMemoryStore } from ${JSON.stringify(runnerPath)};`,
        `const store = initializeMemoryStore({ dbPath: ${JSON.stringify(dbPath)} });`,
        `const memory = store.createMemory({ kind: "fact", scope: "repo", title: "BGE command", summary: "Read embeddings from a local command.", tags: ["bge", "test"] });`,
        `const embedding = store.getMemoryEmbedding(memory.id);`,
        `console.log(JSON.stringify({ embedding, model: store.embeddingModel, dimensions: store.embeddingDimensions, strategy: store.embeddingStrategy }));`,
        `store.close();`,
      ].join("\n"),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PI_MEMORY_BGE_M3_COMMAND: `${process.execPath} ${embedderPath}`,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout) as {
    embedding: { model: string; dimensions: number; vector: number[]; contentHash: string };
    model: string;
    dimensions: number;
    strategy: string;
  };

  assert.equal(payload.model, "local-bge-m3-command");
  assert.equal(payload.dimensions, 1024);
  assert.equal(payload.strategy, "local-command");
  assert.equal(payload.embedding.model, "local-bge-m3-command");
  assert.equal(payload.embedding.dimensions, 1024);
  assert.equal(payload.embedding.vector.length, 1024);
  assert.deepEqual(payload.embedding.vector.slice(0, 4), [11, 2, 0.5, 0]);
  assert.match(payload.embedding.contentHash, /^[0-9a-f]{64}$/);
});

test("initializeMemoryStore accepts a custom embedding adapter for deterministic tests", () => {
  const dbPath = createTempDbPath();
  let capturedContent: MemoryContentForEmbedding | undefined;

  const adapter: MemoryEmbeddingAdapter = {
    getStatus() {
      return {
        strategy: "mock",
        defaultModel: "mock-2d-default",
        fallbackModel: "mock-1d-lite",
        activeModel: "mock-2d-default",
        dimensions: 2,
      };
    },
    generateEmbedding(memory) {
      capturedContent = memory;

      return {
        model: "mock-2d-default",
        dimensions: 2,
        vector: [0.25, -0.75],
        contentHash: "mock-content-hash",
      };
    },
  };

  const store = initializeMemoryStore({ dbPath, embeddingAdapter: adapter });

  try {
    const memory = store.createMemory({
      kind: "decision",
      scope: "project",
      title: "Use injected adapter",
      summary: "Allow deterministic embedding tests without binding the suite to one builtin profile.",
      body: "This verifies the narrow adapter boundary for v0.5.",
      tags: ["embeddings", "tests"],
    });

    const embedding = store.getMemoryEmbedding(memory.id);

    assert.deepEqual(capturedContent, {
      title: "Use injected adapter",
      summary: "Allow deterministic embedding tests without binding the suite to one builtin profile.",
      body: "This verifies the narrow adapter boundary for v0.5.",
      tags: ["embeddings", "tests"],
    });
    assert.equal(store.embeddingModel, "mock-2d-default");
    assert.equal(store.embeddingDimensions, 2);
    assert.equal(embedding?.model, "mock-2d-default");
    assert.equal(embedding?.dimensions, 2);
    assert.deepEqual(embedding?.vector, [0.25, -0.75]);
    assert.equal(embedding?.contentHash, "mock-content-hash");
  } finally {
    store.close();
  }
});
