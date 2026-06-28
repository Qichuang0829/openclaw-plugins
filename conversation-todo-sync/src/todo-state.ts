import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  ARTIFACTS_DIR,
  STATE_FILE,
  TODO_DIR_NAME,
  TODO_FILE,
} from "./constants.js";
import type { PersistedTodoState, TodoList, TodoSummary } from "./types.js";

const fileWriteQueues = new Map<string, Promise<void>>();

function emptyState(): PersistedTodoState {
  return { version: 1, todos: [] };
}

export function normalizeSessionKey(sessionKey: string | undefined): string {
  const normalized = sessionKey?.trim();
  return normalized || "default";
}

export function todoBelongsToSession(
  todo: { sessionKey?: string },
  sessionKey: string,
): boolean {
  return !todo.sessionKey || todo.sessionKey === sessionKey;
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

export function getTodoDir(stateDir: string, todoId: string): string {
  const validationError = validateTodoId(todoId);
  if (validationError) {
    throw new Error(validationError);
  }
  return path.join(getTodosDir(stateDir), todoId);
}

export function getTodoPath(stateDir: string, todoId: string): string {
  return path.join(getTodoDir(stateDir, todoId), TODO_FILE);
}

export function getArtifactsDir(stateDir: string, todoId: string): string {
  return path.join(getTodoDir(stateDir, todoId), ARTIFACTS_DIR);
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

export async function readTodoState(stateDir: string): Promise<PersistedTodoState> {
  const filePath = path.join(getTodosDir(stateDir), STATE_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw) as PersistedTodoState;
    if (data.version === 1 && Array.isArray(data.todos)) {
      for (const todo of data.todos) {
        todo.sessionKey ??= "";
      }
      return data;
    }
    return emptyState();
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyState();
    }
    throw err;
  }
}

export async function writeTodoState(stateDir: string, state: PersistedTodoState): Promise<void> {
  const todosDir = getTodosDir(stateDir);
  await fs.mkdir(todosDir, { recursive: true });
  await writeJsonAtomic(path.join(todosDir, STATE_FILE), state);
}

export async function readTodo(stateDir: string, todoId: string): Promise<TodoList> {
  const raw = await fs.readFile(getTodoPath(stateDir, todoId), "utf-8");
  const todo = JSON.parse(raw) as TodoList;
  todo.sessionKey ??= "";
  return todo;
}

export function summarizeTodo(stateDir: string, todo: TodoList): TodoSummary {
  return {
    todoId: todo.todoId,
    sessionKey: todo.sessionKey,
    task: todo.task,
    status: todo.status,
    itemCount: todo.items.length,
    pendingItemCount: todo.items.filter((item) => item.status === "pending").length,
    inProgressItemCount: todo.items.filter((item) => item.status === "in_progress").length,
    completedItemCount: todo.items.filter((item) => item.status === "completed").length,
    failedItemCount: todo.items.filter((item) => item.status === "failed").length,
    todoPath: getTodoPath(stateDir, todo.todoId),
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
    ...(todo.closedAt ? { closedAt: todo.closedAt } : {}),
  };
}

function normalizeSummary(summary: Partial<TodoSummary>): TodoSummary {
  return {
    todoId: summary.todoId ?? "",
    sessionKey: summary.sessionKey ?? "",
    task: summary.task ?? "",
    status: summary.status ?? "pending",
    itemCount: summary.itemCount ?? 0,
    pendingItemCount: summary.pendingItemCount ?? 0,
    inProgressItemCount: summary.inProgressItemCount ?? 0,
    completedItemCount: summary.completedItemCount ?? 0,
    failedItemCount: summary.failedItemCount ?? 0,
    todoPath: summary.todoPath ?? "",
    createdAt: summary.createdAt ?? "",
    updatedAt: summary.updatedAt ?? "",
    ...(summary.closedAt ? { closedAt: summary.closedAt } : {}),
  };
}

export async function readTodoSummaries(
  stateDir: string,
  sessionKey?: string,
): Promise<TodoSummary[]> {
  const state = await readTodoState(stateDir);
  const summaries: TodoSummary[] = [];

  for (const summary of state.todos) {
    if (sessionKey && !todoBelongsToSession(summary, sessionKey)) {
      continue;
    }

    try {
      const todo = await readTodo(stateDir, summary.todoId);
      if (!sessionKey || todoBelongsToSession(todo, sessionKey)) {
        summaries.push(summarizeTodo(stateDir, todo));
      }
    } catch {
      summaries.push(normalizeSummary(summary));
    }
  }

  return summaries;
}

export async function writeTodo(stateDir: string, todo: TodoList): Promise<void> {
  const todoDir = getTodoDir(stateDir, todo.todoId);
  await fs.mkdir(todoDir, { recursive: true });
  await writeJsonAtomic(getTodoPath(stateDir, todo.todoId), todo);
}

export async function createTodoWorkspace(stateDir: string, todo: TodoList): Promise<TodoSummary> {
  const todoDir = getTodoDir(stateDir, todo.todoId);
  await fs.mkdir(getArtifactsDir(stateDir, todo.todoId), { recursive: true });
  await writeTodo(stateDir, todo);

  const summary = summarizeTodo(stateDir, todo);

  const state = await readTodoState(stateDir);
  const existing = state.todos.findIndex((item) => item.todoId === todo.todoId);
  if (existing >= 0) {
    state.todos[existing] = summary;
  } else {
    state.todos.push(summary);
  }
  await writeTodoState(stateDir, state);

  return {
    ...summary,
    todoPath: path.join(todoDir, TODO_FILE),
  };
}

export async function updateTodoSummary(
  stateDir: string,
  todo: TodoList,
): Promise<void> {
  const state = await readTodoState(stateDir);
  const summary = summarizeTodo(stateDir, todo);
  const existing = state.todos.findIndex((item) => item.todoId === todo.todoId);
  if (existing >= 0) {
    state.todos[existing] = summary;
    await writeTodoState(stateDir, state);
  }
}
