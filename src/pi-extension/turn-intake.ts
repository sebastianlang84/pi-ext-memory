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
import { recordTurnInjection } from "./observability.ts";

// The hygiene audit does several full scans; cache its counts so the common
// turn does not re-scan on every prompt. Findings change slowly (day-scale),
// so a short TTL keeps the advisory line fresh enough without the per-turn cost.
const HYGIENE_CACHE_TTL_MS = 10 * 60 * 1000;

interface HygieneCounts {
  staleTodos: number;
  oldHandoffs: number;
}

function resolveHygieneCounts(store: MemoryStore, nowMs: number): HygieneCounts {
  const computedAt = store.getMeta("hygieneComputedAt");
  if (computedAt) {
    const age = nowMs - Date.parse(computedAt);
    if (Number.isFinite(age) && age >= 0 && age < HYGIENE_CACHE_TTL_MS) {
      const cached = store.getMeta("hygieneCounts");
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as Partial<HygieneCounts>;
          if (typeof parsed.staleTodos === "number" && typeof parsed.oldHandoffs === "number") {
            return { staleTodos: parsed.staleTodos, oldHandoffs: parsed.oldHandoffs };
          }
        } catch {
          // Fall through to a fresh audit.
        }
      }
    }
  }

  const { staleTodos, oldHandoffs } = runMemoryAudit(store);
  const counts: HygieneCounts = { staleTodos: staleTodos.length, oldHandoffs: oldHandoffs.length };
  try {
    store.setMeta("hygieneComputedAt", new Date(nowMs).toISOString());
    store.setMeta("hygieneCounts", JSON.stringify(counts));
  } catch {
    // Caching is best-effort.
  }
  return counts;
}

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
  now: Date = new Date(),
): TurnMemoryMessage | undefined {
  const turnContext = deriveMemoryTurnContext(cwd, sessionId);
  const latestHandoff = findLatestHandoffForTurn(store, turnContext, now);
  const { results, searchPlan } = retrieveMemoriesForTurn(store, prompt, turnContext);

  // Inject the full no-hit guidance only on the first no-hit turn of a session;
  // later no-hit turns get a compact reminder to avoid repeating boilerplate.
  const noHitGuidanceAlreadyShown = store.getMeta("noHitGuidanceSession") === turnContext.sessionId;
  const baseMessage = buildTurnMemoryMessage(prompt, results, turnContext, store.dbPath, searchPlan, latestHandoff, {
    compactNoHitGuidance: noHitGuidanceAlreadyShown,
  });
  if (results.length === 0 && !noHitGuidanceAlreadyShown && turnContext.sessionId.trim().length > 0) {
    try {
      store.setMeta("noHitGuidanceSession", turnContext.sessionId);
    } catch {
      // Best-effort; falling back to full guidance again is harmless.
    }
  }

  if (baseMessage) recordTurnInjection(store, results.length);

  const hygiene = resolveHygieneCounts(store, now.getTime());
  const hygieneLine = buildHygieneLine(hygiene.staleTodos, hygiene.oldHandoffs);

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
