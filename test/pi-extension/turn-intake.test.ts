import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initializeMemoryStore } from "../../src/core/index.ts";
import { runTurnIntake } from "../../src/pi-extension/turn-intake.ts";

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

    const result = runTurnIntake(store, "handoffonly", "/repo", "session-abc");
    assert.ok(typeof result === "string", "Expected a string result");
    assert.match(result, /Handoff only/);
  } finally {
    store.close();
  }
});

test("runTurnIntake returns memory content when only search results are present", () => {
  const dbPath = join(createTempDir("pi-memory-turn-intake-memory-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "fact",
      scope: "repo",
      repoPath: "/repo",
      title: "Memory only fact",
      summary: "The memoryonlyneedle decision was made in Q1.",
    });

    const result = runTurnIntake(store, "memoryonlyneedle", "/repo", "session-abc");
    assert.ok(typeof result === "string", "Expected a string result");
    assert.match(result, /Memory only fact|Relevant memory context/);
  } finally {
    store.close();
  }
});

test("runTurnIntake returns hygiene line when only stale todos exist", () => {
  const dbPath = join(createTempDir("pi-memory-turn-intake-hygiene-"), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });

  try {
    store.createMemory({
      kind: "todo",
      scope: "repo",
      repoPath: "/repo",
      title: "Old stale todo",
      summary: "This todo has been stale for a long time.",
      staleAfter: "2000-01-01T00:00:00.000Z",
    });

    const result = runTurnIntake(store, "", "/repo", "session-abc");
    assert.ok(typeof result === "string", "Expected a hygiene line string");
    assert.match(result, /Memory hygiene|stale todo/i);
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
      kind: "fact",
      scope: "repo",
      repoPath: "/repo",
      title: "Combined memory fact",
      summary: "The combinedneedle was decided in Q2.",
    });

    store.createMemory({
      kind: "todo",
      scope: "repo",
      repoPath: "/repo",
      title: "Combined stale todo",
      summary: "This todo is stale.",
      staleAfter: "2000-01-01T00:00:00.000Z",
    });

    const result = runTurnIntake(store, "combinedneedle", "/repo", "session-abc");
    assert.ok(typeof result === "string", "Expected a combined string result");
    // Should contain handoff content
    assert.match(result, /Combined handoff/);
    // Should contain hygiene line appended after a newline
    assert.match(result, /Memory hygiene|stale todo/i);
    // Hygiene line should come after the memory content
    const hygieneIdx = result.search(/Memory hygiene|stale todo/i);
    const handoffIdx = result.indexOf("Combined handoff");
    assert.ok(handoffIdx < hygieneIdx, "Handoff content should precede hygiene line");
  } finally {
    store.close();
  }
});
