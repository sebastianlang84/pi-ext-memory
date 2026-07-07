#!/usr/bin/env node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { initializeMemoryStore, type MemoryStore, type SearchMemoriesInput } from "../src/core/index.ts";

/**
 * Deterministic retrieval-quality eval. Seeds a labeled fixture store and scores
 * ranking against expected-relevant ids — no model or network required. It
 * exercises the retrieval improvements (prefix matching, current-repo anchor,
 * pinned boost, scope ranking) and gives the retrieval-quality evidence gate a
 * reproducible baseline. Metrics: precision@1, recall@3, MRR.
 */

const REPO_ONE = "/repo/one";
const REPO_TWO = "/repo/two";

export interface RetrievalEvalCase {
  id: string;
  description: string;
  input: SearchMemoriesInput;
  relevantKeys: string[];
  /** Optional: the single key that must rank first (e.g. current-repo anchor). */
  expectedTopKey?: string;
}

interface SeededStore {
  store: MemoryStore;
  keyToId: Map<string, string>;
}

function seedFixtureStore(): SeededStore {
  const dbPath = join(mkdtempSync(join(tmpdir(), "pi-memory-retrieval-eval-")), "memory.sqlite");
  const store = initializeMemoryStore({ dbPath });
  const keyToId = new Map<string, string>();

  const seed = (key: string, input: Parameters<MemoryStore["createMemory"]>[0], pinned = false): void => {
    const memory = store.createMemory(input);
    if (pinned) store.updateMemory({ id: memory.id, pinned: true });
    keyToId.set(key, memory.id);
  };

  seed("g-deploy", { kind: "todo", scope: "global", title: "Deployment pipeline", summary: "The deployment pipeline runs migrations on each release." });
  seed("g-migration", { kind: "todo", scope: "global", title: "Database migrations guide", summary: "Run database migrations before deploying a new version." });
  seed("g-auth", { scope: "global", title: "Auth token rotation", summary: "Auth tokens rotate every 24 hours across all services." });
  seed("g-deploy-main", { scope: "global", title: "Always deploy from main", summary: "Release policy: only deploy from the main branch after CI." }, true);
  seed("g-unrelated", { scope: "global", title: "Coffee machine notes", summary: "The office coffee machine needs descaling monthly." });
  seed("r1-cache", { kind: "todo", scope: "repo", repoPath: REPO_ONE, title: "Cache rollout plan", summary: "Cache rollout uses a staged feature flag per environment." });
  seed("r2-cache", { kind: "todo", scope: "repo", repoPath: REPO_TWO, title: "Cache rollout plan", summary: "Cache rollout in the other service relies on Redis TTL windows." });

  return { store, keyToId };
}

export const RETRIEVAL_EVAL_CASES: RetrievalEvalCase[] = [
  {
    id: "prefix-deploy",
    description: "'deploy' should match 'deployment' and deploy-related memories (prefix matching).",
    input: { query: "deploy", scope: ["global"], limit: 5 },
    relevantKeys: ["g-deploy", "g-deploy-main", "g-migration"],
  },
  {
    id: "prefix-migration",
    description: "'migration' should match 'migrations' (prefix matching).",
    input: { query: "migration", scope: ["global"], limit: 5 },
    relevantKeys: ["g-migration", "g-deploy"],
  },
  {
    id: "pinned-first",
    description: "A pinned release-policy memory should top a deploy-from-main query.",
    input: { query: "deploy from main branch", scope: ["global"], limit: 5 },
    relevantKeys: ["g-deploy-main"],
    expectedTopKey: "g-deploy-main",
  },
  {
    id: "auth-lexical",
    description: "'auth token' should retrieve the auth rotation note.",
    input: { query: "auth token", scope: ["global"], limit: 5 },
    relevantKeys: ["g-auth"],
    expectedTopKey: "g-auth",
  },
  {
    id: "repo-anchor",
    description: "Cross-repo query prefers the current repo without filtering it out.",
    input: { query: "cache rollout", scope: ["repo"], preferRepoPath: REPO_ONE, limit: 5 },
    relevantKeys: ["r1-cache", "r2-cache"],
    expectedTopKey: "r1-cache",
  },
];

export interface RetrievalQualityMetrics {
  cases: number;
  precisionAt1: number;
  recallAt3: number;
  mrr: number;
  anchorAccuracy: number;
  perCase: Array<{ id: string; topHit: boolean; firstRelevantRank: number | null; recallAt3: number; anchorOk: boolean | null }>;
}

export function computeRetrievalQuality(cases: RetrievalEvalCase[] = RETRIEVAL_EVAL_CASES): RetrievalQualityMetrics {
  const { store, keyToId } = seedFixtureStore();
  try {
    const perCase: RetrievalQualityMetrics["perCase"] = [];
    let p1 = 0;
    let recallSum = 0;
    let mrrSum = 0;
    let anchorCases = 0;
    let anchorHits = 0;

    for (const testCase of cases) {
      const relevantIds = new Set(testCase.relevantKeys.map((key) => keyToId.get(key)));
      const results = store.searchMemories(testCase.input);
      const ids = results.map((result) => result.id);

      const topHit = ids.length > 0 && relevantIds.has(ids[0]);
      if (topHit) p1 += 1;

      const top3 = ids.slice(0, 3);
      const foundInTop3 = top3.filter((id) => relevantIds.has(id)).length;
      const denom = Math.min(3, relevantIds.size) || 1;
      const recallAt3 = foundInTop3 / denom;
      recallSum += recallAt3;

      const firstRelevantIndex = ids.findIndex((id) => relevantIds.has(id));
      const firstRelevantRank = firstRelevantIndex === -1 ? null : firstRelevantIndex + 1;
      mrrSum += firstRelevantRank ? 1 / firstRelevantRank : 0;

      let anchorOk: boolean | null = null;
      if (testCase.expectedTopKey) {
        anchorCases += 1;
        anchorOk = ids[0] === keyToId.get(testCase.expectedTopKey);
        if (anchorOk) anchorHits += 1;
      }

      perCase.push({ id: testCase.id, topHit, firstRelevantRank, recallAt3, anchorOk });
    }

    const n = cases.length || 1;
    return {
      cases: cases.length,
      precisionAt1: p1 / n,
      recallAt3: recallSum / n,
      mrr: mrrSum / n,
      anchorAccuracy: anchorCases > 0 ? anchorHits / anchorCases : 1,
      perCase,
    };
  } finally {
    store.close();
  }
}

export function formatRetrievalQuality(metrics: RetrievalQualityMetrics): string {
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  return [
    "pi-memory retrieval-quality eval (deterministic; lexical + scope + pinned)",
    `Cases: ${metrics.cases}`,
    `precision@1: ${pct(metrics.precisionAt1)}`,
    `recall@3: ${pct(metrics.recallAt3)}`,
    `MRR: ${metrics.mrr.toFixed(3)}`,
    `anchor accuracy: ${pct(metrics.anchorAccuracy)}`,
    "",
    ...metrics.perCase.map(
      (c) => `- ${c.id}: top1=${c.topHit ? "hit" : "miss"} firstRank=${c.firstRelevantRank ?? "none"} recall@3=${pct(c.recallAt3)}${c.anchorOk === null ? "" : ` anchor=${c.anchorOk ? "ok" : "wrong"}`}`,
    ),
  ].join("\n");
}

async function main(): Promise<void> {
  const metrics = computeRetrievalQuality();
  console.log(formatRetrievalQuality(metrics));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
