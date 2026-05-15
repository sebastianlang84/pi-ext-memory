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
    assert.match(result.content, /Use memory_search if prior context matters/);
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
    assert.match(result.content, /pi-memory context \(user wins\):/);
    assert.match(result.content, /Memory only fact/);
    assert.match(result.content, /Use memory_search for more/);
    assert.equal(result.details.query, "memoryonlyneedle");
  } finally {
    store.close();
  }
});

test("runTurnIntake returns no hygiene line (stale detection removed)", () => {
  const dbPath = join(createTempDir("pi-memory-turn-intake-hygiene-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "todo",
      scope: "repo",
      repoPath: "/repo",
      title: "Old todo",
      summary: "This todo has been around for a long time.",
    });

    // staleAfter removed in slice5 — no hygiene line is ever generated via stale detection
    const result = runTurnIntake(store, "", "/repo", "session-abc");
    assert.equal(result, undefined, "Expected no injection when no relevant content and no stale detection");
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

    const result = assertTurnMessage(runTurnIntake(store, "combinedneedle", "/repo", "session-abc"));
    // Should contain handoff content
    assert.match(result.content, /Combined handoff/);
    assert.equal(result.details.latestHandoffId !== undefined, true);
    // staleAfter removed in slice5 — no hygiene line is generated
    assert.doesNotMatch(result.content, /Memory hygiene|stale todo/i);
  } finally {
    store.close();
  }
});
