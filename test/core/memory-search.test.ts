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

function createNoSemanticEmbeddingAdapter(): MemoryEmbeddingAdapter {
  return {
    getStatus() {
      return {
        strategy: "mock-zero-vector",
        defaultModel: "mock-zero-1d",
        fallbackModel: "mock-zero-1d",
        activeModel: "mock-zero-1d",
        dimensions: 1,
      };
    },
    generateEmbedding() {
      return {
        model: "mock-zero-1d",
        dimensions: 1,
        vector: [0],
        contentHash: "mock-zero",
      };
    },
  };
}

test("searchMemories returns lexical matches for an exact term", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "todo",
      scope: "repo",
      title: "SQLite lexical baseline",
      summary: "Lexical retrieval should find the exact token alphaindex42 during tests.",
      tags: ["retrieval"],
    });

    store.createMemory({
      kind: "todo",
      scope: "repo",
      title: "Embedding follow-up",
      summary: "This note is about semantic ranking and should not match the lexical token.",
      tags: ["embeddings"],
    });

    const results = store.searchMemories({ query: "alphaindex42" });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.title, "SQLite lexical baseline");
    assert.equal(results[0]?.kind, "todo");
    assert.equal(results[0]?.scope, "repo");
  } finally {
    store.close();
  }
});

test("searchMemories falls back to relaxed lexical matching for noisy Git identity queries", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath, embeddingAdapter: createNoSemanticEmbeddingAdapter() });

  try {
    const gitIdentity = store.createMemory({
      scope: "global",
      title: "Default Git identity on this machine",
      summary: "On this machine, use Git identity sebastianlang84 with email sebastian.lang@gmx.at for commits when repository local Git config is missing.",
      tags: ["git", "identity", "commit", "user.email"],
      importance: 0.9,
      confidence: 0.9,
      metadata: { canonicalKey: "git.identity.default" },
    });

    store.createMemory({
      scope: "global",
      title: "Weather banana invoice tracking",
      summary: "Weather banana invoice notes are unrelated to source control identity and should satisfy the negative query.",
      tags: ["weather", "invoice"],
    });

    for (const query of [
      "git",
      "identity",
      "git credentials user.email",
      "commit author identity",
      "git credentials identity user.email commit author git.identity.default",
      "uga uga bongo git",
    ]) {
      const results = store.searchMemories({ query, scope: ["global"] });
      assert.equal(results[0]?.id, gitIdentity.id, `expected Git identity as top result for query: ${query}`);
    }

    const negativeResults = store.searchMemories({ query: "weather banana invoice", scope: ["global"] });
    assert.notEqual(negativeResults[0]?.id, gitIdentity.id);

    const negativeFallbackResults = store.searchMemories({ query: "weather credentials invoice", scope: ["global"] });
    assert.notEqual(negativeFallbackResults[0]?.id, gitIdentity.id);

    const filteredFallbackResults = store.searchMemories({ query: "uga uga bongo git", scope: ["repo"] });
    assert.equal(filteredFallbackResults.some((result) => result.id === gitIdentity.id), false);
  } finally {
    store.close();
  }
});

test("searchMemories relaxed lexical fallback does not expand hardcoded aliases", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath, embeddingAdapter: createNoSemanticEmbeddingAdapter() });

  try {
    const emailMemory = store.createMemory({
      scope: "global",
      title: "Default email identity",
      summary: "Use this email address for the default commit identity.",
      tags: ["email", "identity"],
    });

    const exactResults = store.searchMemories({ query: "email", scope: ["global"] });
    assert.equal(exactResults[0]?.id, emailMemory.id);

    for (const query of ["mail", "credentials"]) {
      const results = store.searchMemories({ query, scope: ["global"] });
      assert.equal(results.some((result) => result.id === emailMemory.id), false, `did not expect alias match for query: ${query}`);
    }
  } finally {
    store.close();
  }
});

test("searchMemories retrieval-quality eval keeps distinct operational facts discoverable", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath, embeddingAdapter: createNoSemanticEmbeddingAdapter() });

  try {
    const gitIdentity = store.createMemory({
      scope: "global",
      title: "Default Git commit identity",
      summary: "Use sebastianlang84 with email sebastian.lang@gmx.at for Git commits when repository local config is missing.",
      tags: ["git", "identity", "commit", "email"],
      importance: 0.9,
      confidence: 0.9,
    });

    const githubSshPush = store.createMemory({
      scope: "global",
      title: "GitHub push via SSH",
      summary: "Use SSH remotes for GitHub pushes and avoid HTTPS askpass credential prompts.",
      tags: ["github", "push", "ssh", "remote"],
      importance: 0.9,
      confidence: 0.9,
    });

    const repoPath = store.createMemory({
      scope: "repo",
      repoPath: "/home/wasti/.pi/agent/git/github.com/sebastianlang84/pi-ext-memory",
      title: "pi-memory repository path",
      summary: "The pi-memory checkout path is /home/wasti/.pi/agent/git/github.com/sebastianlang84/pi-ext-memory.",
      tags: ["repo", "path", "pi-memory"],
      importance: 0.8,
      confidence: 0.9,
    });

    store.createMemory({
      scope: "global",
      title: "Git commit email cleanup",
      summary: "A Git commit task mentions email notifications but does not define the default identity.",
      tags: ["git", "commit", "email"],
      importance: 0.9,
      confidence: 0.9,
    });

    store.createMemory({
      scope: "global",
      title: "GitHub SSH clone troubleshooting",
      summary: "GitHub SSH clone debugging mentions push only as an unrelated transport note.",
      tags: ["github", "ssh", "clone"],
      importance: 0.9,
      confidence: 0.9,
    });

    store.createMemory({
      scope: "repo",
      repoPath: repoPath.repoPath,
      title: "Repository issue path",
      summary: "A repository path note for temporary issue scans, not the pi-memory checkout location.",
      tags: ["repo", "path", "issue-scan"],
      importance: 0.8,
      confidence: 0.9,
    });

    const weatherNoise = store.createMemory({
      scope: "global",
      title: "Weather invoice notes",
      summary: "Weather invoice notes are unrelated operational noise for retrieval negative controls.",
      tags: ["weather", "invoice"],
    });

    const cases = [
      { query: "git commit identity", expectedId: gitIdentity.id },
      { query: "github push ssh", expectedId: githubSshPush.id },
      { query: "ssh remote", expectedId: githubSshPush.id },
      { query: "repo path pi-memory", expectedId: repoPath.id, repoPath: repoPath.repoPath },
    ];

    for (const retrievalCase of cases) {
      const results = store.searchMemories({
        query: retrievalCase.query,
        scope: retrievalCase.repoPath ? ["repo"] : undefined,
        repoPath: retrievalCase.repoPath,
      });
      assert.equal(results[0]?.id, retrievalCase.expectedId, `expected top result for query: ${retrievalCase.query}`);
      assert.notEqual(results[0]?.id, weatherNoise.id, `noise result must not win for query: ${retrievalCase.query}`);
    }
  } finally {
    store.close();
  }
});

test("searchMemories includes tags in lexical retrieval without special aliases", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath, embeddingAdapter: createNoSemanticEmbeddingAdapter() });

  try {
    const taggedOnly = store.createMemory({
      scope: "global",
      title: "Transport preference",
      summary: "Use the secure transport path for publication.",
      tags: ["github", "ssh"],
    });

    const results = store.searchMemories({ query: "github ssh", scope: ["global"] });
    assert.equal(results[0]?.id, taggedOnly.id);
    assert.deepEqual(results[0]?.tags, ["github", "ssh"]);
  } finally {
    store.close();
  }
});

test("searchMemories applies kind and scope filters", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "handoff",
      scope: "session",
      sessionId: "session-rank-1",
      title: "Project ranking handoff",
      summary: "Rankingpilot should stay in the session retrieval path for the current plan.",
      tags: ["ranking"],
    });

    store.createMemory({
      kind: "todo",
      scope: "repo",
      title: "Repo ranking todo",
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
      kind: ["handoff"],
      scope: ["session"],
      sessionId: "session-rank-1",
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.title, "Project ranking handoff");
    assert.equal(results[0]?.kind, "handoff");
    assert.equal(results[0]?.scope, "session");
  } finally {
    store.close();
  }
});

test("searchMemories finds legacy project records by projectId without a repoPath filter", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    const legacyProject = store.createMemory({
      kind: "todo",
      scope: "project",
      projectId: "legacy-project",
      repoPath: "/old/repo-path-metadata",
      title: "Legacy project decision",
      summary: "Legacyprojectneedle should remain discoverable by project id alone.",
      tags: ["legacy-project"],
    });

    store.createMemory({
      kind: "todo",
      scope: "project",
      projectId: "other-project",
      repoPath: "/old/repo-path-metadata",
      title: "Other project decision",
      summary: "Legacyprojectneedle belongs to a different project id.",
      tags: ["legacy-project"],
    });

    store.createMemory({
      kind: "todo",
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
      kind: "todo",
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
