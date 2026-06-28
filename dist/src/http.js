import { HTTP_BASE_PATH } from "./constants.js";
import { normalizeSessionKey, readTodo, readTodoSummaries, todoBelongsToSession, validateTodoId, } from "./todo-state.js";
function jsonResponse(statusCode, body) {
    return { statusCode, body };
}
function extractTodoId(urlPath) {
    if (urlPath === HTTP_BASE_PATH || urlPath === `${HTTP_BASE_PATH}/`) {
        return null;
    }
    const prefix = `${HTTP_BASE_PATH}/`;
    if (!urlPath.startsWith(prefix)) {
        return "";
    }
    const rest = urlPath.slice(prefix.length);
    const parts = rest.split("/").filter(Boolean);
    if (parts.length === 1) {
        return decodeURIComponent(parts[0]);
    }
    if (parts.length === 2 && parts[1] === "status") {
        return decodeURIComponent(parts[0]);
    }
    return "";
}
export async function resolveTodoHttpResponse(stateDir, method, requestUrl) {
    if (method !== "GET") {
        return jsonResponse(405, { error: "Method not allowed" });
    }
    const parsed = new URL(requestUrl ?? "/", "http://localhost");
    const sessionKey = parsed.searchParams.has("session_key")
        ? normalizeSessionKey(parsed.searchParams.get("session_key") ?? undefined)
        : null;
    const todoId = extractTodoId(parsed.pathname);
    if (todoId === "") {
        return jsonResponse(404, { error: "Route not found" });
    }
    if (todoId === null) {
        const todos = await readTodoSummaries(stateDir, sessionKey ?? undefined);
        return jsonResponse(200, { todos });
    }
    const validationError = validateTodoId(todoId);
    if (validationError) {
        return jsonResponse(400, { error: validationError });
    }
    try {
        const todo = await readTodo(stateDir, todoId);
        if (sessionKey && !todoBelongsToSession(todo, sessionKey)) {
            return jsonResponse(404, { error: `Todo "${todoId}" not found` });
        }
        return jsonResponse(200, todo);
    }
    catch {
        return jsonResponse(404, { error: `Todo "${todoId}" not found` });
    }
}
export function createTodoHttpHandler(stateDir) {
    return async function handleTodoRequest(req, res) {
        const response = await resolveTodoHttpResponse(stateDir, req.method, req.url);
        res.statusCode = response.statusCode;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify(response.body));
        return true;
    };
}
