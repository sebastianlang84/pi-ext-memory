import type { MemoryScope } from "../core/index.ts";
import type { MemoryTurnContext } from "./retrieval.ts";

export type ToolIdentityParams = {
  scope: MemoryScope;
  sessionId?: string;
  projectId?: string;
  repoPath?: string;
};

export type ToolIdentityResult = {
  sessionId?: string;
  projectId?: string;
  repoPath?: string;
  error?: string;
};

export const LEGACY_PROJECT_SCOPE_NOTICE = "notice: scope=project is legacy/advanced compatibility; prefer scope=repo with repoPath for normal repository memory.";

export function formatWithLegacyProjectScopeNotice(text: string, scope?: MemoryScope | MemoryScope[]): string {
  const scopes = Array.isArray(scope) ? scope : scope ? [scope] : [];
  return scopes.includes("project") ? `${LEGACY_PROJECT_SCOPE_NOTICE}\n${text}` : text;
}

export function resolveToolIdentity(
  params: ToolIdentityParams,
  context: MemoryTurnContext,
  options: { requirePrimary?: boolean } = {},
): ToolIdentityResult {
  const sessionId = params.sessionId?.trim() || context.sessionId.trim() || undefined;
  const projectId = params.projectId?.trim() || context.projectId;
  const repoPath = params.repoPath?.trim() || context.repoPath;

  if (params.scope === "global") {
    if (params.sessionId || params.projectId || params.repoPath) {
      return { error: "scope=global does not accept sessionId, projectId, or repoPath. Remove scope identifiers or choose repo/session; scope=project is legacy compatibility only." };
    }
    return {};
  }

  if (params.scope === "repo") {
    if (params.sessionId || params.projectId) {
      return { error: "scope=repo uses repoPath as its primary identity. Remove sessionId and projectId; the runtime can keep metadata internally." };
    }
    if (options.requirePrimary && !repoPath) {
      return { error: "scope=repo requires repoPath, but no repository path was provided or derivable from cwd." };
    }
    return { repoPath };
  }

  if (params.scope === "project") {
    if (params.sessionId || params.repoPath) {
      return { error: "legacy scope=project uses projectId as its primary identity. Remove sessionId and repoPath, or prefer scope=repo for normal repository memory." };
    }
    if (options.requirePrimary && !projectId) {
      return { error: "legacy scope=project requires projectId. Prefer scope=repo for normal repository memory." };
    }
    return { projectId };
  }

  if (params.projectId || params.repoPath) {
    return { error: "scope=session uses sessionId as its primary identity. Remove projectId and repoPath; runtime context is attached internally." };
  }
  if (options.requirePrimary && !sessionId) {
    return { error: "scope=session requires sessionId, but no session id was provided or derivable from the active Pi session." };
  }
  return { sessionId };
}

export function resolveSingleScopeSearchIdentity(
  params: { scope?: MemoryScope[]; sessionId?: string; projectId?: string; repoPath?: string },
  context: MemoryTurnContext,
): ToolIdentityResult {
  if (!params.scope || params.scope.length === 0) {
    if ([params.sessionId, params.projectId, params.repoPath].filter((value) => value !== undefined).length > 1) {
      return { error: "sessionId, projectId, and repoPath filters cannot be combined without a single compatible scope." };
    }
    return { sessionId: params.sessionId, projectId: params.projectId, repoPath: params.repoPath };
  }

  if (params.scope.length !== 1) {
    if ([params.sessionId, params.projectId, params.repoPath].filter((value) => value !== undefined).length > 1) {
      return { error: "sessionId, projectId, and repoPath filters cannot be combined across multiple scopes." };
    }
    return { sessionId: params.sessionId, projectId: params.projectId, repoPath: params.repoPath };
  }

  return resolveToolIdentity({ scope: params.scope[0]!, sessionId: params.sessionId, projectId: params.projectId, repoPath: params.repoPath }, context, { requirePrimary: true });
}

export function formatIdentityError(error: string, dbPath: string): string {
  return `Invalid memory scope identity: ${error}\ndb_path: ${dbPath}`;
}
