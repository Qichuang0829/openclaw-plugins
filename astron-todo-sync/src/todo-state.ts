import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  ARTIFACTS_DIR,
  DEFAULT_SESSION_ID,
  SESSION_FILE,
  SESSIONS_DIR,
  TODO_DIR_NAME,
  TODO_FILE,
} from "./constants.js";
import type { TodoItem, TodoList, TodoSummary } from "./types.js";

const fileWriteQueues = new Map<string, Promise<void>>();

type LegacyTodoItem = Partial<TodoItem> & { message?: unknown };

type TodoSessionMetadata = {
  version: 1;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
};

function normalizeTodoItem(item: LegacyTodoItem): TodoItem {
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

function normalizeTodo(todo: Partial<TodoList> & { items?: LegacyTodoItem[] }): TodoList {
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

export function normalizeSessionId(sessionId: string | undefined): string {
  const normalized = sessionId?.trim().toLowerCase();
  return normalized || DEFAULT_SESSION_ID;
}

export function validateSessionId(sessionId: string): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalizeSessionId(sessionId))) {
    return "session_id must be a UUID.";
  }
  return null;
}

export function todoBelongsToSessionId(
  todo: { sessionId?: string },
  sessionId: string,
): boolean {
  return normalizeSessionId(todo.sessionId) === normalizeSessionId(sessionId);
}

export function validateTodoId(todoId: string): string | null {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-[0-9a-f]{6}$/.test(todoId)) {
    return "todo_id must be lowercase alphanumeric with hyphens and end with a 6-character hex suffix.";
  }
  return null;
}

export function createTodoIdFromBase(baseTodoId?: string): string {
  const base = (baseTodoId ?? "todo").trim();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(base)) {
    throw new Error("todo_id must be lowercase alphanumeric with hyphens.");
  }
  return `${base}-${crypto.randomBytes(3).toString("hex")}`;
}

export function getTodosDir(stateDir: string): string {
  return path.join(stateDir, TODO_DIR_NAME);
}

export function getSessionsDir(stateDir: string): string {
  return path.join(getTodosDir(stateDir), SESSIONS_DIR);
}

export function getSessionDir(stateDir: string, sessionId: string): string {
  const validationError = validateSessionId(sessionId);
  if (validationError) {
    throw new Error(validationError);
  }
  return path.join(getSessionsDir(stateDir), normalizeSessionId(sessionId));
}

export function getSessionPath(stateDir: string, sessionId: string): string {
  return path.join(getSessionDir(stateDir, sessionId), SESSION_FILE);
}

export function getTodoDir(stateDir: string, sessionId: string, todoId: string): string {
  const validationError = validateTodoId(todoId);
  if (validationError) {
    throw new Error(validationError);
  }
  return path.join(getSessionDir(stateDir, sessionId), todoId);
}

export function getTodoPath(stateDir: string, sessionId: string, todoId: string): string {
  return path.join(getTodoDir(stateDir, sessionId, todoId), TODO_FILE);
}

export function getArtifactsDir(stateDir: string, sessionId: string, todoId: string): string {
  return path.join(getTodoDir(stateDir, sessionId, todoId), ARTIFACTS_DIR);
}

async function withFileWriteLock<T>(filePath: string, action: () => Promise<T>): Promise<T> {
  const previous = fileWriteQueues.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  fileWriteQueues.set(filePath, queued);

  await previous.catch(() => undefined);

  try {
    return await action();
  } finally {
    release();
    if (fileWriteQueues.get(filePath) === queued) {
      fileWriteQueues.delete(filePath);
    }
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await withFileWriteLock(filePath, async () => {
    const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
      await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
      await fs.rename(tmpPath, filePath);
    } catch (err) {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      throw err;
    }
  });
}

export async function readTodo(stateDir: string, sessionId: string, todoId: string): Promise<TodoList> {
  const raw = await fs.readFile(getTodoPath(stateDir, sessionId, todoId), "utf-8");
  return normalizeTodo(JSON.parse(raw));
}

export function summarizeTodo(stateDir: string, todo: TodoList): TodoSummary {
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

async function touchSessionMetadata(
  stateDir: string,
  sessionId: string,
  timestamp: string,
): Promise<void> {
  const normalized = normalizeSessionId(sessionId);
  const sessionDir = getSessionDir(stateDir, normalized);
  const sessionPath = getSessionPath(stateDir, normalized);
  await fs.mkdir(sessionDir, { recursive: true });

  let createdAt = timestamp;
  try {
    const raw = await fs.readFile(sessionPath, "utf-8");
    const existing = JSON.parse(raw) as Partial<TodoSessionMetadata>;
    if (existing.sessionId === normalized && typeof existing.createdAt === "string" && existing.createdAt) {
      createdAt = existing.createdAt;
    }
  } catch (err) {
    if (!(err instanceof Error) || (err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  await writeJsonAtomic(sessionPath, {
    version: 1,
    sessionId: normalized,
    createdAt,
    updatedAt: timestamp,
  } satisfies TodoSessionMetadata);
}

export async function readTodosForSession(stateDir: string, sessionId: string): Promise<TodoList[]> {
  const normalized = normalizeSessionId(sessionId);
  const sessionDir = getSessionDir(stateDir, normalized);
  let entries;
  try {
    entries = await fs.readdir(sessionDir, { withFileTypes: true });
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const todos: TodoList[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      const todo = await readTodo(stateDir, normalized, entry.name);
      if (todoBelongsToSessionId(todo, normalized)) {
        todos.push(todo);
      }
    } catch {
      // Ignore unreadable entries so one corrupted todo does not hide the rest of the session.
    }
  }

  return todos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readTodoSummaries(
  stateDir: string,
  sessionId: string,
): Promise<TodoSummary[]> {
  const todos = await readTodosForSession(stateDir, sessionId);
  return todos.map((todo) => summarizeTodo(stateDir, todo));
}

export async function readLatestTodoForSession(
  stateDir: string,
  sessionId: string,
): Promise<TodoList | null> {
  return (await readTodosForSession(stateDir, sessionId))[0] ?? null;
}

export async function writeTodo(stateDir: string, todo: TodoList): Promise<void> {
  const sessionId = normalizeSessionId(todo.sessionId);
  const todoDir = getTodoDir(stateDir, sessionId, todo.todoId);
  await fs.mkdir(todoDir, { recursive: true });
  await writeJsonAtomic(getTodoPath(stateDir, sessionId, todo.todoId), { ...todo, sessionId });
}

export async function createTodoWorkspace(stateDir: string, todo: TodoList): Promise<TodoSummary> {
  const sessionId = normalizeSessionId(todo.sessionId);
  const todoDir = getTodoDir(stateDir, sessionId, todo.todoId);
  await touchSessionMetadata(stateDir, sessionId, todo.updatedAt);
  await fs.mkdir(getArtifactsDir(stateDir, sessionId, todo.todoId), { recursive: true });
  await writeTodo(stateDir, { ...todo, sessionId });

  const summary = summarizeTodo(stateDir, { ...todo, sessionId });

  return {
    ...summary,
    todoPath: path.join(todoDir, TODO_FILE),
  };
}

export async function updateTodoSummary(
  stateDir: string,
  todo: TodoList,
): Promise<void> {
  await touchSessionMetadata(stateDir, todo.sessionId, todo.updatedAt);
}

export async function failLatestOpenTodoForSession(
  stateDir: string,
  sessionId: string,
  timestamp: string,
): Promise<TodoList | null> {
  const todo = await readLatestTodoForSession(stateDir, sessionId);
  if (!todo || todo.status === "completed" || todo.status === "failed") {
    return null;
  }

  const nextTodo: TodoList = {
    ...todo,
    status: "failed",
    items: todo.items.map((item) => {
      if (item.status === "completed" || item.status === "failed") {
        return item;
      }
      return {
        ...item,
        status: "failed",
        startedAt: item.startedAt ?? timestamp,
        completedAt: item.completedAt ?? timestamp,
      };
    }),
    updatedAt: timestamp,
    closedAt: timestamp,
  };

  await updateTodoSummary(stateDir, nextTodo);
  await writeTodo(stateDir, nextTodo);
  return nextTodo;
}
