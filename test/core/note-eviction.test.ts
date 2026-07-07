import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { initializeMemoryStore, REPO_NOTE_ACTIVE_CAP, type MemoryStore } from "../../src/core/index.ts";

function createTempDbPath(): { dbPath: string; tempRoot: string } {
  const tempRoot = mkdtempSync(join(tmpdir(), "pi-memory-evict-"));
  return { dbPath: join(tempRoot, "memory.sqlite"), tempRoot };
}

function activeRepoNoteCount(store: MemoryStore, repoPath: string): number {
  return store
    .listAllInternal({ status: "active", scope: ["repo"], repoPath })
    .filter((memory) => memory.kind === null || memory.kind === undefined).length;
}

test("recordMemoryAccess bumps access_count and last_accessed_at", () => {
  const { dbPath, tempRoot } = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    const memory = store.createMemory({
      scope: "repo",
      repoPath: "/repo/access",
      title: "Access tracking note",
      summary: "A note whose access counter should increase when surfaced.",
    });

    assert.equal(store.getMemory(memory.id)?.accessCount, 0);
    assert.equal(store.getMemory(memory.id)?.lastAccessedAt, undefined);

    store.recordMemoryAccess([memory.id]);
    store.recordMemoryAccess([memory.id, "", memory.id]); // dedupes + ignores blanks

    const refreshed = store.getMemory(memory.id);
    assert.equal(refreshed?.accessCount, 2);
    assert.ok(refreshed?.lastAccessedAt, "last_accessed_at should be set after access");
  } finally {
    store.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("repo notes are capped: the weakest is evicted, pinned and frequently-used survive", () => {
  const { dbPath, tempRoot } = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });
  const repoPath = "/repo/cap";

  try {
    // Oldest note, pinned + never accessed: must never be evicted.
    const pinned = store.createMemory({
      scope: "repo",
      repoPath,
      pinned: true,
      title: "Pinned keeper note",
      summary: "This pinned note must survive eviction regardless of age or access.",
    });

    // Frequently accessed note: high access_count keeps it alive.
    const hot = store.createMemory({
      scope: "repo",
      repoPath,
      title: "Hot frequently used note",
      summary: "This note is retrieved often and should outrank never-used notes.",
    });
    for (let i = 0; i < 5; i += 1) store.recordMemoryAccess([hot.id]);

    // Fill up to exactly the cap with never-accessed filler notes.
    for (let i = 0; i < REPO_NOTE_ACTIVE_CAP - 2; i += 1) {
      store.createMemory({
        scope: "repo",
        repoPath,
        title: `Filler note number ${i}`,
        summary: `Filler summary content ${i} used only to fill the repo note capacity.`,
      });
    }
    assert.equal(activeRepoNoteCount(store, repoPath), REPO_NOTE_ACTIVE_CAP);

    // One more note pushes over the cap and triggers eviction of one weakest note.
    const overflow = store.createMemory({
      scope: "repo",
      repoPath,
      title: "Overflow note triggering eviction",
      summary: "Saving this note should archive exactly one weakest existing note.",
    });

    assert.equal(activeRepoNoteCount(store, repoPath), REPO_NOTE_ACTIVE_CAP, "active notes return to the cap");
    assert.equal(store.getMemory(pinned.id)?.status, "active", "pinned note survives");
    assert.equal(store.getMemory(hot.id)?.status, "active", "frequently-used note survives");
    assert.equal(store.getMemory(overflow.id)?.status, "active", "the newly saved note survives");

    const archived = store.listAllInternal({ status: "archived", scope: ["repo"], repoPath });
    assert.equal(archived.length, 1, "exactly one note is evicted");
    const archiveMeta = archived[0]!.metadata.archive as Record<string, unknown> | undefined;
    assert.equal(archiveMeta?.evicted, true, "evicted note is marked for later purge");
    assert.ok(archiveMeta?.archivedAt, "evicted note records an archivedAt timestamp");
  } finally {
    store.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("expired evicted notes are purged on the next save; manual archives are kept", () => {
  const { dbPath, tempRoot } = createTempDbPath();
  const repoPath = "/repo/purge";
  const oldIso = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();

  let store = initializeMemoryStore({ dbPath });
  const evictedOld = store.createMemory({
    scope: "repo",
    repoPath,
    title: "Old evicted note",
    summary: "This note was evicted long ago and should be purged from disk.",
  });
  const manualOld = store.createMemory({
    scope: "repo",
    repoPath,
    title: "Old manually archived note",
    summary: "This note was archived by a human and must never be auto-purged.",
  });
  store.close();

  // Backdate the two notes directly: one as an old *evicted* archive, one as an
  // old *manual* archive (no evicted marker).
  const raw = new DatabaseSync(dbPath);
  try {
    raw.prepare(
      `UPDATE memories SET status='archived',
         metadata_json = json_set(metadata_json, '$.archive', json_object('archivedAt', ?, 'evicted', json('true')))
       WHERE id = ?;`,
    ).run(oldIso, evictedOld.id);
    raw.prepare(
      `UPDATE memories SET status='archived',
         metadata_json = json_set(metadata_json, '$.archive', json_object('archivedAt', ?, 'archivedReason', 'manual'))
       WHERE id = ?;`,
    ).run(oldIso, manualOld.id);
  } finally {
    raw.close();
  }

  store = initializeMemoryStore({ dbPath });
  try {
    // Any new note in the repo triggers the opportunistic purge.
    store.createMemory({
      scope: "repo",
      repoPath,
      title: "Fresh trigger note",
      summary: "Creating this note triggers the purge of expired evicted notes.",
    });

    assert.equal(store.getMemory(evictedOld.id), null, "expired evicted note is hard-deleted");
    assert.equal(store.getMemoryEmbedding(evictedOld.id), null, "its embedding is cascaded away");
    assert.equal(store.getMemory(manualOld.id)?.status, "archived", "manually archived note is retained");
  } finally {
    store.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
