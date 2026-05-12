import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initializeMemoryStore } from "../../src/core/index.ts";
import type { MemoryContentForEmbedding, MemoryEmbeddingAdapter } from "../../src/core/index.ts";

function createTempDbPath(): string {
  const tempRoot = mkdtempSync(join(tmpdir(), "pi-memory-search-"));
  return join(tempRoot, "memory.sqlite");
}

test("searchMemories returns lexical matches for an exact term", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "fact",
      scope: "repo",
      title: "SQLite lexical baseline",
      summary: "Lexical retrieval should find the exact token alphaindex42 during tests.",
      tags: ["retrieval"],
    });

    store.createMemory({
      kind: "fact",
      scope: "repo",
      title: "Embedding follow-up",
      summary: "This note is about semantic ranking and should not match the lexical token.",
      tags: ["embeddings"],
    });

    const results = store.searchMemories({ query: "alphaindex42" });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.title, "SQLite lexical baseline");
    assert.equal(results[0]?.kind, "fact");
    assert.equal(results[0]?.scope, "repo");
  } finally {
    store.close();
  }
});

test("searchMemories applies kind and scope filters", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "decision",
      scope: "project",
      title: "Project ranking decision",
      summary: "Rankingpilot should stay in the project retrieval path for the current plan.",
      tags: ["ranking"],
    });

    store.createMemory({
      kind: "decision",
      scope: "repo",
      title: "Repo ranking decision",
      summary: "Rankingpilot also appears in repo-scoped notes for another case.",
      tags: ["ranking"],
    });

    store.createMemory({
      kind: "todo",
      scope: "project",
      title: "Project ranking todo",
      summary: "Rankingpilot follow-up testing still needs coverage after lexical search lands.",
      tags: ["ranking"],
    });

    const results = store.searchMemories({
      query: "rankingpilot",
      kind: ["decision"],
      scope: ["project"],
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.title, "Project ranking decision");
    assert.equal(results[0]?.kind, "decision");
    assert.equal(results[0]?.scope, "project");
  } finally {
    store.close();
  }
});

test("searchMemories finds legacy project records by projectId without a repoPath filter", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    const legacyProject = store.createMemory({
      kind: "decision",
      scope: "project",
      projectId: "legacy-project",
      repoPath: "/old/repo-path-metadata",
      title: "Legacy project decision",
      summary: "Legacyprojectneedle should remain discoverable by project id alone.",
      tags: ["legacy-project"],
    });

    store.createMemory({
      kind: "decision",
      scope: "project",
      projectId: "other-project",
      repoPath: "/old/repo-path-metadata",
      title: "Other project decision",
      summary: "Legacyprojectneedle belongs to a different project id.",
      tags: ["legacy-project"],
    });

    store.createMemory({
      kind: "decision",
      scope: "repo",
      projectId: "legacy-project",
      repoPath: "/new/repo",
      title: "Repo decision",
      summary: "Legacyprojectneedle belongs to repo scope, not the legacy project scope.",
      tags: ["legacy-project"],
    });

    const results = store.searchMemories({
      query: "legacyprojectneedle",
      scope: ["project"],
      projectId: "legacy-project",
    });

    assert.deepEqual(results.map((result) => result.id), [legacyProject.id]);
    assert.equal(results[0]?.repoPath, "/old/repo-path-metadata");
  } finally {
    store.close();
  }
});

test("searchMemories filters session-scoped results by sessionId", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "todo",
      scope: "session",
      sessionId: "session-a",
      title: "Session A note",
      summary: "Sessionneedle note that should only appear for the matching active session.",
      tags: ["session"],
    });

    store.createMemory({
      kind: "todo",
      scope: "session",
      sessionId: "session-b",
      title: "Session B note",
      summary: "Sessionneedle note that belongs to another session.",
      tags: ["session"],
    });

    const results = store.searchMemories({
      query: "sessionneedle",
      scope: ["session"],
      sessionId: "session-a",
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.title, "Session A note");
  } finally {
    store.close();
  }
});

test("searchMemories can reuse a precomputed query embedding", () => {
  const dbPath = createTempDbPath();
  let generatedInputs: MemoryContentForEmbedding[] = [];
  const adapter: MemoryEmbeddingAdapter = {
    getStatus() {
      return {
        strategy: "mock-counting",
        defaultModel: "mock-1d",
        fallbackModel: "mock-1d",
        activeModel: "mock-1d",
        dimensions: 1,
      };
    },
    generateEmbedding(memory) {
      generatedInputs.push(memory);
      return {
        model: "mock-1d",
        dimensions: 1,
        vector: [memory.title.includes("Reusable query") ? 1 : 0.8],
        contentHash: `mock-${generatedInputs.length}`,
      };
    },
  };
  const store = initializeMemoryStore({ dbPath, embeddingAdapter: adapter });

  try {
    store.createMemory({
      kind: "fact",
      scope: "global",
      title: "Reusable query embedding",
      summary: "Reusable query should be found without regenerating the query vector for each staged search.",
      tags: ["reuse"],
    });

    generatedInputs = [];
    const queryEmbedding = store.createSearchQueryEmbedding("Reusable query");
    assert.equal(generatedInputs.length, 1);

    store.searchMemories({ query: "Reusable query", scope: ["global"] }, { queryEmbedding });
    store.searchMemories({ query: "Reusable query", scope: ["project"], projectId: "other" }, { queryEmbedding });

    assert.equal(generatedInputs.length, 1);
  } finally {
    store.close();
  }
});

test("searchMemories respects result limits", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    for (const [index, title] of ["First limit result", "Second limit result", "Third limit result"].entries()) {
      store.createMemory({
        kind: "todo",
        scope: "session",
        sessionId: `limit-session-${index + 1}`,
        title,
        summary: `Limitneedle retrieval test keeps ${title.toLowerCase()} in the lexical result set.`,
        tags: ["limit"],
      });
    }

    const results = store.searchMemories({ query: "limitneedle", limit: 2 });

    assert.equal(results.length, 2);
    assert.ok(results.every((result) => result.title.includes("limit result")));
  } finally {
    store.close();
  }
});

test("searchMemories rejects contradictory single-scope identity filters", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    assert.throws(
      () => store.searchMemories({ query: "identityneedle", scope: ["repo"], projectId: "project-a", repoPath: "/repo/a" }),
      /scope=repo uses repoPath as its primary identity/,
    );

    assert.throws(
      () => store.searchMemories({ query: "identityneedle", scope: ["project"], projectId: "project-a", repoPath: "/repo/a" }),
      /scope=project uses projectId as its primary identity/,
    );

    assert.throws(
      () => store.searchMemories({ query: "identityneedle", scope: ["project"], sessionId: "session-a", projectId: "project-a" }),
      /scope=project uses projectId as its primary identity/,
    );
  } finally {
    store.close();
  }
});
