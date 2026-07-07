import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { createMemoryCore } from "../core/index.ts";
import { registerMemoryCommands } from "./commands.ts";
import { registerMemoryTools } from "./tools.ts";
import { createMemoryRuntimeStore } from "./runtime-store.ts";
import { runTurnIntake } from "./turn-intake.ts";

export default function registerPiMemoryExtension(pi: ExtensionAPI) {
  const core = createMemoryCore();
  const runtimeStore = createMemoryRuntimeStore(core);

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus("pi-memory", "[Memory ✓]");
  });

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const activeStore = runtimeStore.getStoreForCwd(ctx.cwd);
      const message = runTurnIntake(activeStore, event.prompt, ctx.cwd, ctx.sessionManager.getSessionId());
      if (message) {
        return { message };
      }
    } catch (error) {
      // Memory augmentation is best-effort context: a store/DB hiccup must not
      // abort the user's turn. Surface the failure via the status pill and
      // continue without an injected memory message instead of rethrowing.
      void error;
      if (ctx.hasUI) ctx.ui.setStatus("pi-memory", "[Memory ✗]");
    }
  });

  registerMemoryTools(pi, (cwd) => runtimeStore.getStoreForCwd(cwd));

  registerMemoryCommands(pi, core, runtimeStore);
}

