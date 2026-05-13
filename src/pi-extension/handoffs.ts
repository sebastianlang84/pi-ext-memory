import { isActiveUnexpiredHandoff, type ListForToolResult, type MemoryRecord, type MemoryScope, type MemoryStore, type NormalizedListMemoriesInput } from "../core/index.ts";

export type HandoffLookupStore = Pick<MemoryStore, "listAllInternal">;

export interface HandoffTurnContext {
  sessionId: string;
  projectId?: string;
  repoPath?: string;
}

export interface LatestHandoffResult {
  memory: MemoryRecord;
  isFallback: boolean;
}

export interface RelevantHandoffListParams {
  scope: MemoryScope;
  sessionId?: string;
  projectId?: string;
  repoPath?: string;
  limit?: number;
}

export function findLatestExactSessionHandoff(
  store: HandoffLookupStore,
  sessionId: string,
  now: Date = new Date(),
): MemoryRecord | undefined {
  const normalizedSessionId = sessionId.trim();
  if (normalizedSessionId.length === 0) return undefined;

  return listActiveUnexpiredHandoffs(
    store,
    {
      kind: ["handoff"],
      scope: ["session"],
      sessionId: normalizedSessionId,
      status: "active",
      orderBy: "updatedAt",
    },
    now,
  )[0];
}

export function findLatestHandoffForTurn(
  store: HandoffLookupStore,
  context: HandoffTurnContext,
  now: Date = new Date(),
): LatestHandoffResult | undefined {
  const sessionHandoff = findLatestExactSessionHandoff(store, context.sessionId, now);
  if (sessionHandoff) {
    return { memory: sessionHandoff, isFallback: false };
  }

  if (context.repoPath) {
    const repoHandoff = listActiveUnexpiredHandoffs(
      store,
      {
        kind: ["handoff"],
        scope: ["repo", "session"],
        repoPath: context.repoPath,
        status: "active",
        orderBy: "updatedAt",
      },
      now,
    )[0];

    if (repoHandoff) {
      return { memory: repoHandoff, isFallback: true };
    }
  }

  if (context.projectId) {
    const projectHandoff = listActiveUnexpiredHandoffs(
      store,
      {
        kind: ["handoff"],
        scope: ["project", "session"],
        projectId: context.projectId,
        status: "active",
        orderBy: "updatedAt",
      },
      now,
    )[0];

    if (projectHandoff) {
      return { memory: projectHandoff, isFallback: true };
    }
  }

  return undefined;
}

export function listRelevantActiveHandoffsForScope(
  store: HandoffLookupStore,
  params: RelevantHandoffListParams,
  now: Date = new Date(),
): ListForToolResult {
  const limit = params.limit ?? 10;
  const relatedScopes: MemoryScope[] =
    (params.scope === "repo" && params.repoPath) || (params.scope === "project" && params.projectId)
      ? [params.scope, "session"]
      : [params.scope];

  const items = listActiveUnexpiredHandoffs(
    store,
    {
      kind: ["handoff"],
      scope: relatedScopes,
      status: "active",
      sessionId: params.sessionId,
      repoPath: params.repoPath,
      projectId: params.projectId,
      orderBy: "updatedAt",
    },
    now,
  );

  const pagedItems = items.slice(0, limit);
  return {
    items: pagedItems,
    totalCount: items.length,
    hasMore: items.length > limit,
    nextOffset: items.length > limit ? limit : null,
  };
}

function listActiveUnexpiredHandoffs(
  store: HandoffLookupStore,
  filter: Partial<NormalizedListMemoriesInput>,
  now: Date,
): MemoryRecord[] {
  return store
    .listAllInternal(filter)
    .filter((memory) => isActiveUnexpiredHandoff(memory, now));
}
