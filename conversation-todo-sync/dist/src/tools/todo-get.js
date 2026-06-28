import { readTodo, readTodoSummaries, todoBelongsToSession, validateTodoId } from "../todo-state.js";
import { jsonResult } from "../tool-utils.js";
const TodoGetSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        todo_id: { type: "string", description: "Todo ID to read. If omitted, lists todo summaries." },
    },
};
export function createTodoGetTool(stateDir, sessionKey = "default") {
    return {
        name: "astronclaw_todo_get",
        label: "Get Conversation Todo",
        description: "Read existing conversation todo state for the current session before continuing a task or answering a todo status question. Use to resume the right todo list without exposing tool names, todo IDs, or raw internal state to the user.",
        parameters: TodoGetSchema,
        async execute(_toolCallId, params) {
            const todoId = params.todo_id?.trim();
            if (!todoId) {
                return jsonResult({
                    todos: await readTodoSummaries(stateDir, sessionKey),
                });
            }
            const validationError = validateTodoId(todoId);
            if (validationError) {
                return jsonResult({ error: validationError });
            }
            try {
                const todo = await readTodo(stateDir, todoId);
                if (!todoBelongsToSession(todo, sessionKey)) {
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
