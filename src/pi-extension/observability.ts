import type { MemoryStore } from "../core/index.ts";

type MetaStore = Pick<MemoryStore, "getMeta" | "setMeta">;

/** Meta keys for retrieval observability counters. */
export const OBSERVABILITY_KEYS = {
  searchCalls: "obs.searchCalls",
  searchZeroHits: "obs.searchZeroHits",
  turnInjections: "obs.turnInjections",
  turnNoHits: "obs.turnNoHits",
} as const;

export function bumpMetaCounter(store: MetaStore, key: string, by = 1): void {
  try {
    const parsed = Number.parseInt(store.getMeta(key) ?? "0", 10);
    const current = Number.isFinite(parsed) ? parsed : 0;
    store.setMeta(key, String(current + by));
  } catch {
    // Observability is best-effort and must never break a search or turn.
  }
}

export function readMetaCounter(store: MetaStore, key: string): number {
  try {
    const parsed = Number.parseInt(store.getMeta(key) ?? "0", 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

/** Record one explicit memory_search call and whether it returned nothing. */
export function recordSearch(store: MetaStore, resultCount: number): void {
  bumpMetaCounter(store, OBSERVABILITY_KEYS.searchCalls);
  if (resultCount === 0) bumpMetaCounter(store, OBSERVABILITY_KEYS.searchZeroHits);
}

/** Record one turn-start injection and whether the memory search was a no-hit. */
export function recordTurnInjection(store: MetaStore, resultCount: number): void {
  bumpMetaCounter(store, OBSERVABILITY_KEYS.turnInjections);
  if (resultCount === 0) bumpMetaCounter(store, OBSERVABILITY_KEYS.turnNoHits);
}

export function formatObservabilityLines(store: MetaStore): string[] {
  const searches = readMetaCounter(store, OBSERVABILITY_KEYS.searchCalls);
  const zeroHits = readMetaCounter(store, OBSERVABILITY_KEYS.searchZeroHits);
  const turnInjections = readMetaCounter(store, OBSERVABILITY_KEYS.turnInjections);
  const turnNoHits = readMetaCounter(store, OBSERVABILITY_KEYS.turnNoHits);
  const zeroRate = searches > 0 ? Math.round((zeroHits / searches) * 100) : 0;

  return [
    "retrieval_observability:",
    `  memory_search calls: ${searches} (zero-hit: ${zeroHits}, ${zeroRate}%)`,
    `  turn injections: ${turnInjections} (no-hit turns: ${turnNoHits})`,
  ];
}
