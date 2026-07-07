import { readNumberEnv } from "./env-config.ts";
import type { MemoryRecord } from "./memories.ts";

export interface HybridRetrievalPolicy {
  readonly candidateMultiplier: number;
  readonly minCandidates: number;
  readonly minVectorSimilarity: number;
  readonly weights: {
    readonly lexical: number;
    readonly semantic: number;
    readonly scope: number;
    readonly recency: number;
    readonly importance: number;
    readonly confidence: number;
    readonly pinned: number;
  };
  readonly baseScopeScores: Record<MemoryRecord["scope"], number>;
}

const BASE_HYBRID_RETRIEVAL_POLICY: HybridRetrievalPolicy = {
  candidateMultiplier: 5,
  minCandidates: 10,
  minVectorSimilarity: 0.15,
  weights: {
    lexical: 0.35,
    semantic: 0.35,
    scope: 0.1,
    recency: 0.08,
    importance: 0.07,
    confidence: 0.05,
    pinned: 0.15,
  },
  baseScopeScores: {
    global: 0.55,
    project: 0.8,
    repo: 0.72,
    session: 0.48,
  },
} as const;

/**
 * Resolves the hybrid retrieval policy, applying env overrides for the knobs
 * most worth tuning without a fork: the vector-similarity floor and the
 * lexical/semantic weights. Absent/invalid env values fall back to defaults.
 */
export function resolveHybridRetrievalPolicy(env: Record<string, string | undefined> = process.env): HybridRetrievalPolicy {
  return {
    ...BASE_HYBRID_RETRIEVAL_POLICY,
    minVectorSimilarity: readNumberEnv(env, "PI_MEMORY_MIN_VECTOR_SIMILARITY", BASE_HYBRID_RETRIEVAL_POLICY.minVectorSimilarity, { min: 0, max: 1 }),
    weights: {
      ...BASE_HYBRID_RETRIEVAL_POLICY.weights,
      lexical: readNumberEnv(env, "PI_MEMORY_WEIGHT_LEXICAL", BASE_HYBRID_RETRIEVAL_POLICY.weights.lexical, { min: 0, max: 1 }),
      semantic: readNumberEnv(env, "PI_MEMORY_WEIGHT_SEMANTIC", BASE_HYBRID_RETRIEVAL_POLICY.weights.semantic, { min: 0, max: 1 }),
    },
  };
}

export const DEFAULT_HYBRID_RETRIEVAL_POLICY: HybridRetrievalPolicy = resolveHybridRetrievalPolicy();
