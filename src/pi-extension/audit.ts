import { getCapForKindScope, type MemoryRecord, type MemoryScope, type MemoryStore } from "../core/index.ts";

// ─── Memory Audit ────────────────────────────────────────────────────────────

export interface AuditCandidate {
  id: string;
  title: string;
  kind: string;
  tags: string[];
  updatedAt: string;
  scope: string;
  reason: string;
  suggestedAction: string;
}

export interface AuditSummary {
  staleTodos: AuditCandidate[];
  oldHandoffs: AuditCandidate[];
  identityViolations: AuditCandidate[];
  activeTodosCount: number;
  activeHandoffsCount: number;
  staleTodosCount: number;
  expiredHandoffsCount: number;
  identityViolationsCount: number;
  warnings: string[];
  suggestedActions: string[];
}

export function runMemoryAudit(
  store: MemoryStore,
  scopeFilter?: string[],
  repoPathFilter?: string,
): { staleTodos: AuditCandidate[]; oldHandoffs: AuditCandidate[]; identityViolations: AuditCandidate[] } {
  const summary = runMemoryAuditFull(store, scopeFilter, repoPathFilter);
  return {
    staleTodos: summary.staleTodos,
    oldHandoffs: summary.oldHandoffs,
    identityViolations: summary.identityViolations,
  };
}

export function runMemoryAuditFull(
  store: MemoryStore,
  scopeFilter?: string[],
  repoPathFilter?: string,
): AuditSummary {
  const now = new Date();

  const internalFilter = {
    status: "active" as const,
    ...(scopeFilter ? { scope: scopeFilter as MemoryScope[] } : {}),
    ...(repoPathFilter ? { repoPath: repoPathFilter } : {}),
  };

  const memories = store.listAllInternal(internalFilter);
  const todos = store.listAllInternal({ ...internalFilter, kind: ["todo"] });
  const handoffs = store.listAllInternal({ ...internalFilter, kind: ["handoff"] });

  const identityViolations = memories.flatMap((m) => buildIdentityViolationCandidate(m));

  const staleTodos: AuditCandidate[] = todos
    .filter((m) => isTodoStale(m, now))
    .map((m) => ({
      id: m.id,
      title: m.title,
      kind: m.kind,
      tags: m.tags,
      updatedAt: m.updatedAt,
      scope: m.scope,
      reason: `Todo stale: stale_after=${m.staleAfter ?? "not set"} passed`,
      suggestedAction: "Archive if done, or update status/tags to reflect current state",
    }));

  const expiredHandoffs = handoffs.filter((m) => isHandoffExpired(m, now));
  const oldHandoffs: AuditCandidate[] = expiredHandoffs.map((m) => ({
    id: m.id,
    title: m.title,
    kind: m.kind,
    tags: m.tags,
    updatedAt: m.updatedAt,
    scope: m.scope,
    reason: `Handoff expired: expires_at=${m.expiresAt ?? "not set"} passed`,
    suggestedAction: "Archive if the task is complete or no longer relevant",
  }));

  const warnings: string[] = [];
  const suggestedActions: string[] = [];

  // Cap warnings per scope
  const scopesToCheck = scopeFilter ?? ["repo", "project", "global"];
  for (const scope of scopesToCheck as MemoryScope[]) {
    const todoCapPolicy = getCapForKindScope("todo", scope);
    if (todoCapPolicy) {
      const scopeTodos = todos.filter((m) => m.scope === scope);
      if (scopeTodos.length >= todoCapPolicy.activeWarnAt) {
        warnings.push(`Active todo count above warning threshold (scope=${scope}): ${scopeTodos.length} active, warn at ${todoCapPolicy.activeWarnAt}, hard cap ${todoCapPolicy.activeHardMax}`);
      }
    }
    const handoffCapPolicy = getCapForKindScope("handoff", scope);
    if (handoffCapPolicy) {
      const scopeHandoffs = handoffs.filter((m) => m.scope === scope);
      if (scopeHandoffs.length >= handoffCapPolicy.activeWarnAt) {
        warnings.push(`Active handoff count above warning threshold (scope=${scope}): ${scopeHandoffs.length} active, warn at ${handoffCapPolicy.activeWarnAt}, hard cap ${handoffCapPolicy.activeHardMax}`);
      }
    }
  }

  if (expiredHandoffs.length > 0) {
    warnings.push(`${expiredHandoffs.length} handoff${expiredHandoffs.length !== 1 ? "s" : ""} expired`);
    suggestedActions.push("Archive expired handoffs");
  }

  if (staleTodos.length > 0) {
    suggestedActions.push("Review stale todos");
  }

  if (identityViolations.length > 0) {
    warnings.push(`${identityViolations.length} active memor${identityViolations.length !== 1 ? "ies have" : "y has"} scope identity issues`);
    suggestedActions.push("Review identity violations before any migration");
  }

  return {
    staleTodos,
    oldHandoffs,
    identityViolations,
    activeTodosCount: todos.length,
    activeHandoffsCount: handoffs.length,
    staleTodosCount: staleTodos.length,
    expiredHandoffsCount: expiredHandoffs.length,
    identityViolationsCount: identityViolations.length,
    warnings,
    suggestedActions,
  };
}

function buildIdentityViolationCandidate(m: MemoryRecord): AuditCandidate[] {
  const issues: string[] = [];

  if (m.scope === "global" && (m.sessionId || m.projectId || m.repoPath)) {
    issues.push("scope=global should not have sessionId, projectId, or repoPath");
  }

  if (m.scope === "repo") {
    if (!m.repoPath) issues.push("scope=repo is missing primary identity repoPath");
    if (m.sessionId) issues.push("scope=repo should not carry sessionId; use scope=session for session identity");
  }

  if (m.scope === "project") {
    if (!m.projectId) issues.push("scope=project is missing primary identity projectId");
    if (m.sessionId) issues.push("scope=project should not carry sessionId; use scope=session for session identity");
  }

  if (m.scope === "session" && !m.sessionId) {
    issues.push("scope=session is missing primary identity sessionId");
  }

  if (issues.length === 0) return [];

  return [{
    id: m.id,
    title: m.title,
    kind: m.kind,
    tags: m.tags,
    updatedAt: m.updatedAt,
    scope: m.scope,
    reason: issues.join("; "),
    suggestedAction: "Review scope and primary identity; migrate only after confirming the intended scope",
  }];
}

function isTodoStale(m: MemoryRecord, now: Date): boolean {
  if (!m.staleAfter) return false;
  return new Date(m.staleAfter) < now;
}

function isHandoffExpired(m: MemoryRecord, now: Date): boolean {
  if (!m.expiresAt) return false;
  return new Date(m.expiresAt) < now;
}

export function buildHygieneLine(staleTodoCount: number, oldHandoffCount: number): string | null {
  if (staleTodoCount === 0 && oldHandoffCount === 0) return null;
  return `⚠ Memory hygiene: ${staleTodoCount} stale todo${staleTodoCount !== 1 ? "s" : ""}, ${oldHandoffCount} old handoff${oldHandoffCount !== 1 ? "s" : ""}. Run memory_audit for details.`;
}

export function formatAuditResults(
  staleTodos: AuditCandidate[],
  oldHandoffs: AuditCandidate[],
  dbPath: string,
  identityViolations: AuditCandidate[] = [],
): string {
  const lines: string[] = [];
  const total = staleTodos.length + oldHandoffs.length + identityViolations.length;

  if (total === 0) {
    lines.push("Memory audit: no items need attention.", `db_path: ${dbPath}`);
    return lines.join("\n");
  }

  lines.push(`Memory audit: ${total} item${total !== 1 ? "s" : ""} need attention.`);

  if (staleTodos.length > 0) {
    lines.push("", `Stale todos (${staleTodos.length}):`);
    staleTodos.forEach((c, i) => {
      lines.push(
        `  ${i + 1}. [${c.scope}] ${c.title} (${c.id})`,
        `     tags: ${c.tags.join(", ") || "none"}`,
        `     updated_at: ${c.updatedAt}`,
        `     reason: ${c.reason}`,
        `     action: ${c.suggestedAction}`,
      );
    });
  }

  if (oldHandoffs.length > 0) {
    lines.push("", `Old handoffs (${oldHandoffs.length}):`);
    oldHandoffs.forEach((c, i) => {
      lines.push(
        `  ${i + 1}. [${c.scope}] ${c.title} (${c.id})`,
        `     tags: ${c.tags.join(", ") || "none"}`,
        `     updated_at: ${c.updatedAt}`,
        `     reason: ${c.reason}`,
        `     action: ${c.suggestedAction}`,
      );
    });
  }

  if (identityViolations.length > 0) {
    lines.push("", `Identity violations (${identityViolations.length}):`);
    identityViolations.forEach((c, i) => {
      lines.push(
        `  ${i + 1}. [${c.scope}] ${c.title} (${c.id})`,
        `     tags: ${c.tags.join(", ") || "none"}`,
        `     updated_at: ${c.updatedAt}`,
        `     reason: ${c.reason}`,
        `     action: ${c.suggestedAction}`,
      );
    });
  }

  lines.push("", `db_path: ${dbPath}`);
  return lines.join("\n");
}
