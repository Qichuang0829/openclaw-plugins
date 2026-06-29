import { HTTP_BASE_PATH } from "./constants.js";
import { normalizeSessionId, readTodosForSession, validateSessionId } from "./todo-state.js";
function jsonResponse(statusCode, body) {
    return { statusCode, body };
}
export async function resolveTodoHttpResponse(stateDir, method, requestUrl) {
    if (method !== "GET") {
        return jsonResponse(405, { error: "Method not allowed" });
    }
    const parsed = new URL(requestUrl ?? "/", "http://localhost");
    if (parsed.pathname !== HTTP_BASE_PATH) {
        return jsonResponse(404, { error: "Route not found" });
    }
    const rawSessionId = parsed.searchParams.get("session_id");
    if (rawSessionId === null || rawSessionId.trim() === "") {
        return jsonResponse(400, { error: "session_id is required" });
    }
    const sessionId = normalizeSessionId(rawSessionId);
    const validationError = validateSessionId(sessionId);
    if (validationError) {
        return jsonResponse(400, { error: validationError });
    }
    const todos = await readTodosForSession(stateDir, sessionId);
    return jsonResponse(200, { sessionId, todos });
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
