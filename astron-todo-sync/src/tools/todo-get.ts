import { DEFAULT_SESSION_ID } from "../constants.js";
import { readTodo, readTodoSummaries, todoBelongsToSessionId, validateTodoId } from "../todo-state.js";
import type { AnyAgentTool } from "../types.js";
import { errorResult, isErrorCode, jsonResult } from "../tool-utils.js";

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
    name: "astron_single_agent_todo_get",
    label: "Get Single-Agent Todo",
    description:
      "仅用于读取单 Agent 主对话 todo 状态，通常用于进度、保存状态或刚才任务结果类问题。不要用本工具查询 agent-team 任务进度。如果用户提出新的执行工作，包括继续、补充、重存、制作表格，不要用本工具复用旧 todo，应先调用 astron_single_agent_todo_create 创建新的单 Agent todo。不要向用户暴露工具名、todoId 或原始内部状态。",
    parameters: TodoGetSchema,
    async execute(_toolCallId: string, params: TodoGetParams) {
      const todoId = params.todo_id?.trim();
      if (!todoId) {
        try {
          return jsonResult({
            success: true,
            todos: await readTodoSummaries(stateDir, sessionId),
          });
        } catch {
          return errorResult("INTERNAL_ERROR", "Failed to list todo state.");
        }
      }
      const validationError = validateTodoId(todoId);
      if (validationError) {
        return errorResult("INVALID_ARGUMENT", validationError, {
          nextAction: {
            tool: "astron_single_agent_todo_get",
            instruction: "Correct the todo_id and call the get tool again.",
          },
        });
      }

      try {
        const todo = await readTodo(stateDir, sessionId, todoId);
        if (!todoBelongsToSessionId(todo, sessionId)) {
          return errorResult(
            "TODO_UNAVAILABLE",
            `Todo "${todoId}" is not available in this session.`,
            {
              nextAction: {
                tool: "astron_single_agent_todo_get",
                instruction:
                  "List todos available in the current session without reusing this todo_id.",
                arguments: {},
              },
            },
          );
        }
        return jsonResult({ success: true, todo });
      } catch (err) {
        if (isErrorCode(err, "ENOENT")) {
          return errorResult("TODO_UNAVAILABLE", `Todo "${todoId}" is not available in this session.`, {
            nextAction: {
              tool: "astron_single_agent_todo_get",
              instruction:
                "List todos available in the current session without reusing this todo_id.",
              arguments: {},
            },
          });
        }
        return errorResult("INTERNAL_ERROR", "Failed to read todo state.");
      }
    },
  } as AnyAgentTool;
}
