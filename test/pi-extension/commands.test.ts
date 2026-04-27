import assert from "node:assert/strict";
import test from "node:test";

import {
  formatMemoryReview,
  formatMemorySessionSaved,
  formatMemorySessionSaveUsage,
} from "../../src/pi-extension/formatters.ts";
import type { MemorySearchResult, SearchMemoriesInput } from "../../src/core/index.ts";

function createResult(): MemorySearchResult {
  return {
    id: "memory-1",
    kind: "decision",
    scope: "project",
    title: "Keep writes manual-first",
    summary: "Use review helpers instead of autosaving every turn.",
    tags: ["policy"],
    projectId: "@acme/api",
    repoPath: "/repo",
    importance: 0.8,
    confidence: 0.9,
    createdAt: "2026-04-27T10:00:00.000Z",
    updatedAt: "2026-04-27T10:00:00.000Z",
    matchScore: 0.92,
    lexicalScore: 0.7,
    semanticScore: 0.65,
    scopeScore: 0.8,
    recencyScore: 0.9,
  };
}

test("formatMemoryReview shows read-only guidance, suggested actions, and relevant memories", () => {
  const searchPlan: SearchMemoriesInput[] = [
    { query: "review", limit: 6, scope: ["session"], sessionId: "session-123" },
    { query: "review", limit: 6, scope: ["project"], projectId: "@acme/api" },
  ];

  const output = formatMemoryReview(
    [createResult()],
    searchPlan,
    { sessionId: "session-123", projectId: "@acme/api", repoPath: "/repo" },
    "/db.sqlite",
    "Reviewed retrieval quality and kept the flow manual-first.",
  );

  assert.match(output, /Manual memory review \(read-only\)\./);
  assert.match(output, /suggested_actions:/);
  assert.match(output, /Use memory_update/);
  assert.match(output, /Use \/memory-session-save <summary>/);
  assert.match(output, /relevant_memories: 1/);
  assert.match(output, /Keep writes manual-first/);
});

test("formatMemorySessionSaveUsage shows explicit usage guidance", () => {
  const output = formatMemorySessionSaveUsage(12);

  assert.match(output, /^Usage: \/memory-session-save <summary>/);
  assert.match(output, /at least 12 characters/);
});

test("formatMemorySessionSaved renders the persisted session summary", () => {
  const output = formatMemorySessionSaved(
    {
      id: "session-123",
      summary: "Captured the manual review helper and explicit session summary flow.",
      projectId: "@acme/api",
      repoPath: "/repo",
    },
    "/db.sqlite",
  );

  assert.match(output, /Saved session summary for session-123\./);
  assert.match(output, /summary: Captured the manual review helper/);
  assert.match(output, /project_id: @acme\/api/);
  assert.match(output, /repo_path: \/repo/);
});
