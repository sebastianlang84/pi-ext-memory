type EnvSource = Record<string, string | undefined>;

interface NumberBounds {
  min?: number;
  max?: number;
}

/** Reads a finite number from an env var, clamped to bounds; falls back on absent/invalid. */
export function readNumberEnv(env: EnvSource, key: string, fallback: number, bounds: NumberBounds = {}): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;

  const min = bounds.min ?? Number.NEGATIVE_INFINITY;
  const max = bounds.max ?? Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(min, value));
}

/** Reads a positive integer from an env var; falls back on absent/invalid. */
export function readIntEnv(env: EnvSource, key: string, fallback: number, bounds: NumberBounds = {}): number {
  const value = readNumberEnv(env, key, fallback, bounds);
  return Math.round(value);
}
