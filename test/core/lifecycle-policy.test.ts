import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMemoryLifecycleDefaults,
  buildActiveCapCountFilter,
  classifyLifecycleAuditFinding,
  computeDefaultExpiresAt,
  computeDefaultStaleAfter,
  getEffectiveLifecycleScope,
  isActiveUnexpiredHandoff,
  isHandoffExpired,
  isMemoryExpired,
  isMemoryPastStaleAfter,
  isTodoStale,
  type MemoryRecord,
} from "../../src/core/index.ts";

const now = new Date("2026-05-13T12:00:00.000Z");

function memory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "memory-1",
    kind: "fact",
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
  assert.equal(computeDefaultStaleAfter("session", now), "2026-06-12T12:00:00.000Z");
  assert.equal(computeDefaultExpiresAt("global", now), "2026-05-27T12:00:00.000Z");

  const todo = applyMemoryLifecycleDefaults(memory({ kind: "todo", scope: "session" }), now);
  const handoff = applyMemoryLifecycleDefaults(memory({ kind: "handoff", scope: "global" }), now);
  const explicit = applyMemoryLifecycleDefaults(memory({ kind: "handoff", expiresAt: "2099-01-01T00:00:00.000Z" }), now);

  assert.equal(todo.staleAfter, "2026-06-12T12:00:00.000Z");
  assert.equal(handoff.expiresAt, "2026-05-27T12:00:00.000Z");
  assert.equal(explicit.expiresAt, "2099-01-01T00:00:00.000Z");
});

test("active cap count filters keep lifecycle identity inputs in policy", () => {
  assert.deepEqual(
    buildActiveCapCountFilter(memory({ kind: "handoff", scope: "session", sessionId: "session-1", repoPath: "/repo/a", projectId: "project-a" })),
    { kind: ["handoff"], scope: ["session"], status: "active", repoPath: "/repo/a", projectId: "project-a" },
  );
  assert.equal(buildActiveCapCountFilter(memory({ kind: "fact" })), null);
});

test("lifecycle classification handles stale todos, expired handoffs, and invalid timestamps", () => {
  const staleTodo = memory({ kind: "todo", staleAfter: "2026-05-01T00:00:00.000Z" });
  const expiredHandoff = memory({ kind: "handoff", expiresAt: "2026-05-01T00:00:00.000Z" });
  const invalidHandoff = memory({ kind: "handoff", expiresAt: "not-a-date" });

  assert.equal(isMemoryPastStaleAfter(staleTodo, now), true);
  assert.equal(isMemoryExpired(expiredHandoff, now), true);
  assert.equal(isTodoStale(staleTodo, now), true);
  assert.equal(isHandoffExpired(expiredHandoff, now), true);
  assert.equal(isActiveUnexpiredHandoff(expiredHandoff, now), false);
  assert.equal(isActiveUnexpiredHandoff(invalidHandoff, now), false);
  assert.equal(isActiveUnexpiredHandoff(memory({ kind: "handoff" }), now), true);

  assert.deepEqual(classifyLifecycleAuditFinding(staleTodo, now), {
    type: "stale_todo",
    reason: "Todo stale: stale_after=2026-05-01T00:00:00.000Z passed",
    suggestedAction: "Archive if done, or update status/tags to reflect current state",
  });
  assert.deepEqual(classifyLifecycleAuditFinding(expiredHandoff, now), {
    type: "expired_handoff",
    reason: "Handoff expired: expires_at=2026-05-01T00:00:00.000Z passed",
    suggestedAction: "Archive if the task is complete or no longer relevant",
  });
  assert.equal(classifyLifecycleAuditFinding(memory({ kind: "todo", status: "done", staleAfter: "2026-05-01T00:00:00.000Z" }), now), null);
});
