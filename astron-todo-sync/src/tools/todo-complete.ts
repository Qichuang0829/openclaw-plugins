import { DEFAULT_SESSION_ID } from "../constants.js";
import {
  readTodo,
  todoBelongsToSessionId,
  updateTodoSummary,
  validateTodoId,
  writeTodo,
} from "../todo-state.js";
import type { AnyAgentTool, TodoList } from "../types.js";
import { jsonResult, nowIso } from "../tool-utils.js";

const TodoCompleteSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    todo_id: { type: "string", description: "Todo ID returned by astronclaw_todo_create." },
  },
  required: ["todo_id"],
} as const;

type TodoCompleteParams = {
  todo_id: string;
};

const COMPLETE_RETRY_DELAYS_MS = [200, 500] as const;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getIncompleteItems(todo: TodoList) {
  return todo.items.filter((item) => item.status !== "completed" && item.status !== "failed");
}

export function createTodoCompleteTool(stateDir: string, sessionId = DEFAULT_SESSION_ID): AnyAgentTool {
  return {
    name: "astronclaw_todo_complete",
    label: "Complete Conversation Todo",
    description:
      "Close the persisted conversation todo list after every item is completed or failed and before sending the final user-facing result. This keeps the UI/HTTP todo state accurate; do not mention tool names, todo IDs, or internal state to the user.",
    parameters: TodoCompleteSchema,
    async execute(_toolCallId: string, params: TodoCompleteParams) {
      const todoId = params.todo_id?.trim();
      if (!todoId) {
        return jsonResult({ error: "todo_id is required" });
      }
      const validationError = validateTodoId(todoId);
      if (validationError) {
        return jsonResult({ error: validationError });
      }

      let todo;
      try {
        todo = await readTodo(stateDir, sessionId, todoId);
      } catch (err) {
        return jsonResult({
          error: `Todo "${todoId}" not found: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      if (!todoBelongsToSessionId(todo, sessionId)) {
        return jsonResult({ error: `Todo "${todoId}" is not available in this session.` });
      }

      let incomplete = getIncompleteItems(todo);
      for (const delayMs of COMPLETE_RETRY_DELAYS_MS) {
        if (incomplete.length === 0) {
          break;
        }
        await wait(delayMs);
        try {
          todo = await readTodo(stateDir, sessionId, todoId);
        } catch (err) {
          return jsonResult({
            error: `Todo "${todoId}" not found: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        if (!todoBelongsToSessionId(todo, sessionId)) {
          return jsonResult({ error: `Todo "${todoId}" is not available in this session.` });
        }
        incomplete = getIncompleteItems(todo);
      }

      if (incomplete.length > 0) {
        return jsonResult({
          error: "Cannot complete todo while items are still pending or in progress.",
          incompleteItems: incomplete.map((item) => ({
            id: item.id,
            title: item.title,
            status: item.status,
          })),
        });
      }

      const timestamp = nowIso();
      const status = todo.items.some((item) => item.status === "failed") ? "failed" : "completed";
      const nextTodo: TodoList = {
        ...todo,
        status,
        updatedAt: timestamp,
        closedAt: timestamp,
      };

      await writeTodo(stateDir, nextTodo);
      await updateTodoSummary(stateDir, nextTodo);

      return jsonResult({
        success: true,
        todoId,
        status,
        todo: nextTodo,
      });
    },
  } as AnyAgentTool;
}
