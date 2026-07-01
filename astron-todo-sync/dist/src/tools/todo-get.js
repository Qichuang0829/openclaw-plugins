import { DEFAULT_SESSION_ID } from "../constants.js";
import { readTodo, readTodoSummaries, todoBelongsToSessionId, validateTodoId } from "../todo-state.js";
import { jsonResult } from "../tool-utils.js";
const TodoGetSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        todo_id: { type: "string", description: "Todo ID to read. If omitted, lists todo summaries." },
    },
};
export function createTodoGetTool(stateDir, sessionId = DEFAULT_SESSION_ID) {
    return {
        name: "astron_single_agent_todo_get",
        label: "Get Single-Agent Todo",
        description: "仅用于读取单 Agent 主对话 todo 状态，通常用于进度、保存状态或刚才任务结果类问题。不要用本工具查询 agent-team 任务进度。如果用户提出新的执行工作，包括继续、补充、重存、制作表格，不要用本工具复用旧 todo，应先调用 astron_single_agent_todo_create 创建新的单 Agent todo。不要向用户暴露工具名、todoId 或原始内部状态。",
        parameters: TodoGetSchema,
        async execute(_toolCallId, params) {
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
            }
            catch (err) {
                return jsonResult({
                    error: `Todo "${todoId}" not found: ${err instanceof Error ? err.message : String(err)}`,
                });
            }
        },
    };
}
