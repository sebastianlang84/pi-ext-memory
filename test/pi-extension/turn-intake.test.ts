import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initializeMemoryStore } from "../../src/core/index.ts";
import { runTurnIntake } from "../../src/pi-extension/turn-intake.ts";

function assertTurnMessage(result: ReturnType<typeof runTurnIntake>): NonNullable<ReturnType<typeof runTurnIntake>> {
  assert.ok(result, "Expected a turn memory message");
  assert.equal(typeof result, "object");
  assert.equal(result.customType, "pi-memory-context");
  assert.equal(result.display, false);
  assert.equal(typeof result.content, "string");
  assert.ok(result.details);
  return result;
}

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Ages a fixture through the documented `createMemory` restore seam. The
 * turn-start hygiene audit reads the wall clock — `resolveHygieneCounts` calls
 * `runMemoryAudit(store)` without a reference time — so passing a future `now`
 * to `runTurnIntake` would not reach it; the fixture itself must be old.
 */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

test("runTurnIntake returns undefined for empty prompt with clean audit and no handoff", () => {
  const dbPath = join(createTempDir("pi-memory-turn-intake-empty-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    const result = runTurnIntake(store, "", "/repo", "session-abc");
    assert.equal(result, undefined);
  } finally {
    store.close();
  }
});

test("runTurnIntake returns handoff content for empty prompt when a handoff is present", () => {
  const dbPath = join(createTempDir("pi-memory-turn-intake-empty-handoff-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "handoff",
      scope: "session",
      sessionId: "session-abc",
      repoPath: "/repo",
      title: "Empty prompt handoff",
      summary: "Resume work after context reset — no user prompt yet.",
    });

    // Empty prompt simulates a fresh agent start before any user input.
    // The handoff must still be injected.
    const result = assertTurnMessage(runTurnIntake(store, "", "/repo", "session-abc"));
    assert.match(result.content, /Empty prompt handoff/);
    assert.equal(result.details.sessionId, "session-abc");
    assert.equal(result.details.latestHandoffId !== undefined, true);
  } finally {
    store.close();
  }
});

test("runTurnIntake returns handoff content when only a handoff is present", () => {
  const dbPath = join(createTempDir("pi-memory-turn-intake-handoff-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "handoff",
      scope: "session",
      sessionId: "session-abc",
      repoPath: "/repo",
      title: "Handoff only",
      summary: "Resume the handoffonly feature work.",
    });

    const result = assertTurnMessage(runTurnIntake(store, "handoffonly", "/repo", "session-abc"));
    assert.match(result.content, /Handoff only/);
    assert.equal(result.details.sessionId, "session-abc");
    assert.equal(result.details.latestHandoffId !== undefined, true);
  } finally {
    store.close();
  }
});

test("runTurnIntake returns compact guidance when no search results match", () => {
  const dbPath = join(createTempDir("pi-memory-turn-intake-no-memory-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    const result = assertTurnMessage(runTurnIntake(store, "memoryonlyneedle", "/repo", "session-abc"));
    assert.match(result.content, /pi-memory: no relevant stored context/);
    assert.match(result.content, /Prior-work: vary queries/);
    assert.equal(result.details.query, "memoryonlyneedle");
  } finally {
    store.close();
  }
});

test("runTurnIntake returns memory content when search results are present", () => {
  const dbPath = join(createTempDir("pi-memory-turn-intake-memory-"), "memory.sqlite");
  const repoRoot = createTempDir("pi-memory-turn-intake-repo-");
  mkdirSync(join(repoRoot, ".git"));
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "todo",
      scope: "repo",
      repoPath: repoRoot,
      title: "Memory only fact",
      summary: "The memoryonlyneedle decision was made in Q1.",
    });

    const result = assertTurnMessage(runTurnIntake(store, "memoryonlyneedle", repoRoot, "session-abc"));
    assert.match(result.content, /pi-memory context:/);
    assert.match(result.content, /Memory only fact/);
    assert.match(result.content, /Use memory_search for more/);
    assert.equal(result.details.query, "memoryonlyneedle");
  } finally {
    store.close();
  }
});

test("runTurnIntake injects the hygiene line on its own when there is no base message", () => {
  const dbPath = join(createTempDir("pi-memory-turn-intake-hygiene-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    // Older than MEMORY_POLICY.repo.todo.staleAfterDays (30), measured from updatedAt.
    const staleAt = daysAgo(40);
    store.createMemory({
      kind: "todo",
      scope: "repo",
      repoPath: "/repo",
      title: "Old todo",
      summary: "This todo has been around for a long time.",
    }, { createdAt: staleAt, updatedAt: staleAt });

    // Empty prompt and no handoff means there is no base message to append to,
    // so the hygiene line must be emitted as a standalone injection.
    const result = assertTurnMessage(runTurnIntake(store, "", "/repo", "session-abc"));
    assert.equal(result.content, "⚠ Memory hygiene: 1 stale todo, 0 old handoffs. Run memory_audit for details.");
    assert.deepEqual(result.details.resultIds, []);
    assert.equal(result.details.latestHandoffId, undefined);
  } finally {
    store.close();
  }
});

test("runTurnIntake combines handoff, memories, and hygiene line correctly", () => {
  const dbPath = join(createTempDir("pi-memory-turn-intake-combined-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "handoff",
      scope: "session",
      sessionId: "session-abc",
      repoPath: "/repo",
      title: "Combined handoff",
      summary: "Resume combinedneedle work after context reset.",
    });

    store.createMemory({
      kind: "todo",
      scope: "repo",
      repoPath: "/repo",
      title: "Combined memory fact",
      summary: "The combinedneedle was decided in Q2.",
    });

    // Aged past MEMORY_POLICY's staleAfterDays (30) and expireAfterDays (7),
    // so the hygiene audit counts one of each.
    const staleAt = daysAgo(40);
    store.createMemory({
      kind: "todo",
      scope: "repo",
      repoPath: "/repo",
      title: "Forgotten todo",
      summary: "This todo was last touched well over thirty days ago.",
    }, { createdAt: staleAt, updatedAt: staleAt });

    const expiredAt = daysAgo(10);
    store.createMemory({
      kind: "handoff",
      scope: "repo",
      repoPath: "/repo",
      title: "Forgotten handoff",
      summary: "This handoff was last touched well over seven days ago.",
    }, { createdAt: expiredAt, updatedAt: expiredAt });

    const result = assertTurnMessage(runTurnIntake(store, "combinedneedle", "/repo", "session-abc"));
    // Should contain handoff content — the fresh session handoff, not the
    // expired one, which isActiveHandoff filters out before injection.
    assert.match(result.content, /Combined handoff/);
    assert.doesNotMatch(result.content, /Forgotten handoff/);
    assert.equal(result.details.latestHandoffId !== undefined, true);
    // The hygiene line is appended to the base message rather than replacing it.
    assert.match(result.content, /^⚠ Memory hygiene: 1 stale todo, 1 old handoff\. Run memory_audit for details\.$/m);
    assert.ok(result.content.endsWith("Run memory_audit for details."), "hygiene line must be the last line");
  } finally {
    store.close();
  }
});
