import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  findNearDuplicateMemories,
  initializeMemoryStore,
  isPlaceholderEmbeddingModel,
} from "../../src/core/index.ts";

function tempStore() {
  const dbPath = join(mkdtempSync(join(tmpdir(), "pi-memory-improve-")), "memory.sqlite");
  return initializeMemoryStore({ dbPath });
}

test("M1: pinning a memory increases its match score", () => {
  const store = tempStore();
  try {
    const memory = store.createMemory({
      kind: "todo",
      scope: "global",
      title: "Pinnable deploy decision",
      summary: "The pinneedle deploy decision is worth surfacing first.",
    });

    const before = store.searchMemories({ query: "pinneedle", scope: ["global"] });
    const beforeScore = before.find((r) => r.id === memory.id)?.matchScore ?? 0;

    store.updateMemory({ id: memory.id, pinned: true });

    const after = store.searchMemories({ query: "pinneedle", scope: ["global"] });
    const afterScore = after.find((r) => r.id === memory.id)?.matchScore ?? 0;

    assert.ok(afterScore > beforeScore, `expected pinned score ${afterScore} > ${beforeScore}`);
  } finally {
    store.close();
  }
});

test("M2: relaxed FTS query matches morphological variants via prefix", () => {
  const store = tempStore();
  try {
    store.createMemory({
      kind: "todo",
      scope: "global",
      title: "Deployment pipeline notes",
      summary: "How the deployment pipeline runs migrations on release.",
    });

    assert.equal(store.searchMemories({ query: "deploy", scope: ["global"] }).length, 1);
    assert.equal(store.searchMemories({ query: "migration", scope: ["global"] }).length, 1);
  } finally {
    store.close();
  }
});

test("M3: preferRepoPath anchors ranking to the current repo without filtering", () => {
  const store = tempStore();
  try {
    const here = store.createMemory({
      kind: "todo",
      scope: "repo",
      repoPath: "/repo/here",
      title: "Anchorneedle in current repo",
      summary: "Anchorneedle decision recorded for the current repository.",
    });
    const elsewhere = store.createMemory({
      kind: "todo",
      scope: "repo",
      repoPath: "/repo/elsewhere",
      title: "Anchorneedle in another repo",
      summary: "Anchorneedle decision recorded for a different repository entirely.",
    });

    const results = store.searchMemories({ query: "anchorneedle", scope: ["repo"], preferRepoPath: "/repo/here" });
    const ids = results.map((r) => r.id);

    // Both repos are returned (no filtering), but the current repo ranks first.
    assert.ok(ids.includes(here.id) && ids.includes(elsewhere.id));
    assert.equal(ids[0], here.id);
  } finally {
    store.close();
  }
});

test("H4: findNearDuplicateMemories flags paraphrased duplicates", () => {
  const memories = [
    { id: "a", title: "Use port 8080 for the dev server", summary: "The local dev server listens on port 8080 by default." },
    { id: "b", title: "Deploy from main branch only", summary: "Releases are cut from the main branch after CI passes." },
  ];

  const near = findNearDuplicateMemories(
    { title: "Use port 8080 for the dev server", summary: "The local dev server listens on port 8080 by default." },
    memories,
  );
  assert.deepEqual(near.map((m) => m.id), ["a"]);

  const none = findNearDuplicateMemories(
    { title: "Rotate API credentials quarterly", summary: "Credentials must be rotated every quarter for compliance." },
    memories,
  );
  assert.deepEqual(none, []);
});

test("L5: note kind filter selects only kind=null memories", () => {
  const store = tempStore();
  try {
    store.createMemory({ scope: "global", title: "Plain auth note", summary: "Auth tokens rotate every 24 hours in the system." });
    store.createMemory({ kind: "todo", scope: "global", title: "Auth rotation todo", summary: "Implement token rotation for the auth subsystem." });

    const listed = store.listForTool({ kind: ["note"] as never, status: "active" });
    assert.deepEqual(listed.items.map((m) => m.kind ?? "note"), ["note"]);

    const searched = store.searchMemories({ query: "auth", kind: ["note"] as never, scope: ["global"] });
    assert.deepEqual(searched.map((m) => m.kind ?? "note"), ["note"]);
  } finally {
    store.close();
  }
});

test("H1: deterministic-hash embedding is treated as a semantic-inactive placeholder", () => {
  assert.equal(isPlaceholderEmbeddingModel("builtin-hash-384-v1"), true);
  assert.equal(isPlaceholderEmbeddingModel("builtin-hash-64-v1"), true);
  assert.equal(isPlaceholderEmbeddingModel("local-bge-m3-command"), false);

  const store = tempStore();
  try {
    store.createMemory({ kind: "todo", scope: "global", title: "Semantic skip fixture", summary: "The semanticneedle fixture verifies the placeholder embedding path." });
    const [result] = store.searchMemories({ query: "semanticneedle", scope: ["global"] });
    // With the placeholder model, the semantic channel contributes nothing.
    assert.equal(result?.semanticScore, 0);
  } finally {
    store.close();
  }
});

test("M4: getMemory records a last-accessed timestamp", () => {
  const store = tempStore();
  try {
    const memory = store.createMemory({ kind: "todo", scope: "global", title: "Access tracked", summary: "Reading this memory should stamp last_accessed_at." });
    assert.equal(store.getMemory(memory.id)?.lastAccessedAt, undefined); // pre-touch snapshot
    const second = store.getMemory(memory.id); // now reflects the earlier touch
    assert.ok(second?.lastAccessedAt, "expected last_accessed_at to be set after a prior read");
  } finally {
    store.close();
  }
});
