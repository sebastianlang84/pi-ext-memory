import {
  classifyLifecycleAuditFinding,
  getCapForKindScope,
  type MemoryRecord,
  type MemoryScope,
  type MemoryStore,
} from "../core/index.ts";

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

export type ProjectMigrationRecommendation = "repo" | "global" | "legacy-read-only" | "archive" | "needs-human-review";

export interface ProjectMigrationPreviewCandidate extends AuditCandidate {
  recommendation: ProjectMigrationRecommendation;
  projectId?: string;
  repoPath?: string;
  sessionId?: string;
}

export interface AuditSummary {
  staleTodos: AuditCandidate[];
  oldHandoffs: AuditCandidate[];
  identityViolations: AuditCandidate[];
  projectMigrationPreview: ProjectMigrationPreviewCandidate[];
  activeTodosCount: number;
  activeHandoffsCount: number;
  staleTodosCount: number;
  expiredHandoffsCount: number;
  identityViolationsCount: number;
  projectMigrationPreviewCount: number;
  warnings: string[];
  suggestedActions: string[];
}

export function runMemoryAudit(
  store: MemoryStore,
  scopeFilter?: string[],
  repoPathFilter?: string,
): { staleTodos: AuditCandidate[]; oldHandoffs: AuditCandidate[]; identityViolations: AuditCandidate[]; projectMigrationPreview: ProjectMigrationPreviewCandidate[] } {
  const summary = runMemoryAuditFull(store, scopeFilter, repoPathFilter);
  return {
    staleTodos: summary.staleTodos,
    oldHandoffs: summary.oldHandoffs,
    identityViolations: summary.identityViolations,
    projectMigrationPreview: summary.projectMigrationPreview,
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
  const shouldPreviewProjectRecords = !scopeFilter || scopeFilter.includes("project");
  const projectMigrationPreview = shouldPreviewProjectRecords
    ? memories
      .filter((m) => m.scope === "project")
      .map((m) => buildProjectMigrationPreviewCandidate(m, now))
    : [];

  const staleTodos: AuditCandidate[] = todos.flatMap((m) => {
    const finding = classifyLifecycleAuditFinding(m, now);
    if (finding?.type !== "stale_todo") return [];
    return [{
      id: m.id,
      title: m.title,
      kind: m.kind,
      tags: m.tags,
      updatedAt: m.updatedAt,
      scope: m.scope,
      reason: finding.reason,
      suggestedAction: finding.suggestedAction,
    }];
  });

  const oldHandoffs: AuditCandidate[] = handoffs.flatMap((m) => {
    const finding = classifyLifecycleAuditFinding(m, now);
    if (finding?.type !== "expired_handoff") return [];
    return [{
      id: m.id,
      title: m.title,
      kind: m.kind,
      tags: m.tags,
      updatedAt: m.updatedAt,
      scope: m.scope,
      reason: finding.reason,
      suggestedAction: finding.suggestedAction,
    }];
  });

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

  if (oldHandoffs.length > 0) {
    warnings.push(`${oldHandoffs.length} handoff${oldHandoffs.length !== 1 ? "s" : ""} expired`);
    suggestedActions.push("Archive expired handoffs");
  }

  if (staleTodos.length > 0) {
    suggestedActions.push("Review stale todos");
  }

  if (identityViolations.length > 0) {
    warnings.push(`${identityViolations.length} active memor${identityViolations.length !== 1 ? "ies have" : "y has"} scope identity issues`);
    suggestedActions.push("Review identity violations before any migration");
  }

  if (projectMigrationPreview.length > 0) {
    suggestedActions.push("Review project migration preview; apply no changes without explicit approval");
  }

  return {
    staleTodos,
    oldHandoffs,
    identityViolations,
    projectMigrationPreview,
    activeTodosCount: todos.length,
    activeHandoffsCount: handoffs.length,
    staleTodosCount: staleTodos.length,
    expiredHandoffsCount: oldHandoffs.length,
    identityViolationsCount: identityViolations.length,
    projectMigrationPreviewCount: projectMigrationPreview.length,
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

function buildProjectMigrationPreviewCandidate(m: MemoryRecord, now: Date): ProjectMigrationPreviewCandidate {
  const base = {
    id: m.id,
    title: m.title,
    kind: m.kind,
    tags: m.tags,
    updatedAt: m.updatedAt,
    scope: m.scope,
    projectId: m.projectId,
    repoPath: m.repoPath,
    sessionId: m.sessionId,
  };

  if (!m.projectId || m.sessionId) {
    return {
      ...base,
      recommendation: "needs-human-review",
      reason: "Legacy project record has missing or conflicting identity metadata",
      suggestedAction: "Review manually before choosing repo, global, archive, or legacy-read-only",
    };
  }

  if (m.repoPath) {
    return {
      ...base,
      recommendation: "repo",
      reason: "Legacy project record carries repoPath metadata, so repo scope is the likely normal replacement",
      suggestedAction: `After approval, consider scope=repo with repoPath=${m.repoPath}; keep projectId only as optional metadata if needed`,
    };
  }

  if (m.tags.includes("global") || m.tags.includes("cross-repo")) {
    return {
      ...base,
      recommendation: "global",
      reason: "Legacy project record is tagged as global or cross-repo and has no repoPath metadata",
      suggestedAction: "After approval, consider scope=global only if the memory truly applies across repositories",
    };
  }

  return {
    ...base,
    recommendation: "legacy-read-only",
    reason: "Legacy project record has projectId but no repoPath metadata, so repo/global migration cannot be inferred safely",
    suggestedAction: "Keep discoverable as legacy/read-only until a human chooses the target scope",
  };
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
  projectMigrationPreview: ProjectMigrationPreviewCandidate[] = [],
): string {
  const lines: string[] = [];
  const total = staleTodos.length + oldHandoffs.length + identityViolations.length + projectMigrationPreview.length;

  if (total === 0) {
    lines.push("Memory audit: no items need attention.", "Project migration preview: no legacy project records included.", `db_path: ${dbPath}`);
    return lines.join("\n");
  }

  lines.push(`Memory audit: ${total} item${total !== 1 ? "s" : ""} need attention or review.`);

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

  if (projectMigrationPreview.length > 0) {
    lines.push("", `Project migration preview (${projectMigrationPreview.length}, read-only):`);
    projectMigrationPreview.forEach((c, i) => {
      lines.push(
        `  ${i + 1}. [${c.recommendation}] ${c.title} (${c.id})`,
        `     kind: ${c.kind}`,
        `     project_id: ${c.projectId ?? "none"}`,
        `     repo_path: ${c.repoPath ?? "none"}`,
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
