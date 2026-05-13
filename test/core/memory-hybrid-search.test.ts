import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_HYBRID_RETRIEVAL_POLICY,
  initializeMemoryStore,
  type MemoryContentForEmbedding,
  type MemoryEmbeddingAdapter,
} from "../../src/core/index.ts";

function createTempDbPath(): string {
  const tempRoot = mkdtempSync(join(tmpdir(), "pi-memory-hybrid-search-"));
  return join(tempRoot, "memory.sqlite");
}

function createMockHybridEmbeddingAdapter(): MemoryEmbeddingAdapter {
  return {
    getStatus() {
      return {
        strategy: "mock-hybrid-multilingual",
        defaultModel: "mock-hybrid-4d",
        fallbackModel: "mock-hybrid-4d",
        activeModel: "mock-hybrid-4d",
        dimensions: 4,
      };
    },
    generateEmbedding(memory) {
      const serialized = [memory.title, memory.summary, memory.body ?? "", memory.tags.join(" ")].join("\n");
      return {
        model: "mock-hybrid-4d",
        dimensions: 4,
        vector: createMockHybridVector(memory),
        contentHash: createHash("sha256").update(serialized.toLowerCase()).digest("hex"),
      };
    },
  };
}

function createMockHybridVector(memory: MemoryContentForEmbedding): number[] {
  const tokens = new Set(normalizeTokens([memory.title, memory.summary, memory.body ?? "", memory.tags.join(" ")].join(" ")));
  const vector = [0.05, 0.05, 0.05, 0.05];

  if (hasAny(tokens, [
    "quickstart",
    "schnellstart",
    "cache",
    "caching",
    "lokal",
    "local",
    "build",
    "artefakte",
    "artifacts",
  ])) {
    vector[0] += 1;
  }

  if (hasAny(tokens, ["docs", "documentation", "dokumentation", "guide", "leitfaden", "onboarding"])) {
    vector[1] += 1;
  }

  if (hasAny(tokens, ["project", "projekt", "team", "alpha", "scope", "kontext"])) {
    vector[2] += 1;
  }

  if (hasAny(tokens, ["deployment", "deploy", "bereitstellung", "rollback", "ruecknahme", "recovery", "freigabe"])) {
    vector[3] += 1;
  }

  return normalizeVector(vector);
}

function normalizeTokens(value: string): string[] {
  return (
    value
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function hasAny(tokens: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => tokens.has(candidate));
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0)) || 1;
  return vector.map((value) => Number((value / magnitude).toFixed(8)));
}

test("searchMemories returns vector-only mixed-language matches when lexical overlap is absent", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath, embeddingAdapter: createMockHybridEmbeddingAdapter() });

  try {
    store.createMemory({
      kind: "fact",
      scope: "repo",
      title: "Bereitstellungs-Rücknahme Leitfaden",
      summary: "Ruecknahme fuer Bereitstellungen nach Freigabe-Problemen im lokalen Ablauf.",
      tags: ["betrieb"],
    });

    store.createMemory({
      kind: "fact",
      scope: "repo",
      title: "Documentation cleanup",
      summary: "Refresh onboarding docs and examples for new contributors.",
      tags: ["docs"],
    });

    const results = store.searchMemories({ query: "deployment rollback recovery" });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.title, "Bereitstellungs-Rücknahme Leitfaden");
    assert.equal(results[0]?.lexicalScore, 0);
    assert.ok((results[0]?.semanticScore ?? 0) > 0.7);
  } finally {
    store.close();
  }
});

test("searchMemories ranks stronger project-scoped matches ahead of weaker repo matches", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath, embeddingAdapter: createMockHybridEmbeddingAdapter() });

  try {
    store.createMemory({
      kind: "decision",
      scope: "project",
      projectId: "alpha",
      title: "Projekt Cache Entscheidung",
      summary: "Schnellstart nutzt lokalen Build Cache fuer Artefakte im Alpha Projekt.",
      tags: ["cache", "projekt"],
      importance: 0.95,
      confidence: 0.9,
    });

    store.createMemory({
      kind: "fact",
      scope: "repo",
      projectId: "alpha",
      repoPath: "/tmp/alpha",
      title: "Quickstart cache docs",
      summary: "Quickstart cache documentation for contributors.",
      tags: ["docs"],
      importance: 0.35,
      confidence: 0.4,
    });

    const results = store.searchMemories({
      query: "schnellstart cache",
      projectId: "alpha",
      limit: 5,
    });

    assert.equal(results.length, 2);
    assert.equal(results[0]?.title, "Projekt Cache Entscheidung");
    assert.equal(results[0]?.scope, "project");
    assert.ok((results[0]?.scopeScore ?? 0) > (results[1]?.scopeScore ?? 0));
    assert.ok((results[0]?.matchScore ?? 0) > (results[1]?.matchScore ?? 0));
  } finally {
    store.close();
  }
});

test("searchMemories uses recency to break semantic ties for mixed-language vector matches", async () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath, embeddingAdapter: createMockHybridEmbeddingAdapter() });

  try {
    store.createMemory({
      kind: "episode",
      scope: "repo",
      title: "Aeltere Ruecknahme Notiz",
      summary: "Ruecknahme fuer Bereitstellungen nach Freigabe-Problemen mit alterem Ablauf.",
      tags: ["betrieb"],
      importance: 0.5,
      confidence: 0.5,
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    store.createMemory({
      kind: "episode",
      scope: "repo",
      title: "Neuere Ruecknahme Notiz",
      summary: "Ruecknahme fuer Bereitstellungen nach Freigabe-Problemen mit aktuellem Ablauf.",
      tags: ["betrieb"],
      importance: 0.5,
      confidence: 0.5,
    });

    const results = store.searchMemories({ query: "deployment rollback recovery" });

    assert.equal(results.length, 2);
    assert.equal(results[0]?.title, "Neuere Ruecknahme Notiz");
    assert.ok((results[0]?.recencyScore ?? 0) > (results[1]?.recencyScore ?? 0));
    assert.equal(results[0]?.semanticScore, results[1]?.semanticScore);
  } finally {
    store.close();
  }
});

test("searchMemories keeps repo-filtered lexical hits ahead of unrelated global semantic matches", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath, embeddingAdapter: createMockHybridEmbeddingAdapter() });

  try {
    const repoHit = store.createMemory({
      kind: "fact",
      scope: "repo",
      repoPath: "/repo/a",
      title: "Cache rollout exact procedure",
      summary: "Cache rollout exactneedle for the repository should win when repoPath is filtered.",
      tags: ["cache"],
    });
    store.createMemory({
      kind: "fact",
      scope: "global",
      title: "Global cache guidance",
      summary: "General quickstart cache guidance unrelated to a repository-specific query.",
      tags: ["cache"],
      importance: 1,
      confidence: 1,
    });

    const results = store.searchMemories({ query: "exactneedle cache", repoPath: "/repo/a", limit: 5 });

    assert.equal(results[0]?.id, repoHit.id);
    assert.ok(results.every((result) => result.repoPath === "/repo/a"));
    assert.ok(DEFAULT_HYBRID_RETRIEVAL_POLICY.weights.lexical > 0);
  } finally {
    store.close();
  }
});

test("searchMemories near-duplicate suppression keeps actionable todos with different next actions", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath, embeddingAdapter: createMockHybridEmbeddingAdapter() });

  try {
    store.createMemory({
      kind: "todo",
      scope: "repo",
      repoPath: "/repo/a",
      title: "Cache rollout follow-up",
      summary: "[P1] Validate cache rollout for quickstart → Check staging logs",
      tags: ["todo", "cache", "P1"],
    });
    store.createMemory({
      kind: "todo",
      scope: "repo",
      repoPath: "/repo/a",
      title: "Cache rollout follow-up",
      summary: "[P1] Validate cache rollout for quickstart → Notify release owner",
      tags: ["todo", "cache", "P1"],
    });

    const results = store.searchMemories({ query: "cache rollout quickstart", kind: ["todo"], repoPath: "/repo/a", limit: 5 });

    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((result) => result.summary).sort(),
      [
        "[P1] Validate cache rollout for quickstart → Check staging logs",
        "[P1] Validate cache rollout for quickstart → Notify release owner",
      ],
    );
  } finally {
    store.close();
  }
});

test("searchMemories dedupes near-identical matches", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath, embeddingAdapter: createMockHybridEmbeddingAdapter() });

  try {
    store.createMemory({
      kind: "todo",
      scope: "project",
      title: "Cache rollout follow-up",
      summary: "Validate the local cache rollout for the quickstart guide this week.",
      tags: ["cache"],
    });

    store.createMemory({
      kind: "todo",
      scope: "project",
      title: "cache rollout follow up",
      summary: "Validate local cache rollout for quickstart guide this week!",
      tags: ["cache"],
    });

    const results = store.searchMemories({ query: "cache rollout quickstart", limit: 5 });

    assert.equal(results.length, 1);
    assert.match(results[0]?.title ?? "", /cache rollout/i);
  } finally {
    store.close();
  }
});
