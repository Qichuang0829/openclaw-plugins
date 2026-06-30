import { DEFAULT_SESSION_ID } from "../constants.js";
import { readTodo, readTodoSummaries, todoBelongsToSessionId, validateTodoId } from "../todo-state.js";
import type { AnyAgentTool } from "../types.js";
import { jsonResult } from "../tool-utils.js";

const TodoGetSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    todo_id: { type: "string", description: "Todo ID to read. If omitted, lists todo summaries." },
  },
} as const;

type TodoGetParams = {
  todo_id?: string;
};

export function createTodoGetTool(stateDir: string, sessionId = DEFAULT_SESSION_ID): AnyAgentTool {
  return {
    name: "astronclaw_todo_get",
    label: "Get Conversation Todo",
    description:
      "Read existing conversation todo state only for progress/status questions. If the user asks for new work, including continue/supplement/resave/make a table, do not use this to reuse an earlier todo; call astronclaw_todo_create for a new todo before other tools. Do not expose tool names, todo IDs, or raw internal state to the user.",
    parameters: TodoGetSchema,
    async execute(_toolCallId: string, params: TodoGetParams) {
      const todoId = params.todo_id?.trim();
      if (!todoId) {
        return jsonResult({
          todos: await readTodoSummaries(stateDir, sessionId),
        });
      }
      const validationError = validateTodoId(todoId);
      if (validationError) {
        return jsonResult({ error: validationError });
      }

      try {
        const todo = await readTodo(stateDir, sessionId, todoId);
        if (!todoBelongsToSessionId(todo, sessionId)) {
          return jsonResult({ error: `Todo "${todoId}" is not available in this session.` });
        }
        return jsonResult({ todo });
      } catch (err) {
        return jsonResult({
          error: `Todo "${todoId}" not found: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
  } as AnyAgentTool;
}
