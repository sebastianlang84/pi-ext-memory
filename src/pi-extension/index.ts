import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { createMemoryCore } from "../core/index.ts";
import {
  buildTurnMemoryMessage,
  deriveMemoryTurnContext,
  findLatestHandoffForTurn,
  retrieveMemoriesForTurn,
} from "./retrieval.ts";
import { registerMemoryCommands } from "./commands.ts";
import { buildHygieneLine, registerMemoryTools, runMemoryAudit } from "./tools.ts";
import { createMemoryRuntimeStore } from "./runtime-store.ts";

export default function registerPiMemoryExtension(pi: ExtensionAPI) {
  const core = createMemoryCore();
  const runtimeStore = createMemoryRuntimeStore(core);

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus("pi-memory", "Memory ✓");
  });

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const activeStore = runtimeStore.getStoreForCwd(ctx.cwd);

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
      if (ctx.hasUI) ctx.ui.setStatus("pi-memory", "Memory ✗");
      throw error;
    }
  });

  registerMemoryTools(pi, (cwd) => runtimeStore.getStoreForCwd(cwd));

  registerMemoryCommands(pi, core, runtimeStore);
}

