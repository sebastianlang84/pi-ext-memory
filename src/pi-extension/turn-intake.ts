import type { MemoryStore } from "../core/index.ts";
import {
  buildTurnMemoryMessage,
  deriveMemoryTurnContext,
  findLatestHandoffForTurn,
  retrieveMemoriesForTurn,
} from "./retrieval.ts";
import { buildHygieneLine, runMemoryAudit } from "./audit.ts";

/**
 * Orchestrates all turn-message logic: context derivation, memory retrieval,
 * handoff lookup, hygiene check, and message assembly.
 *
 * Returns the assembled injection string, or undefined when there is nothing
 * meaningful to inject.
 */
export function runTurnIntake(
  store: MemoryStore,
  prompt: string,
  cwd: string,
  sessionId: string,
): string | undefined {
  const turnContext = deriveMemoryTurnContext(cwd, sessionId);
  const latestHandoff = findLatestHandoffForTurn(store, turnContext);
  const { results, searchPlan } = retrieveMemoriesForTurn(store, prompt, turnContext);
  const baseMessage = buildTurnMemoryMessage(prompt, results, turnContext, store.dbPath, searchPlan, latestHandoff);

  const { staleTodos, oldHandoffs } = runMemoryAudit(store);
  const hygieneLine = buildHygieneLine(staleTodos.length, oldHandoffs.length);

  const content = baseMessage?.content;

  if (content && hygieneLine) {
    return `${content}\n${hygieneLine}`;
  } else if (content) {
    return content;
  } else if (hygieneLine) {
    return hygieneLine;
  }

  return undefined;
}
