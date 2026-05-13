import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActiveCapCountFilter,
  checkActiveCap,
  classifyLifecycleAuditFinding,
  getEffectiveLifecycleScope,
  isActiveHandoff,
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

function daysAgo(days: number, base: Date = now): string {
  return new Date(base.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

test("getEffectiveLifecycleScope maps session to repo", () => {
  assert.equal(getEffectiveLifecycleScope("session"), "repo");
  assert.equal(getEffectiveLifecycleScope("repo"), "repo");
  assert.equal(getEffectiveLifecycleScope("global"), "global");
  assert.equal(getEffectiveLifecycleScope("project"), "project");
});

test("active cap count filters keep lifecycle identity inputs in policy", () => {
  assert.deepEqual(
    buildActiveCapCountFilter(memory({ kind: "handoff", scope: "session", sessionId: "session-1", repoPath: "/repo/a", projectId: "project-a" })),
    { kind: ["handoff"], scope: ["session"], status: "active", repoPath: "/repo/a", projectId: "project-a" },
  );
  assert.equal(buildActiveCapCountFilter(memory({ kind: undefined })), null);
});

test("classifyLifecycleAuditFinding returns null for fresh todo and handoff", () => {
  assert.equal(classifyLifecycleAuditFinding(memory({ kind: "todo", updatedAt: daysAgo(0) }), now), null);
  assert.equal(classifyLifecycleAuditFinding(memory({ kind: "handoff", updatedAt: daysAgo(0) }), now), null);
  // Just under threshold
  assert.equal(classifyLifecycleAuditFinding(memory({ kind: "todo", updatedAt: daysAgo(29) }), now), null);
  assert.equal(classifyLifecycleAuditFinding(memory({ kind: "handoff", updatedAt: daysAgo(6) }), now), null);
});

test("classifyLifecycleAuditFinding returns stale-todo for old todos", () => {
  const stale = classifyLifecycleAuditFinding(memory({ kind: "todo", updatedAt: daysAgo(31) }), now);
  assert.ok(stale !== null);
  assert.equal(stale.type, "stale_todo");
  assert.match(stale.reason, /31 days/);
  assert.ok(stale.suggestedAction.length > 0);
});

test("classifyLifecycleAuditFinding returns expired-handoff for old handoffs", () => {
  const expired = classifyLifecycleAuditFinding(memory({ kind: "handoff", updatedAt: daysAgo(8) }), now);
  assert.ok(expired !== null);
  assert.equal(expired.type, "expired_handoff");
  assert.match(expired.reason, /8 days/);
  assert.ok(expired.suggestedAction.length > 0);
});

test("classifyLifecycleAuditFinding uses effective scope for session memories", () => {
  // session maps to repo (staleAfterDays: 30)
  const stale = classifyLifecycleAuditFinding(memory({ kind: "todo", scope: "session", updatedAt: daysAgo(31) }), now);
  assert.ok(stale !== null);
  assert.equal(stale.type, "stale_todo");
});

test("classifyLifecycleAuditFinding returns null for non-todo/handoff kinds", () => {
  assert.equal(classifyLifecycleAuditFinding(memory({ kind: undefined, updatedAt: daysAgo(100) }), now), null);
});

test("checkActiveCap throws MemoryValidationError when count meets hard cap", async () => {
  const { MemoryValidationError } = await import("../../src/core/index.ts");
  assert.throws(
    () => checkActiveCap("todo", "repo", 50),
    (err) => err instanceof MemoryValidationError && err.message.includes("active_todo_cap_exceeded"),
  );
  assert.throws(
    () => checkActiveCap("handoff", "global", 5),
    (err) => err instanceof MemoryValidationError && err.message.includes("active_handoff_cap_exceeded"),
  );
});

test("checkActiveCap does not throw when count is below hard cap", () => {
  assert.doesNotThrow(() => checkActiveCap("todo", "repo", 49));
  assert.doesNotThrow(() => checkActiveCap("handoff", "global", 4));
});

test("checkActiveCap does not throw for unknown kind", () => {
  assert.doesNotThrow(() => checkActiveCap(null, "repo", 1000));
  assert.doesNotThrow(() => checkActiveCap("note", "repo", 1000));
});

test("isActiveHandoff returns true only for active handoffs", () => {
  assert.equal(isActiveHandoff(memory({ kind: "handoff" }), now), true);
  assert.equal(isActiveHandoff(memory({ kind: "handoff", status: "archived" }), now), false);
  assert.equal(isActiveHandoff(memory({ kind: "todo" }), now), false);
  assert.equal(isActiveHandoff(memory({ kind: undefined }), now), false);
});
