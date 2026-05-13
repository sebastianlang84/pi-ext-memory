import type { MemoryStore } from "../core/index.ts";
import {
  MEMORY_CONTEXT_CUSTOM_TYPE,
  buildTurnMemoryMessage,
  deriveMemoryTurnContext,
  findLatestHandoffForTurn,
  retrieveMemoriesForTurn,
  type TurnMemoryMessage,
} from "./retrieval.ts";
import { buildHygieneLine, runMemoryAudit } from "./audit.ts";

/**
 * Orchestrates all turn-message logic: context derivation, memory retrieval,
 * handoff lookup, hygiene check, and message assembly.
 *
 * Returns the assembled custom memory message, or undefined when there is
 * nothing meaningful to inject.
 */
export function runTurnIntake(
  store: MemoryStore,
  prompt: string,
  cwd: string,
  sessionId: string,
): TurnMemoryMessage | undefined {
  const turnContext = deriveMemoryTurnContext(cwd, sessionId);
  const latestHandoff = findLatestHandoffForTurn(store, turnContext);
  const { results, searchPlan } = retrieveMemoriesForTurn(store, prompt, turnContext);
  const baseMessage = buildTurnMemoryMessage(prompt, results, turnContext, store.dbPath, searchPlan, latestHandoff);

  const { staleTodos, oldHandoffs } = runMemoryAudit(store);
  const hygieneLine = buildHygieneLine(staleTodos.length, oldHandoffs.length);

  if (baseMessage && hygieneLine) {
    return {
      ...baseMessage,
      content: `${baseMessage.content}\n${hygieneLine}`,
    };
  } else if (baseMessage) {
    return baseMessage;
  } else if (hygieneLine) {
    return {
      customType: MEMORY_CONTEXT_CUSTOM_TYPE,
      content: hygieneLine,
      display: false,
      details: {
        dbPath: store.dbPath,
        query: prompt.trim(),
        sessionId: turnContext.sessionId,
        projectId: turnContext.projectId,
        projectPath: turnContext.projectPath,
        repoPath: turnContext.repoPath,
        resultIds: [],
        searchPlan,
      },
    };
  }

  return undefined;
}
