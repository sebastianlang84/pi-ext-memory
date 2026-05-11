import { homedir } from "node:os";
import { resolve } from "node:path";

const DEFAULT_DB_FILE = [".pi", "agent", "pi-memory.sqlite"] as const;
const MEMORY_DB_PATH_ENV = "PI_MEMORY_DB_PATH";

export function resolveMemoryDbPath(env: Record<string, string | undefined> = process.env): string {
  const configuredPath = env[MEMORY_DB_PATH_ENV]?.trim();
  return configuredPath ? resolve(configuredPath) : resolve(homedir(), ...DEFAULT_DB_FILE);
}
