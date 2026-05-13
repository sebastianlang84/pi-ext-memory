import type { CreateMemoryInput, MemoryScope } from "./memories.ts";

export type MemoryIdentityFields = {
  sessionId?: string;
  projectId?: string;
  repoPath?: string;
};

export type MemoryIdentityContext = MemoryIdentityFields;

export type ScopeIdentityIssueStyle = "filter" | "tool";

export type ScopeIdentityIssueOptions = {
  style?: ScopeIdentityIssueStyle;
};

export type ScopeIdentityResolution = MemoryIdentityFields & {
  error?: string;
};

export const LEGACY_PROJECT_SCOPE_NOTICE = "notice: scope=project is legacy/advanced compatibility; prefer scope=repo with repoPath for normal repository memory.";

export function isLegacyProjectScopeSelected(scope?: MemoryScope | MemoryScope[]): boolean {
  const scopes = Array.isArray(scope) ? scope : scope ? [scope] : [];
  return scopes.includes("project");
}

export function findScopeIdentityIssues(
  input: { scope?: MemoryScope[]; sessionId?: string; projectId?: string; repoPath?: string },
  options: ScopeIdentityIssueOptions = {},
): string[] {
  const style = options.style ?? "filter";
  const identity = { sessionId: input.sessionId, projectId: input.projectId, repoPath: input.repoPath };

  if (!input.scope || input.scope.length === 0) {
    return countProvidedIdentities(identity) > 1
      ? ["sessionId, projectId, and repoPath filters cannot be combined without a single compatible scope"]
      : [];
  }

  if (input.scope.length !== 1) {
    return countProvidedIdentities(identity) > 1
      ? ["sessionId, projectId, and repoPath filters cannot be combined across multiple scopes"]
      : [];
  }

  const [singleScope] = input.scope;
  if (singleScope === "global" && hasAnyIdentity(identity)) {
    return [
      style === "tool"
        ? "scope=global does not accept sessionId, projectId, or repoPath. Remove scope identifiers or choose repo/session; scope=project is legacy compatibility only."
        : "scope=global does not accept sessionId, projectId, or repoPath filters",
    ];
  }

  if (singleScope === "repo" && (hasProvided(input.sessionId) || hasProvided(input.projectId))) {
    return [
      style === "tool"
        ? "scope=repo uses repoPath as its primary identity. Remove sessionId and projectId; the runtime can keep metadata internally."
        : "scope=repo uses repoPath as its primary identity; remove sessionId and projectId from the filter",
    ];
  }

  if (singleScope === "project" && (hasProvided(input.sessionId) || hasProvided(input.repoPath))) {
    return [
      style === "tool"
        ? "legacy scope=project uses projectId as its primary identity. Remove sessionId and repoPath, or prefer scope=repo for normal repository memory."
        : "scope=project uses projectId as its primary identity; remove sessionId and repoPath from the filter",
    ];
  }

  if (singleScope === "session" && (hasProvided(input.projectId) || hasProvided(input.repoPath))) {
    return [
      style === "tool"
        ? "scope=session uses sessionId as its primary identity. Remove projectId and repoPath; runtime context is attached internally."
        : "scope=session uses sessionId as its primary identity; remove projectId and repoPath from the filter",
    ];
  }

  return [];
}

export function resolveMemoryIdentityForScope(
  params: { scope: MemoryScope; sessionId?: string; projectId?: string; repoPath?: string },
  context: MemoryIdentityContext,
  options: { requirePrimary?: boolean } = {},
): ScopeIdentityResolution {
  const [error] = findScopeIdentityIssues(
    { scope: [params.scope], sessionId: params.sessionId, projectId: params.projectId, repoPath: params.repoPath },
    { style: "tool" },
  );

  if (error) return { error };

  const sessionId = firstText(params.sessionId, context.sessionId);
  const projectId = firstText(params.projectId, context.projectId);
  const repoPath = firstText(params.repoPath, context.repoPath);

  if (params.scope === "global") {
    return {};
  }

  if (params.scope === "repo") {
    if (options.requirePrimary && !repoPath) {
      return { error: "scope=repo requires repoPath, but no repository path was provided or derivable from cwd." };
    }
    return { repoPath };
  }

  if (params.scope === "project") {
    if (options.requirePrimary && !projectId) {
      return { error: "legacy scope=project requires projectId. Prefer scope=repo for normal repository memory." };
    }
    return { projectId };
  }

  if (options.requirePrimary && !sessionId) {
    return { error: "scope=session requires sessionId, but no session id was provided or derivable from the active Pi session." };
  }
  return { sessionId };
}

export function applyRuntimeIdentityEnrichment(input: CreateMemoryInput, context: MemoryIdentityContext): CreateMemoryInput {
  const enriched: CreateMemoryInput = { ...input };

  if ((input.scope === "project" || input.scope === "repo" || input.scope === "session") && context.projectId) {
    enriched.projectId ??= context.projectId;
  }

  if ((input.scope === "repo" || input.scope === "session") && context.repoPath) {
    enriched.repoPath ??= context.repoPath;
  }

  if (input.scope === "session") {
    enriched.sessionId ??= context.sessionId;
  }

  return enriched;
}

function countProvidedIdentities(identity: MemoryIdentityFields): number {
  return [identity.sessionId, identity.projectId, identity.repoPath].filter((value) => value !== undefined).length;
}

function hasAnyIdentity(identity: MemoryIdentityFields): boolean {
  return hasProvided(identity.sessionId) || hasProvided(identity.projectId) || hasProvided(identity.repoPath);
}

function hasProvided(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}

function firstText(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }

  return undefined;
}
