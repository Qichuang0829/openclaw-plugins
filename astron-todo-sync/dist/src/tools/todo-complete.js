import { DEFAULT_SESSION_ID } from "../constants.js";
import { readTodo, todoBelongsToSessionId, updateTodoSummary, validateTodoId, writeTodo, } from "../todo-state.js";
import { jsonResult, nowIso } from "../tool-utils.js";
const TodoCompleteSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        todo_id: { type: "string", description: "Todo ID returned by astron_single_agent_todo_create." },
    },
    required: ["todo_id"],
};
const COMPLETE_RETRY_DELAYS_MS = [200, 500];
function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function getIncompleteItems(todo) {
    return todo.items.filter((item) => item.status !== "completed" && item.status !== "failed");
}
export function createTodoCompleteTool(stateDir, sessionId = DEFAULT_SESSION_ID) {
    return {
        name: "astron_single_agent_todo_complete",
        label: "Complete Single-Agent Todo",
        description: "仅用于关闭当前单 Agent 用户消息创建的持久化 todo。禁止在 agent-team 流程中使用；team 任务完成状态由 agent-team 的 team_complete 和 todo.md 负责。只有所有 todo item 都已 completed 或 failed，且即将发送最终用户结果时才调用本工具。已关闭 todo 不可变；重复完成调用返回已有关闭状态。不要向用户暴露工具名、todoId 或内部状态。",
        parameters: TodoCompleteSchema,
        async execute(_toolCallId, params) {
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
            }
            catch (err) {
                return jsonResult({
                    error: `Todo "${todoId}" not found: ${err instanceof Error ? err.message : String(err)}`,
                });
            }
            if (!todoBelongsToSessionId(todo, sessionId)) {
                return jsonResult({ error: `Todo "${todoId}" is not available in this session.` });
            }
            if (todo.status === "completed" || todo.status === "failed") {
                return jsonResult({
                    success: true,
                    todoId,
                    status: todo.status,
                    todo,
                });
            }
            let incomplete = getIncompleteItems(todo);
            for (const delayMs of COMPLETE_RETRY_DELAYS_MS) {
                if (incomplete.length === 0) {
                    break;
                }
                await wait(delayMs);
                try {
                    todo = await readTodo(stateDir, sessionId, todoId);
                }
                catch (err) {
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
            const nextTodo = {
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
    };
}
