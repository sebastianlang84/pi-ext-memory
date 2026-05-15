export const TODO_PRIORITIES = ["P0", "P1", "P2"] as const;
export const TODO_WORKFLOW_STATUSES = ["open", "in_progress", "blocked"] as const;

export type TodoPriority = (typeof TODO_PRIORITIES)[number];
export type TodoWorkflowStatus = (typeof TODO_WORKFLOW_STATUSES)[number];

const TODO_PRIORITY_TAGS = new Set(TODO_PRIORITIES.map((priority) => priority.toLowerCase()));
const TODO_WORKFLOW_TAGS = new Set(["todo", ...TODO_PRIORITY_TAGS, ...TODO_WORKFLOW_STATUSES]);

export function isTodoPriorityTag(tag: string): boolean {
  return TODO_PRIORITY_TAGS.has(normalizeTagForPolicy(tag));
}

export function isTodoWorkflowTag(tag: string): boolean {
  return TODO_WORKFLOW_TAGS.has(normalizeTagForPolicy(tag));
}

export function findTodoPriorityTag(tags: string[]): TodoPriority | undefined {
  for (const tag of tags) {
    const normalized = normalizeTagForPolicy(tag);
    const priority = TODO_PRIORITIES.find((candidate) => candidate.toLowerCase() === normalized);
    if (priority) return priority;
  }
  return undefined;
}

export function findTodoPriorityInSummary(summary: string): TodoPriority | undefined {
  const match = summary.match(/^\[(P[012])\]\s*/i);
  if (!match) return undefined;
  const normalized = match[1]?.toUpperCase();
  return TODO_PRIORITIES.find((priority) => priority === normalized);
}

export function stripTodoPriorityTags(tags: string[]): string[] {
  return tags.filter((tag) => !isTodoPriorityTag(tag));
}

export function stripTodoWorkflowTags(tags: string[]): string[] {
  return tags.filter((tag) => !isTodoWorkflowTag(tag));
}

function normalizeTagForPolicy(tag: string): string {
  return tag.trim().replace(/\s+/g, " ").toLowerCase();
}
