import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { deriveSearchTerms, initializeMemoryStore, splitIdentifierSubtokens } from "../../src/core/index.ts";

function tempStore() {
  const dbPath = join(mkdtempSync(join(tmpdir(), "pi-memory-search-terms-")), "memory.sqlite");
  return initializeMemoryStore({ dbPath });
}

test("splitIdentifierSubtokens splits camelCase, snake_case, kebab, and acronyms", () => {
  assert.deepEqual(splitIdentifierSubtokens("buildFtsMatchQuery"), ["build", "fts", "match", "query"]);
  assert.deepEqual(splitIdentifierSubtokens("spawn_sync"), ["spawn", "sync"]);
  assert.deepEqual(splitIdentifierSubtokens("read-time-expiry"), ["read", "time", "expiry"]);
  assert.deepEqual(splitIdentifierSubtokens("FTSMatchQuery"), ["fts", "match", "query"]);
});

test("splitIdentifierSubtokens returns [] for plain words and single-char noise", () => {
  assert.deepEqual(splitIdentifierSubtokens("deployment"), []);
  assert.deepEqual(splitIdentifierSubtokens("query"), []);
  // A single meaningful part (>=2 chars) does not count as an identifier split.
  assert.deepEqual(splitIdentifierSubtokens("a_query"), []);
});

test("deriveSearchTerms collects identifier subtokens across content, empty when none", () => {
  const terms = deriveSearchTerms({
    title: "buildFtsMatchQuery helper",
    summary: "Wraps spawn_sync for the adapter.",
    tags: ["read-time-expiry"],
  });
  const set = new Set(terms.split(" "));
  for (const expected of ["build", "fts", "match", "query", "spawn", "sync", "read", "time", "expiry"]) {
    assert.ok(set.has(expected), `expected subtoken "${expected}" in "${terms}"`);
  }

  assert.equal(deriveSearchTerms({ title: "Coffee machine notes", summary: "Descale it monthly.", tags: [] }), "");
});

test("M2: a camelCase identifier is retrievable by its subtokens", () => {
  const store = tempStore();
  try {
    const memory = store.createMemory({
      scope: "global",
      title: "buildFtsMatchQuery helper",
      summary: "Internal helper that assembles the ranking predicate from raw user input.",
    });

    const results = store.searchMemories({ query: "fts match query", scope: ["global"], limit: 5 });
    assert.ok(
      results.some((result) => result.id === memory.id),
      "expected the identifier memory to be reachable by subtoken query",
    );
  } finally {
    store.close();
  }
});

test("M2: backfill repopulates subtokens for legacy rows on reopen", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "pi-memory-backfill-")), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });
  const memory = store.createMemory({
    scope: "global",
    title: "buildFtsMatchQuery helper",
    summary: "Internal helper that assembles the ranking predicate from raw user input.",
  });
  store.close();

  // Simulate a pre-v10 row: clear derived terms (the update trigger reindexes
  // FTS terms to empty) and drop the one-time backfill flag so the next init
  // treats the store as un-backfilled.
  const raw = new DatabaseSync(dbPath);
  raw.exec("UPDATE memories SET search_terms = '';");
  raw.prepare("DELETE FROM meta WHERE key = ?;").run("search_terms_backfilled_v10");
  raw.close();

  const reopened = initializeMemoryStore({ dbPath });
  try {
    const results = reopened.searchMemories({ query: "fts match query", scope: ["global"], limit: 5 });
    assert.ok(
      results.some((result) => result.id === memory.id),
      "expected backfill on reopen to restore subtoken reachability for a legacy row",
    );
  } finally {
    reopened.close();
  }
});

test("M2: updating content refreshes the indexed subtokens", () => {
  const store = tempStore();
  try {
    const memory = store.createMemory({
      scope: "global",
      title: "placeholder title",
      summary: "nothing notable here yet.",
    });

    assert.equal(store.searchMemories({ query: "spawn sync", scope: ["global"], limit: 5 }).length, 0);

    store.updateMemory({ id: memory.id, title: "spawn_sync wrapper", summary: "Wraps the child-process call." });

    const results = store.searchMemories({ query: "spawn sync", scope: ["global"], limit: 5 });
    assert.ok(results.some((result) => result.id === memory.id), "expected refreshed subtokens to be searchable");
  } finally {
    store.close();
  }
});
