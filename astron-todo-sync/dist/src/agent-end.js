import { DEFAULT_SESSION_ID } from "./constants.js";
import { normalizeSessionId, readTodosForSession, updateTodoSummary, validateSessionId, writeTodo, } from "./todo-state.js";
import { nowIso } from "./tool-utils.js";
function findUuid(value) {
    const match = value?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return match ? normalizeSessionId(match[0]) : null;
}
export function resolveAgentEndSessionId(ctx) {
    const fromSessionId = findUuid(ctx?.sessionId);
    if (fromSessionId) {
        return fromSessionId;
    }
    return findUuid(ctx?.sessionKey);
}
function failOpenItem(item, timestamp) {
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
function failOpenTodo(todo, timestamp) {
    return {
        ...todo,
        status: "failed",
        items: todo.items.map((item) => failOpenItem(item, timestamp)),
        updatedAt: timestamp,
        closedAt: timestamp,
    };
}
export async function failOpenTodosForSession(stateDir, sessionId = DEFAULT_SESSION_ID) {
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
export function createAgentEndHandler(stateDir, logger) {
    return async function handleAgentEnd(event, ctx) {
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
