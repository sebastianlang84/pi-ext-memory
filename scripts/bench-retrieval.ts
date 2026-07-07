/**
 * Retrieval performance tripwire.
 *
 * The per-turn memory paths are O(N) in the number of active memories:
 * `retrieveMemoriesForTurn` loads every matching embedding into JS and computes
 * cosine similarity (no ANN index / no SQL LIMIT, see src/core/search.ts), and
 * runs once per user turn. Measured cost is negligible at realistic local
 * store sizes (a few hundred memories → ~12-20 ms, dwarfed by a single LLM
 * call) and only becomes noticeable in the multi-thousand range.
 *
 * This script exists so that "when does N start to hurt?" stays measurable
 * rather than speculative. If retrieval at a realistic N (say ≤ 2000) ever
 * climbs into the hundreds of milliseconds, that is the signal to invest in a
 * real vector index — e.g. sqlite-vec or storing vectors as Float32 BLOBs
 * instead of JSON text — which is a dependency/packaging decision and should
 * not be taken on speculation.
 *
 * Run: npm run bench:retrieval
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initializeMemoryStore, type MemoryStore } from "../src/core/index.ts";
import { retrieveMemoriesForTurn, type MemoryTurnContext } from "../src/pi-extension/retrieval.ts";
import { countHygieneFindings } from "../src/pi-extension/audit.ts";

const REPO = "/repo/current";
const TURN_CONTEXT: MemoryTurnContext = { cwd: REPO, sessionId: "bench-session", repoPath: REPO };
const QUERIES = [
  "retrieval ranking bug",
  "database migration plan",
  "auth token refresh",
  "deploy rollback steps",
  "embedding cosine score",
];
const STORE_SIZES = [100, 500, 2000, 8000];

function seedStore(store: MemoryStore, count: number): void {
  for (let index = 0; index < count; index += 1) {
    // Spread ~1/3 of memories into the active repo, the rest into other repos,
    // so the repo+global hygiene scan sees a realistic mix.
    const repoPath = index % 3 === 0 ? REPO : `/repo/other-${index % 7}`;
    store.createMemory({
      scope: "repo",
      repoPath,
      title: `Note ${index} about subsystem ${index % 40}`,
      summary: `Decision ${index}: handled ranking/migration/auth/deploy/embedding topic ${index % 50} in detail for later recall.`,
      tags: [`topic-${index % 30}`, `area-${index % 12}`],
    });
  }
}

function measure(label: string, iterations: number, run: () => void): void {
  run(); // warm up
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) run();
  const msPerOp = (performance.now() - start) / iterations;
  console.log(`  ${label.padEnd(36)} ${msPerOp.toFixed(2)} ms/op`);
}

function main(): void {
  for (const size of STORE_SIZES) {
    const tempRoot = mkdtempSync(join(tmpdir(), "pi-memory-bench-"));
    const store = initializeMemoryStore({ dbPath: join(tempRoot, "memory.sqlite") });

    try {
      const seedStart = performance.now();
      seedStore(store, size);
      console.log(`\nN=${size} active memories (seed ${(performance.now() - seedStart).toFixed(0)} ms)`);

      let queryIndex = 0;
      measure("retrieveMemoriesForTurn (4 stages)", 30, () => {
        retrieveMemoriesForTurn(store, QUERIES[queryIndex++ % QUERIES.length]!, TURN_CONTEXT);
      });
      measure("countHygieneFindings (repo+global)", 50, () => {
        countHygieneFindings(store, REPO);
      });
    } finally {
      store.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
