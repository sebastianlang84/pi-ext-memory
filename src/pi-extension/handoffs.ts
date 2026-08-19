import { isActiveHandoff, type MemoryRecord, type MemoryStore, type NormalizedListMemoriesInput } from "../core/index.ts";

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

function listActiveUnexpiredHandoffs(
  store: HandoffLookupStore,
  filter: Partial<NormalizedListMemoriesInput>,
  now: Date,
): MemoryRecord[] {
  return store
    .listAllInternal(filter)
    .filter((memory) => isActiveHandoff(memory, now));
}
