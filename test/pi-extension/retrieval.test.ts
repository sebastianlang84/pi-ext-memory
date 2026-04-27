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
} from "../../src/pi-extension/retrieval.ts";
import type { MemorySearchResult } from "../../src/core/index.ts";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function createResult(id: string, title: string): MemorySearchResult {
  return {
    id,
    kind: "decision",
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
      kind: "decision",
      scope: "project",
      title: "Project note",
      summary: "Project-scoped memory should get the current project id.",
    },
    context,
  );

  const repoMemory = decorateCreateMemoryInput(
    {
      kind: "fact",
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

test("buildTurnSearchPlan separates session, project, repo, global, and legacy fallback stages", () => {
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
      { scope: undefined, sessionId: undefined, projectId: undefined, repoPath: undefined },
    ],
  );
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
  assert.match(message?.content ?? "", /Memory triggers: search before guessing/);
  assert.match(message?.content ?? "", /Save or update durable user corrections/);
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
