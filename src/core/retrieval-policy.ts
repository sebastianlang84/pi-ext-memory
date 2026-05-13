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
  };
  readonly baseScopeScores: Record<MemoryRecord["scope"], number>;
}

export const DEFAULT_HYBRID_RETRIEVAL_POLICY: HybridRetrievalPolicy = {
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
  },
  baseScopeScores: {
    global: 0.55,
    project: 0.8,
    repo: 0.72,
    session: 0.48,
  },
} as const;
