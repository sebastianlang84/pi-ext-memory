import type { MemoryKind, MemoryScope } from "./memories.ts";

export const MEMORY_POLICY = {
  repo: {
    todo: { activeWarnAt: 30, activeHardMax: 50, defaultStaleAfterDays: 30 },
    handoff: { activeWarnAt: 7, activeHardMax: 10, defaultTtlDays: 14 },
  },
  project: {
    todo: { activeWarnAt: 30, activeHardMax: 50, defaultStaleAfterDays: 30 },
    handoff: { activeWarnAt: 7, activeHardMax: 10, defaultTtlDays: 14 },
  },
  global: {
    todo: { activeWarnAt: 10, activeHardMax: 20, defaultStaleAfterDays: 30 },
    handoff: { activeWarnAt: 3, activeHardMax: 5, defaultTtlDays: 14 },
  },
} as const;

export interface CapPolicy {
  activeWarnAt: number;
  activeHardMax: number;
}

/**
 * Returns the cap policy for the given kind/scope combination, or null if no cap applies.
 * Caps only apply to "todo" and "handoff" kinds.
 * The "session" scope falls back to "repo" caps.
 */
export function getCapForKindScope(kind: MemoryKind, scope: MemoryScope): CapPolicy | null {
  const effectiveScope = scope === "session" ? "repo" : scope;
  const scopePolicy = MEMORY_POLICY[effectiveScope as keyof typeof MEMORY_POLICY];
  if (!scopePolicy) return null;

  if (kind === "todo") {
    return { activeWarnAt: scopePolicy.todo.activeWarnAt, activeHardMax: scopePolicy.todo.activeHardMax };
  }

  if (kind === "handoff") {
    return { activeWarnAt: scopePolicy.handoff.activeWarnAt, activeHardMax: scopePolicy.handoff.activeHardMax };
  }

  return null;
}

/**
 * Returns an ISO-8601 timestamp for now + defaultStaleAfterDays (30d for todos).
 */
export function computeDefaultStaleAfter(scope: MemoryScope): string {
  const effectiveScope = scope === "session" ? "repo" : scope;
  const scopePolicy = MEMORY_POLICY[effectiveScope as keyof typeof MEMORY_POLICY];
  const days = (scopePolicy?.todo.defaultStaleAfterDays) ?? 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Returns an ISO-8601 timestamp for now + defaultTtlDays (14d for handoffs).
 */
export function computeDefaultExpiresAt(scope: MemoryScope): string {
  const effectiveScope = scope === "session" ? "repo" : scope;
  const scopePolicy = MEMORY_POLICY[effectiveScope as keyof typeof MEMORY_POLICY];
  const days = (scopePolicy?.handoff.defaultTtlDays) ?? 14;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
