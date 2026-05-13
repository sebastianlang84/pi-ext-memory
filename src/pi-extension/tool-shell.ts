import type { MemoryScope, MemoryStore } from "../core/index.ts";
import { findScopeIdentityIssues, resolveMemoryIdentityForScope } from "../core/index.ts";
import { deriveMemoryTurnContext } from "./retrieval.ts";
import { formatIdentityError, formatWithLegacyProjectScopeNotice } from "./formatters.ts";
import type { MemoryTurnContext } from "./retrieval.ts";

type ToolIdentityParams = {
  scope: MemoryScope;
  sessionId?: string;
  projectId?: string;
  repoPath?: string;
};

type ToolIdentityResult = {
  sessionId?: string;
  projectId?: string;
  repoPath?: string;
  error?: string;
};

function resolveToolIdentity(
  params: ToolIdentityParams,
  context: MemoryTurnContext,
  options: { requirePrimary?: boolean } = {},
): ToolIdentityResult {
  return resolveMemoryIdentityForScope(params, context, options);
}

function resolveSingleScopeSearchIdentity(
  params: { scope?: MemoryScope[]; sessionId?: string; projectId?: string; repoPath?: string },
  context: MemoryTurnContext,
): ToolIdentityResult {
  if (!params.scope || params.scope.length === 0) {
    const [error] = findScopeIdentityIssues(params, { style: "tool" });
    if (error) return { error: `${error}.` };
    return { sessionId: params.sessionId, projectId: params.projectId, repoPath: params.repoPath };
  }

  if (params.scope.length !== 1) {
    const [error] = findScopeIdentityIssues(params, { style: "tool" });
    if (error) return { error: `${error}.` };
    return { sessionId: params.sessionId, projectId: params.projectId, repoPath: params.repoPath };
  }

  return resolveToolIdentity({ scope: params.scope[0]!, sessionId: params.sessionId, projectId: params.projectId, repoPath: params.repoPath }, context, { requirePrimary: true });
}

/**
 * Common execution context provided to every tool by the shell.
 *
 * The shell resolves the active store and turn context once, so individual
 * tool bodies do not repeat the setup boilerplate.
 */
export interface ToolExecutionContext {
  store: MemoryStore;
  turnContext: ReturnType<typeof deriveMemoryTurnContext>;
  /** Build a standard identity-error response with dbPath in details. */
  identityErrorResponse(error: string): ToolResponse;
  /** Wrap text with the legacy project scope notice when scope is project. */
  withLegacyNotice(text: string, scope?: MemoryScope | MemoryScope[]): string;
  /** Resolve search/list identity (single-scope, no primary requirement). */
  resolveSearchIdentity: typeof resolveSingleScopeSearchIdentity;
  /** Resolve save/update identity (scope-primary enforcement). */
  resolveWriteIdentity: typeof resolveToolIdentity;
}

/** Minimal tool response shape expected by Pi's registerTool contract. */
export interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

/**
 * A Pi tool execution context factory.
 *
 * Call `shell.forCwd(cwd, sessionId)` inside a tool's `execute` body to get a
 * pre-configured `ToolExecutionContext` without repeating store/context setup.
 */
export interface ToolShell {
  forCwd(cwd: string, sessionId: string): ToolExecutionContext;
}

/**
 * Create a tool shell bound to the given store resolver.
 *
 * The shell is created once when tools are registered and reused across all
 * tool invocations.  Individual tool bodies call `shell.forCwd(ctx.cwd, ...)`.
 */
export function createToolShell(getActiveStore: (cwd: string) => MemoryStore): ToolShell {
  return {
    forCwd(cwd: string, sessionId: string): ToolExecutionContext {
      const store = getActiveStore(cwd);
      const turnContext = deriveMemoryTurnContext(cwd, sessionId);

      return {
        store,
        turnContext,

        identityErrorResponse(error: string): ToolResponse {
          return {
            content: [{ type: "text", text: formatIdentityError(error, store.dbPath) }],
            details: { dbPath: store.dbPath },
          };
        },

        withLegacyNotice(text: string, scope?: MemoryScope | MemoryScope[]): string {
          return formatWithLegacyProjectScopeNotice(text, scope);
        },

        resolveSearchIdentity: resolveSingleScopeSearchIdentity,
        resolveWriteIdentity: resolveToolIdentity,
      };
    },
  };
}
