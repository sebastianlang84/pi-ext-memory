import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { createMemoryCore, type MemoryStore } from "../core/index.ts";
import { resolveMemoryDbPath } from "./config.ts";
import {
  buildTurnMemoryMessage,
  deriveMemoryTurnContext,
  findLatestHandoffForTurn,
  retrieveMemoriesForTurn,
} from "./retrieval.ts";
import { registerMemoryCommands } from "./commands.ts";
import { buildHygieneLine, registerMemoryTools, runMemoryAudit } from "./tools.ts";

export default function registerPiMemoryExtension(pi: ExtensionAPI) {
  const core = createMemoryCore();
  let store: MemoryStore | undefined;

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus("pi-memory", "memory ✓");
  });

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const activeStore = getStoreForCwd(core, store, ctx.cwd);
      store = activeStore;

      const turnContext = deriveMemoryTurnContext(ctx.cwd, ctx.sessionManager.getSessionId());
      const latestHandoff = findLatestHandoffForTurn(activeStore, turnContext);
      const { results, searchPlan } = retrieveMemoriesForTurn(activeStore, event.prompt, turnContext);
      const baseMessage = buildTurnMemoryMessage(event.prompt, results, turnContext, activeStore.dbPath, searchPlan, latestHandoff);

      const { staleTodos, oldHandoffs } = runMemoryAudit(activeStore);
      const hygieneLine = buildHygieneLine(staleTodos.length, oldHandoffs.length);

      let message: string | undefined;
      if (baseMessage && hygieneLine) {
        message = `${baseMessage}\n${hygieneLine}`;
      } else if (baseMessage) {
        message = baseMessage;
      } else if (hygieneLine) {
        message = hygieneLine;
      }

      if (!message) {
        return;
      }

      return { message };
    } catch (error) {
      if (ctx.hasUI) ctx.ui.setStatus("pi-memory", "memory ✗");
      throw error;
    }
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    store?.close();
    store = undefined;
  });

  registerMemoryTools(pi, (cwd) => {
    const activeStore = getStoreForCwd(core, store, cwd);
    store = activeStore;
    return activeStore;
  });

  registerMemoryCommands(pi, core);
}

function getStoreForCwd(
  core: ReturnType<typeof createMemoryCore>,
  currentStore: MemoryStore | undefined,
  _cwd: string,
): MemoryStore {
  const dbPath = resolveMemoryDbPath();

  if (currentStore?.dbPath === dbPath) {
    return currentStore;
  }

  currentStore?.close();
  return core.initializeStore({ dbPath });
}

