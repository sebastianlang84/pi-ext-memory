import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { initializeMemoryStore } from "../../src/core/index.ts";

function createTempDbPath(): string {
  const tempRoot = mkdtempSync(join(tmpdir(), "pi-memory-session-summary-"));
  return join(tempRoot, "memory.sqlite");
}

test("saveSessionSummary persists to sessions.summary without creating a memory record", () => {
  const dbPath = createTempDbPath();
  const store = initializeMemoryStore({ dbPath });

  try {
    const session = store.saveSessionSummary({
      sessionId: "session-123",
      summary: "Reviewed retrieval quality, kept writes manual-first, and queued packaging follow-up.",
      projectId: "@acme/api",
      repoPath: "/repo",
    });

    assert.equal(session.id, "session-123");
    assert.equal(session.summary, "Reviewed retrieval quality, kept writes manual-first, and queued packaging follow-up.");
    assert.equal(session.projectId, "@acme/api");
    assert.equal(session.repoPath, "/repo");

    const loaded = store.getSession("session-123");
    assert.deepEqual(loaded, session);
  } finally {
    store.close();
  }

  const db = new DatabaseSync(dbPath);

  try {
    const sessionRow = db.prepare("SELECT summary FROM sessions WHERE id = ?;").get("session-123") as { summary: string } | undefined;
    const memoryCount = db.prepare("SELECT COUNT(*) AS count FROM memories;").get() as { count: number };

    assert.equal(sessionRow?.summary, "Reviewed retrieval quality, kept writes manual-first, and queued packaging follow-up.");
    assert.equal(memoryCount.count, 0);
  } finally {
    db.close();
  }
});
