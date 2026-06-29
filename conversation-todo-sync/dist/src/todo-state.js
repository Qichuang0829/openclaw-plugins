import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ARTIFACTS_DIR, DEFAULT_SESSION_ID, SESSION_FILE, SESSIONS_DIR, TODO_DIR_NAME, TODO_FILE, } from "./constants.js";
const fileWriteQueues = new Map();
function normalizeTodoItem(item) {
    const { message: _message, ...rest } = item;
    return {
        id: rest.id ?? "",
        title: rest.title ?? "",
        description: rest.description ?? "",
        status: rest.status ?? "pending",
        startedAt: rest.startedAt ?? null,
        completedAt: rest.completedAt ?? null,
        artifactPaths: Array.isArray(rest.artifactPaths) ? rest.artifactPaths : [],
    };
}
function normalizeTodo(todo) {
    return {
        todoId: todo.todoId ?? "",
        sessionId: normalizeSessionId(todo.sessionId),
        task: todo.task ?? "",
        status: todo.status ?? "pending",
        items: Array.isArray(todo.items) ? todo.items.map(normalizeTodoItem) : [],
        createdAt: todo.createdAt ?? "",
        updatedAt: todo.updatedAt ?? "",
        ...(todo.closedAt ? { closedAt: todo.closedAt } : {}),
    };
}
export function normalizeSessionId(sessionId) {
    const normalized = sessionId?.trim().toLowerCase();
    return normalized || DEFAULT_SESSION_ID;
}
export function validateSessionId(sessionId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalizeSessionId(sessionId))) {
        return "session_id must be a UUID.";
    }
    return null;
}
export function todoBelongsToSessionId(todo, sessionId) {
    return normalizeSessionId(todo.sessionId) === normalizeSessionId(sessionId);
}
export function validateTodoId(todoId) {
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-[0-9a-f]{6}$/.test(todoId)) {
        return "todo_id must be lowercase alphanumeric with hyphens and end with a 6-character hex suffix.";
    }
    return null;
}
export function createTodoIdFromBase(baseTodoId) {
    const base = (baseTodoId ?? "todo").trim();
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(base)) {
        throw new Error("todo_id must be lowercase alphanumeric with hyphens.");
    }
    return `${base}-${crypto.randomBytes(3).toString("hex")}`;
}
export function getTodosDir(stateDir) {
    return path.join(stateDir, TODO_DIR_NAME);
}
export function getSessionsDir(stateDir) {
    return path.join(getTodosDir(stateDir), SESSIONS_DIR);
}
export function getSessionDir(stateDir, sessionId) {
    const validationError = validateSessionId(sessionId);
    if (validationError) {
        throw new Error(validationError);
    }
    return path.join(getSessionsDir(stateDir), normalizeSessionId(sessionId));
}
export function getSessionPath(stateDir, sessionId) {
    return path.join(getSessionDir(stateDir, sessionId), SESSION_FILE);
}
export function getTodoDir(stateDir, sessionId, todoId) {
    const validationError = validateTodoId(todoId);
    if (validationError) {
        throw new Error(validationError);
    }
    return path.join(getSessionDir(stateDir, sessionId), todoId);
}
export function getTodoPath(stateDir, sessionId, todoId) {
    return path.join(getTodoDir(stateDir, sessionId, todoId), TODO_FILE);
}
export function getArtifactsDir(stateDir, sessionId, todoId) {
    return path.join(getTodoDir(stateDir, sessionId, todoId), ARTIFACTS_DIR);
}
async function withFileWriteLock(filePath, action) {
    const previous = fileWriteQueues.get(filePath) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => current);
    fileWriteQueues.set(filePath, queued);
    await previous.catch(() => undefined);
    try {
        return await action();
    }
    finally {
        release();
        if (fileWriteQueues.get(filePath) === queued) {
            fileWriteQueues.delete(filePath);
        }
    }
}
async function writeJsonAtomic(filePath, value) {
    await withFileWriteLock(filePath, async () => {
        const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
        try {
            await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
            await fs.rename(tmpPath, filePath);
        }
        catch (err) {
            await fs.rm(tmpPath, { force: true }).catch(() => undefined);
            throw err;
        }
    });
}
export async function readTodo(stateDir, sessionId, todoId) {
    const raw = await fs.readFile(getTodoPath(stateDir, sessionId, todoId), "utf-8");
    return normalizeTodo(JSON.parse(raw));
}
export function summarizeTodo(stateDir, todo) {
    const sessionId = normalizeSessionId(todo.sessionId);
    return {
        todoId: todo.todoId,
        sessionId,
        task: todo.task,
        status: todo.status,
        itemCount: todo.items.length,
        pendingItemCount: todo.items.filter((item) => item.status === "pending").length,
        inProgressItemCount: todo.items.filter((item) => item.status === "in_progress").length,
        completedItemCount: todo.items.filter((item) => item.status === "completed").length,
        failedItemCount: todo.items.filter((item) => item.status === "failed").length,
        todoPath: getTodoPath(stateDir, sessionId, todo.todoId),
        createdAt: todo.createdAt,
        updatedAt: todo.updatedAt,
        ...(todo.closedAt ? { closedAt: todo.closedAt } : {}),
    };
}
async function touchSessionMetadata(stateDir, sessionId, timestamp) {
    const normalized = normalizeSessionId(sessionId);
    const sessionDir = getSessionDir(stateDir, normalized);
    const sessionPath = getSessionPath(stateDir, normalized);
    await fs.mkdir(sessionDir, { recursive: true });
    let createdAt = timestamp;
    try {
        const raw = await fs.readFile(sessionPath, "utf-8");
        const existing = JSON.parse(raw);
        if (existing.sessionId === normalized && typeof existing.createdAt === "string" && existing.createdAt) {
            createdAt = existing.createdAt;
        }
    }
    catch (err) {
        if (!(err instanceof Error) || err.code !== "ENOENT") {
            throw err;
        }
    }
    await writeJsonAtomic(sessionPath, {
        version: 1,
        sessionId: normalized,
        createdAt,
        updatedAt: timestamp,
    });
}
export async function readTodosForSession(stateDir, sessionId) {
    const normalized = normalizeSessionId(sessionId);
    const sessionDir = getSessionDir(stateDir, normalized);
    let entries;
    try {
        entries = await fs.readdir(sessionDir, { withFileTypes: true });
    }
    catch (err) {
        if (err instanceof Error && err.code === "ENOENT") {
            return [];
        }
        throw err;
    }
    const todos = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        try {
            const todo = await readTodo(stateDir, normalized, entry.name);
            if (todoBelongsToSessionId(todo, normalized)) {
                todos.push(todo);
            }
        }
        catch {
            // Ignore unreadable entries so one corrupted todo does not hide the rest of the session.
        }
    }
    return todos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function readTodoSummaries(stateDir, sessionId) {
    const todos = await readTodosForSession(stateDir, sessionId);
    return todos.map((todo) => summarizeTodo(stateDir, todo));
}
export async function writeTodo(stateDir, todo) {
    const sessionId = normalizeSessionId(todo.sessionId);
    const todoDir = getTodoDir(stateDir, sessionId, todo.todoId);
    await fs.mkdir(todoDir, { recursive: true });
    await writeJsonAtomic(getTodoPath(stateDir, sessionId, todo.todoId), { ...todo, sessionId });
}
export async function createTodoWorkspace(stateDir, todo) {
    const sessionId = normalizeSessionId(todo.sessionId);
    const todoDir = getTodoDir(stateDir, sessionId, todo.todoId);
    await fs.mkdir(getArtifactsDir(stateDir, sessionId, todo.todoId), { recursive: true });
    await writeTodo(stateDir, { ...todo, sessionId });
    await touchSessionMetadata(stateDir, sessionId, todo.updatedAt);
    const summary = summarizeTodo(stateDir, { ...todo, sessionId });
    return {
        ...summary,
        todoPath: path.join(todoDir, TODO_FILE),
    };
}
export async function updateTodoSummary(stateDir, todo) {
    await touchSessionMetadata(stateDir, todo.sessionId, todo.updatedAt);
}
