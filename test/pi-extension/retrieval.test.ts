import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildTurnMemoryMessage,
  buildTurnSearchPlan,
  decorateCreateMemoryInput,
  deriveMemoryTurnContext,
  findLatestHandoffForTurn,
  retrieveMemoriesForTurn,
} from "../../src/pi-extension/retrieval.ts";
import { initializeMemoryStore } from "../../src/core/index.ts";
import type { GeneratedMemoryEmbedding, MemorySearchResult, SearchMemoriesInput, SearchMemoriesOptions } from "../../src/core/index.ts";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function createResult(id: string, title: string): MemorySearchResult {
  return {
    id,
    kind: "todo",
    scope: "project",
    title,
    summary: `${title} summary for retrieval hook tests.`,
    tags: [],
    projectId: "@acme/api",
    importance: 0.8,
    confidence: 0.9,
    createdAt: "2026-04-16T12:00:00.000Z",
    updatedAt: "2026-04-16T12:00:00.000Z",
    matchScore: 0.9,
    lexicalScore: 0.6,
    semanticScore: 0.7,
    scopeScore: 0.8,
    recencyScore: 0.7,
  };
}

test("deriveMemoryTurnContext maps repo and nearest project markers from cwd", () => {
  const root = createTempDir("pi-memory-retrieval-context-");
  const repoRoot = join(root, "workspace");
  const projectRoot = join(repoRoot, "packages", "api");
  const cwd = join(projectRoot, "src");

  mkdirSync(join(repoRoot, ".git"), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "root-workspace" }), "utf8");
  writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "@acme/api" }), "utf8");

  const context = deriveMemoryTurnContext(cwd, "session-123");

  assert.equal(context.sessionId, "session-123");
  assert.equal(context.repoPath, repoRoot);
  assert.equal(context.projectPath, projectRoot);
  assert.equal(context.projectId, "@acme/api");
});

test("decorateCreateMemoryInput enriches scoped memories with runtime context", () => {
  const context = {
    cwd: "/repo/packages/api",
    sessionId: "session-456",
    projectId: "@acme/api",
    projectPath: "/repo/packages/api",
    repoPath: "/repo",
  };

  const projectMemory = decorateCreateMemoryInput(
    {
      kind: "todo",
      scope: "project",
      title: "Project note",
      summary: "Project-scoped memory should get the current project id.",
    },
    context,
  );

  const repoMemory = decorateCreateMemoryInput(
    {
      kind: "todo",
      scope: "repo",
      title: "Repo note",
      summary: "Repo-scoped memory should get project and repo context.",
    },
    context,
  );

  const sessionMemory = decorateCreateMemoryInput(
    {
      kind: "todo",
      scope: "session",
      title: "Session note",
      summary: "Session-scoped memory should get session, project, and repo context.",
    },
    context,
  );

  assert.equal(projectMemory.projectId, "@acme/api");
  assert.equal(projectMemory.repoPath, undefined);
  assert.equal(projectMemory.sessionId, undefined);

  assert.equal(repoMemory.projectId, "@acme/api");
  assert.equal(repoMemory.repoPath, "/repo");
  assert.equal(repoMemory.sessionId, undefined);

  assert.equal(sessionMemory.projectId, "@acme/api");
  assert.equal(sessionMemory.repoPath, "/repo");
  assert.equal(sessionMemory.sessionId, "session-456");
});

test("buildTurnSearchPlan separates session, project, repo, and global stages without unscoped fallback", () => {
  const plan = buildTurnSearchPlan("cache rollout", {
    cwd: "/repo/packages/api",
    sessionId: "session-789",
    projectId: "@acme/api",
    projectPath: "/repo/packages/api",
    repoPath: "/repo",
  });

  assert.deepEqual(
    plan.map((stage) => ({ scope: stage.scope, sessionId: stage.sessionId, projectId: stage.projectId, repoPath: stage.repoPath })),
    [
      { scope: ["session"], sessionId: "session-789", projectId: undefined, repoPath: undefined },
      { scope: ["project"], sessionId: undefined, projectId: "@acme/api", repoPath: undefined },
      { scope: ["repo"], sessionId: undefined, projectId: undefined, repoPath: "/repo" },
      { scope: ["global"], sessionId: undefined, projectId: undefined, repoPath: undefined },
    ],
  );
});

test("buildTurnSearchPlan skips session stage for blank session ids", () => {
  const plan = buildTurnSearchPlan("cache rollout", {
    cwd: "/repo/packages/api",
    sessionId: "   ",
    projectId: "@acme/api",
    projectPath: "/repo/packages/api",
    repoPath: "/repo",
  });

  assert.deepEqual(
    plan.map((stage) => ({ scope: stage.scope, sessionId: stage.sessionId, projectId: stage.projectId, repoPath: stage.repoPath })),
    [
      { scope: ["project"], sessionId: undefined, projectId: "@acme/api", repoPath: undefined },
      { scope: ["repo"], sessionId: undefined, projectId: undefined, repoPath: "/repo" },
      { scope: ["global"], sessionId: undefined, projectId: undefined, repoPath: undefined },
    ],
  );
});

test("retrieveMemoriesForTurn finds legacy project memories without matching repoPath metadata", () => {
  const dbPath = join(createTempDir("pi-memory-retrieval-legacy-project-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    const legacyProject = store.createMemory({
      kind: "todo",
      scope: "project",
      projectId: "@acme/api",
      repoPath: "/old/repo-path-metadata",
      title: "Legacy project retrieval decision",
      summary: "Legacyturnneedle should remain discoverable through the project stage alone.",
    });

    const oldRepo = store.createMemory({
      kind: "todo",
      scope: "repo",
      repoPath: "/old/repo-path-metadata",
      title: "Old repo retrieval decision",
      summary: "Legacyturnneedle should not require matching legacy repo metadata.",
    });

    const result = retrieveMemoriesForTurn(store, "legacyturnneedle", {
      cwd: "/new/repo/packages/api",
      sessionId: "session-789",
      projectId: "@acme/api",
      projectPath: "/new/repo/packages/api",
      repoPath: "/new/repo",
    });

    assert.ok(result.results.some((memory) => memory.id === legacyProject.id));
    assert.ok(!result.results.some((memory) => memory.id === oldRepo.id));
    const projectStage = result.searchPlan.find((stage) => stage.scope?.includes("project"));
    assert.equal(projectStage?.projectId, "@acme/api");
    assert.equal(projectStage?.repoPath, undefined);
  } finally {
    store.close();
  }
});

test("retrieveMemoriesForTurn does not retrieve all session memories for blank session ids", () => {
  const dbPath = join(createTempDir("pi-memory-retrieval-blank-session-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "todo",
      scope: "session",
      sessionId: "other-session",
      title: "Other session memory",
      summary: "Blanksessionneedle belongs to a different session and must not be injected.",
    });

    const result = retrieveMemoriesForTurn(store, "blanksessionneedle", {
      cwd: "/repo/packages/api",
      sessionId: "  \t ",
    });

    assert.deepEqual(result.results, []);
    assert.ok(result.searchPlan.every((stage) => stage.scope?.[0] !== "session"));
  } finally {
    store.close();
  }
});

test("retrieveMemoriesForTurn reuses one query embedding across staged searches", () => {
  const embedding: GeneratedMemoryEmbedding = {
    model: "mock-query-embedding",
    dimensions: 1,
    vector: [1],
    contentHash: "mock-query-hash",
  };
  const receivedOptions: Array<SearchMemoriesOptions | undefined> = [];
  let embeddingCalls = 0;

  const result = retrieveMemoriesForTurn(
    {
      createSearchQueryEmbedding(query) {
        embeddingCalls += 1;
        assert.equal(query, "cache rollout");
        return embedding;
      },
      searchMemories(_input: SearchMemoriesInput, options?: SearchMemoriesOptions) {
        receivedOptions.push(options);
        return [];
      },
    },
    "cache rollout",
    {
      cwd: "/repo/packages/api",
      sessionId: "session-789",
      projectId: "@acme/api",
      projectPath: "/repo/packages/api",
      repoPath: "/repo",
    },
  );

  assert.equal(embeddingCalls, 1);
  assert.equal(result.searchPlan.length, 4);
  assert.equal(receivedOptions.length, 4);
  assert.ok(receivedOptions.every((options) => options?.queryEmbedding === embedding));
});

test("retrieveMemoriesForTurn does not inject wrong-context memories through unscoped fallback", () => {
  const dbPath = join(createTempDir("pi-memory-retrieval-fallback-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "todo",
      scope: "project",
      projectId: "@other/project",
      title: "Wrong project memory",
      summary: "Wrongcontextneedle belongs to a different project and must not be injected by fallback.",
    });
    store.createMemory({
      kind: "todo",
      scope: "repo",
      repoPath: "/other/repo",
      title: "Wrong repo memory",
      summary: "Wrongcontextneedle belongs to a different repo and must not be injected by fallback.",
    });

    const result = retrieveMemoriesForTurn(store, "wrongcontextneedle", {
      cwd: "/repo/packages/api",
      sessionId: "session-789",
      projectId: "@acme/api",
      projectPath: "/repo/packages/api",
      repoPath: "/repo",
    });

    assert.deepEqual(result.results, []);
    assert.ok(result.searchPlan.every((stage) => stage.scope !== undefined));
  } finally {
    store.close();
  }
});

test("findLatestHandoffForTurn prefers exact session handoff before repo fallback", () => {
  const dbPath = join(createTempDir("pi-memory-handoff-retrieval-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    const fallback = store.createMemory({
      kind: "handoff",
      scope: "session",
      sessionId: "other-session",
      repoPath: "/repo",
      title: "Other session handoff",
      summary: "Fallback handoff for same repo.",
    });
    const current = store.createMemory({
      kind: "handoff",
      scope: "session",
      sessionId: "session-789",
      repoPath: "/repo",
      title: "Current session handoff",
      summary: "Current session handoff should win.",
    });

    const exact = findLatestHandoffForTurn(store, { cwd: "/repo", sessionId: "session-789", repoPath: "/repo" });
    assert.equal(exact?.memory.id, current.id);
    assert.equal(exact?.isFallback, false);

    store.archiveMemory({ id: current.id });
    const repoFallback = findLatestHandoffForTurn(store, { cwd: "/repo", sessionId: "missing-session", repoPath: "/repo" });
    assert.equal(repoFallback?.memory.id, fallback.id);
    assert.equal(repoFallback?.isFallback, true);
  } finally {
    store.close();
  }
});

test("findLatestHandoffForTurn orders exact session before repo fallback before project fallback", () => {
  const dbPath = join(createTempDir("pi-memory-handoff-order-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    const projectFallback = store.createMemory({
      kind: "handoff",
      scope: "project",
      projectId: "@acme/api",
      title: "Project fallback handoff",
      summary: "Project fallback should lose to repo fallback when both are relevant.",
    });
    const repoFallback = store.createMemory({
      kind: "handoff",
      scope: "repo",
      repoPath: "/repo",
      title: "Repo fallback handoff",
      summary: "Repo fallback should win before project fallback.",
    });
    const exact = store.createMemory({
      kind: "handoff",
      scope: "session",
      sessionId: "session-789",
      projectId: "@acme/api",
      repoPath: "/repo",
      title: "Exact session handoff",
      summary: "Exact session handoff wins over all fallbacks.",
    });

    const context = { cwd: "/repo/packages/api", sessionId: "session-789", projectId: "@acme/api", repoPath: "/repo" };
    assert.equal(findLatestHandoffForTurn(store, context)?.memory.id, exact.id);

    store.archiveMemory({ id: exact.id });
    assert.equal(findLatestHandoffForTurn(store, context)?.memory.id, repoFallback.id);

    store.archiveMemory({ id: repoFallback.id });
    assert.equal(findLatestHandoffForTurn(store, context)?.memory.id, projectFallback.id);
  } finally {
    store.close();
  }
});

test("findLatestHandoffForTurn excludes expired active handoffs", () => {
  const dbPath = join(createTempDir("pi-memory-handoff-expired-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    const session = store.createMemory({
      kind: "handoff",
      scope: "session",
      sessionId: "session-789",
      repoPath: "/repo",
      title: "Session handoff",
      summary: "Session handoff is always returned since expiresAt is removed.",
    });
    const fallback = store.createMemory({
      kind: "handoff",
      scope: "repo",
      repoPath: "/repo",
      title: "Repo fallback handoff",
      summary: "Repo fallback handoff is always returned since expiresAt is removed.",
    });

    // expiresAt removed in slice5 — all active handoffs are returned regardless
    const latest = findLatestHandoffForTurn(store, { cwd: "/repo", sessionId: "session-789", repoPath: "/repo" });
    assert.ok(latest !== undefined, "expected session handoff to be returned");
    assert.equal(latest?.memory.id, session.id);

    store.archiveMemory({ id: fallback.id });
    // session handoff is still returned after repo fallback is archived
    assert.ok(findLatestHandoffForTurn(store, { cwd: "/repo", sessionId: "session-789", repoPath: "/repo" }) !== undefined);
  } finally {
    store.close();
  }
});

test("fallback handoff preload warns agents not to overwrite it", () => {
  const message = buildTurnMemoryMessage(
    "continue",
    [],
    { cwd: "/repo", sessionId: "session-789", repoPath: "/repo" },
    "/db.sqlite",
    [],
    {
      memory: {
        id: "handoff-fallback",
        kind: "handoff",
        scope: "session",
        sessionId: "other-session",
        repoPath: "/repo",
        title: "Fallback handoff",
        summary: "Fallback handoff should be read-only unless explicit.",
        tags: ["handoff"],
        importance: 0.9,
        confidence: 0.9,
        status: "active",
        pinned: false,
        createdAt: "2026-05-08T12:00:00.000Z",
        updatedAt: "2026-05-08T12:30:00.000Z",
        metadata: {},
      },
      isFallback: true,
    },
  );

  assert.ok(message);
  assert.match(message.content, /from another matching session\/repo\/project; do not overwrite unless explicit/);
});

test("buildTurnMemoryMessage injects latest handoff before normal memories", () => {
  const handoff = {
    memory: {
      id: "handoff-1",
      kind: "handoff" as const,
      scope: "session" as const,
      sessionId: "session-789",
      title: "Context reset handoff",
      summary: "Resume handoff design after context reset.",
      body: "## Next steps\n- Implement command UX",
      tags: ["handoff"],
      importance: 0.9,
      confidence: 0.9,
      status: "active" as const,
      pinned: false,
      createdAt: "2026-05-08T12:00:00.000Z",
      updatedAt: "2026-05-08T12:30:00.000Z",
      metadata: {},
    },
    isFallback: false,
  };

  const message = buildTurnMemoryMessage(
    "continue",
    [],
    { cwd: "/repo", sessionId: "session-789", repoPath: "/repo" },
    "/db.sqlite",
    [],
    handoff,
  );

  assert.ok(message);
  assert.match(message.content, /Latest active handoff:/);
  assert.match(message.content, /Context reset handoff/);
  assert.match(message.content, /## Next steps/);
  assert.equal(message.details.latestHandoffId, "handoff-1");
  assert.equal(message.details.latestHandoffIsFallback, false);
});

test("buildTurnMemoryMessage injects memory triggers even when no results match", () => {
  const message = buildTurnMemoryMessage(
    "subagent setup",
    [],
    {
      cwd: "/repo/packages/api",
      sessionId: "session-789",
      projectId: "@acme/api",
      projectPath: "/repo/packages/api",
      repoPath: "/repo",
    },
    "/home/user/.pi/agent/pi-memory.sqlite",
    [],
  );

  assert.ok(message);
  assert.match(message?.content ?? "", /Relevant memory context: none found\./);
  assert.match(message?.content ?? "", /Memory triggers: use memory_search/);
  assert.match(message?.content ?? "", /Memory writes: save or update only durable/);
  assert.deepEqual(message?.details.resultIds, []);
});

test("buildTurnMemoryMessage injects only a compact top-N context block", () => {
  const results = [
    createResult("1", "First memory"),
    createResult("2", "Second memory"),
    createResult("3", "Third memory"),
    createResult("4", "Fourth memory"),
    createResult("5", "Fifth memory"),
  ];

  const message = buildTurnMemoryMessage(
    "cache rollout",
    results,
    {
      cwd: "/repo/packages/api",
      sessionId: "session-789",
      projectId: "@acme/api",
      projectPath: "/repo/packages/api",
      repoPath: "/repo",
    },
    "/repo/.pi/pi-memory.sqlite",
    buildTurnSearchPlan("cache rollout", {
      cwd: "/repo/packages/api",
      sessionId: "session-789",
      projectId: "@acme/api",
      projectPath: "/repo/packages/api",
      repoPath: "/repo",
    }),
  );

  assert.ok(message);
  assert.equal(message?.display, false);
  assert.match(message?.content ?? "", /Relevant memory context:/);
  assert.match(message?.content ?? "", /First memory/);
  assert.match(message?.content ?? "", /Second memory/);
  assert.match(message?.content ?? "", /Third memory/);
  assert.doesNotMatch(message?.content ?? "", /Fourth memory/);
  assert.doesNotMatch(message?.content ?? "", /Fifth memory/);
  assert.equal(message?.details.resultIds.length, 5);
});
