import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const DEFAULT_DB_FILE = [".pi", "agent", "state", "pi-memory", "memory.sqlite"] as const;
const LEGACY_DEFAULT_DB_FILE = [".pi", "agent", "pi-memory.sqlite"] as const;
const MEMORY_DB_PATH_ENV = "PI_MEMORY_DB_PATH";

export interface MemoryDbPathMigrationResult {
  dbPath: string;
  legacyDbPath: string;
  migrated: boolean;
  skippedReason?: "configured_path" | "target_exists" | "legacy_missing" | "same_path";
}

export function resolveMemoryDbPath(env: Record<string, string | undefined> = process.env): string {
  const configuredPath = env[MEMORY_DB_PATH_ENV]?.trim();
  return configuredPath ? resolve(configuredPath) : resolveDefaultMemoryDbPath();
}

export function resolveDefaultMemoryDbPath(): string {
  return resolve(homedir(), ...DEFAULT_DB_FILE);
}

export function resolveLegacyDefaultMemoryDbPath(): string {
  return resolve(homedir(), ...LEGACY_DEFAULT_DB_FILE);
}

export function ensureDefaultMemoryDbPath(
  env: Record<string, string | undefined> = process.env,
): MemoryDbPathMigrationResult {
  const dbPath = resolveMemoryDbPath(env);
  const legacyDbPath = resolveLegacyDefaultMemoryDbPath();

  if (env[MEMORY_DB_PATH_ENV]?.trim()) {
    return { dbPath, legacyDbPath, migrated: false, skippedReason: "configured_path" };
  }

  return migrateLegacyMemoryDbPath({ dbPath, legacyDbPath });
}

export function migrateLegacyMemoryDbPath(input: { dbPath?: string; legacyDbPath?: string } = {}): MemoryDbPathMigrationResult {
  const dbPath = resolve(input.dbPath ?? resolveDefaultMemoryDbPath());
  const legacyDbPath = resolve(input.legacyDbPath ?? resolveLegacyDefaultMemoryDbPath());

  if (dbPath === legacyDbPath) {
    return { dbPath, legacyDbPath, migrated: false, skippedReason: "same_path" };
  }
  if (existsSync(dbPath)) {
    return { dbPath, legacyDbPath, migrated: false, skippedReason: "target_exists" };
  }
  if (!existsSync(legacyDbPath)) {
    return { dbPath, legacyDbPath, migrated: false, skippedReason: "legacy_missing" };
  }

  mkdirSync(dirname(dbPath), { recursive: true });
  copyFileSync(legacyDbPath, dbPath);
  copySqliteSidecarIfPresent(legacyDbPath, dbPath, "-wal");
  copySqliteSidecarIfPresent(legacyDbPath, dbPath, "-shm");

  return { dbPath, legacyDbPath, migrated: true };
}

function copySqliteSidecarIfPresent(sourceDbPath: string, targetDbPath: string, suffix: "-wal" | "-shm"): void {
  const sourcePath = `${sourceDbPath}${suffix}`;
  const targetPath = `${targetDbPath}${suffix}`;

  if (existsSync(sourcePath) && !existsSync(targetPath)) {
    copyFileSync(sourcePath, targetPath);
  }
}
