import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMemoryLifecycleDefaults,
  buildActiveCapCountFilter,
  classifyLifecycleAuditFinding,
  getEffectiveLifecycleScope,
  isActiveUnexpiredHandoff,
  type MemoryRecord,
} from "../../src/core/index.ts";

const now = new Date("2026-05-13T12:00:00.000Z");

function memory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "memory-1",
    kind: "todo",
    scope: "repo",
    title: "Test memory",
    summary: "Test memory summary with enough detail.",
    tags: [],
    importance: 0.5,
    confidence: 1,
    status: "active",
    pinned: false,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    metadata: {},
    ...overrides,
  };
}

test("lifecycle defaults are deterministic and session scope uses repo policy", () => {
  assert.equal(getEffectiveLifecycleScope("session"), "repo");

  const todo = applyMemoryLifecycleDefaults(memory({ kind: "todo", scope: "session" }), now);
  const handoff = applyMemoryLifecycleDefaults(memory({ kind: "handoff", scope: "global" }), now);

  // staleAfter and expiresAt fields removed in slice5 — applyMemoryLifecycleDefaults is now a no-op
  assert.equal(todo.staleAfter, undefined);
  assert.equal(handoff.expiresAt, undefined);
});

test("active cap count filters keep lifecycle identity inputs in policy", () => {
  assert.deepEqual(
    buildActiveCapCountFilter(memory({ kind: "handoff", scope: "session", sessionId: "session-1", repoPath: "/repo/a", projectId: "project-a" })),
    { kind: ["handoff"], scope: ["session"], status: "active", repoPath: "/repo/a", projectId: "project-a" },
  );
  assert.equal(buildActiveCapCountFilter(memory({ kind: undefined })), null);
});

test("lifecycle classification returns null for all memories (staleAfter/expiresAt removed)", () => {
  // staleAfter and expiresAt fields removed in slice5 — classifyLifecycleAuditFinding always returns null
  assert.equal(classifyLifecycleAuditFinding(memory({ kind: "todo" }), now), null);
  assert.equal(classifyLifecycleAuditFinding(memory({ kind: "handoff" }), now), null);

  // isActiveUnexpiredHandoff only checks kind and status now
  assert.equal(isActiveUnexpiredHandoff(memory({ kind: "handoff" }), now), true);
  assert.equal(isActiveUnexpiredHandoff(memory({ kind: "handoff", status: "archived" }), now), false);
});
