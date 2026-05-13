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
      kind: "todo",
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

    const result = runTurnIntake(store, "combinedneedle", "/repo", "session-abc");
    assert.ok(typeof result === "string", "Expected a combined string result");
    // Should contain handoff content
    assert.match(result, /Combined handoff/);
    // staleAfter removed in slice5 — no hygiene line is generated
    assert.doesNotMatch(result, /Memory hygiene|stale todo/i);
  } finally {
    store.close();
  }
});
