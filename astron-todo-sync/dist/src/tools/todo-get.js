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
        name: "astronclaw_todo_get",
        label: "Get Conversation Todo",
        description: "Read existing conversation todo state for the current session when answering progress/status questions. Do not use this as a default step before creating a todo for a new complex user message, and do not use it to reuse an earlier todo for new work. Do not expose tool names, todo IDs, or raw internal state to the user.",
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
