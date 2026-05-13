import type { MemoryCore, MemoryStore } from "../core/index.ts";

import { ensureDefaultMemoryDbPath } from "./config.ts";

export interface MemoryRuntimeStore {
  getStoreForCwd(cwd: string): MemoryStore;
  close(): void;
  readonly activeDbPath: string | undefined;
}

export interface CreateMemoryRuntimeStoreOptions {
  resolveDbPath?(cwd: string): string;
}

export function createMemoryRuntimeStore(
  core: Pick<MemoryCore, "initializeStore">,
  options: CreateMemoryRuntimeStoreOptions = {},
): MemoryRuntimeStore {
  let store: MemoryStore | undefined;
  const resolveDbPath = options.resolveDbPath ?? (() => ensureDefaultMemoryDbPath().dbPath);

  return {
    getStoreForCwd(cwd) {
      const dbPath = resolveDbPath(cwd);

      if (store?.dbPath === dbPath) {
        return store;
      }

      store?.close();
      store = core.initializeStore({ dbPath });
      return store;
    },
    close() {
      store?.close();
      store = undefined;
    },
    get activeDbPath() {
      return store?.dbPath;
    },
  };
}
