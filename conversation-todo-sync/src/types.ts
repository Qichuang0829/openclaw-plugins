export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: Record<string, unknown>;
};

export type AnyAgentTool = {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: any,
    signal?: AbortSignal,
    onUpdate?: (update: unknown) => void,
  ): Promise<ToolResult>;
  [key: string]: unknown;
};

export type TodoStatus = "pending" | "running" | "completed" | "failed";
export type TodoItemStatus = "pending" | "in_progress" | "completed" | "failed";

export type TodoItem = {
  id: string;
  title: string;
  description: string;
  status: TodoItemStatus;
  startedAt: string | null;
  completedAt: string | null;
  artifactPaths: string[];
};

export type TodoList = {
  todoId: string;
  sessionId: string;
  task: string;
  status: TodoStatus;
  items: TodoItem[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
};
export type TodoSummary = {
  todoId: string;
  sessionId: string;
  task: string;
  status: TodoStatus;
  itemCount: number;
  pendingItemCount: number;
  inProgressItemCount: number;
  completedItemCount: number;
  failedItemCount: number;
  todoPath: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
};
