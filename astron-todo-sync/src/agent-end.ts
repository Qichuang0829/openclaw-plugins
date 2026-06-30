import { DEFAULT_SESSION_ID } from "./constants.js";
import {
  normalizeSessionId,
  readTodosForSession,
  updateTodoSummary,
  validateSessionId,
  writeTodo,
} from "./todo-state.js";
import { nowIso } from "./tool-utils.js";
import type { TodoItem, TodoList } from "./types.js";

type AgentEndEvent = {
  success?: boolean;
  error?: string;
};

type AgentHookContext = {
  sessionId?: string;
  sessionKey?: string;
};

function findUuid(value: string | undefined): string | null {
  const match = value?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? normalizeSessionId(match[0]) : null;
}

export function resolveAgentEndSessionId(ctx: AgentHookContext | undefined): string | null {
  const fromSessionId = findUuid(ctx?.sessionId);
  if (fromSessionId) {
    return fromSessionId;
  }
  return findUuid(ctx?.sessionKey);
}

function failOpenItem(item: TodoItem, timestamp: string): TodoItem {
  if (item.status === "completed" || item.status === "failed") {
    return item;
  }
  return {
    ...item,
    status: "failed",
    startedAt: item.startedAt ?? timestamp,
    completedAt: timestamp,
  };
}

function failOpenTodo(todo: TodoList, timestamp: string): TodoList {
  return {
    ...todo,
    status: "failed",
    items: todo.items.map((item) => failOpenItem(item, timestamp)),
    updatedAt: timestamp,
    closedAt: timestamp,
  };
}

export async function failOpenTodosForSession(
  stateDir: string,
  sessionId: string = DEFAULT_SESSION_ID,
): Promise<number> {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const validationError = validateSessionId(normalizedSessionId);
  if (validationError) {
    return 0;
  }

  const timestamp = nowIso();
  const todos = await readTodosForSession(stateDir, normalizedSessionId);
  const openTodos = todos.filter((todo) => todo.status !== "completed" && todo.status !== "failed");
  for (const todo of openTodos) {
    const nextTodo = failOpenTodo(todo, timestamp);
    await writeTodo(stateDir, nextTodo);
    await updateTodoSummary(stateDir, nextTodo);
  }
  return openTodos.length;
}

export function createAgentEndHandler(stateDir: string, logger?: { warn?: (message: string) => void }) {
  return async function handleAgentEnd(event: AgentEndEvent, ctx: AgentHookContext | undefined): Promise<void> {
    if (event?.success !== false) {
      return;
    }

    const sessionId = resolveAgentEndSessionId(ctx);
    if (!sessionId) {
      logger?.warn?.("[astron-todo-sync] agent_end failed without a usable session id; open todos unchanged.");
      return;
    }

    await failOpenTodosForSession(stateDir, sessionId);
  };
}
