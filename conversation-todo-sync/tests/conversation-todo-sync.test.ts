import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { createTodoHttpHandler, resolveTodoHttpResponse } from "../src/http.js";
import {
  getTodoPath,
  readTodo,
  readTodoState,
} from "../src/todo-state.js";
import { createTodoCompleteTool } from "../src/tools/todo-complete.js";
import { createTodoCreateTool } from "../src/tools/todo-create.js";
import { createTodoGetTool } from "../src/tools/todo-get.js";
import { createTodoUpdateTool } from "../src/tools/todo-update.js";

function parseToolResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]!.text);
}

describe("conversation-todo-sync", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "conversation-todo-sync-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates todo state and todo.json", async () => {
    const tool = createTodoCreateTool(tmpDir);
    const result = parseToolResult(
      await tool.execute("call-1", {
        task: "Build a release checklist",
        items: ["Inspect repo", { title: "Run tests", description: "Run focused verification" }],
      }),
    );

    assert.equal(result.success, true);
    assert.match(result.todoId, /^todo-[0-9a-f]{6}$/);

    const todo = await readTodo(tmpDir, result.todoId);
    assert.equal(todo.task, "Build a release checklist");
    assert.equal(todo.status, "running");
    assert.equal(todo.items.length, 2);
    assert.equal(todo.items[0].id, "item-1");
    assert.equal(todo.items[1].description, "Run focused verification");

    await fs.access(getTodoPath(tmpDir, result.todoId));
    const state = await readTodoState(tmpDir);
    assert.equal(state.todos.length, 1);
    assert.equal(state.todos[0]!.todoId, result.todoId);
    assert.equal(state.todos[0]!.itemCount, 2);
    assert.equal(state.todos[0]!.pendingItemCount, 2);
    assert.equal(state.todos[0]!.completedItemCount, 0);
    assert.equal(state.todos[0]!.failedItemCount, 0);
  });

  it("creates todo IDs from an optional base ID", async () => {
    const tool = createTodoCreateTool(tmpDir);
    const result = parseToolResult(
      await tool.execute("call-1", {
        todo_id: "release-checklist",
        task: "Build a release checklist",
      }),
    );

    assert.equal(result.success, true);
    assert.match(result.todoId, /^release-checklist-[0-9a-f]{6}$/);
  });

  it("rejects invalid base todo IDs", async () => {
    const tool = createTodoCreateTool(tmpDir);
    const result = parseToolResult(
      await tool.execute("call-1", {
        todo_id: "../outside",
        task: "Invalid todo",
      }),
    );

    assert.match(result.error, /lowercase alphanumeric/);
  });

  it("marks handled HTTP error responses as handled", async () => {
    const handler = createTodoHttpHandler(tmpDir);
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      body: "",
      setHeader(name: string, value: string) {
        this.headers[name.toLowerCase()] = value;
      },
      end(body: string) {
        this.body = body;
      },
    };

    const handled = await handler(
      { method: "GET", url: "/plugins/conversation-todo-sync/todos/not-a-valid-id/status" } as any,
      res as any,
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /todo_id must be lowercase/);
  });

  it("isolates todo lists and updates by session key", async () => {
    const sessionA = "conversation-a";
    const sessionB = "conversation-b";
    const createTool = createTodoCreateTool(tmpDir, sessionA);
    const getForA = createTodoGetTool(tmpDir, sessionA);
    const getForB = createTodoGetTool(tmpDir, sessionB);
    const updateForB = createTodoUpdateTool(tmpDir, sessionB);

    const created = parseToolResult(
      await createTool.execute("call-1", {
        task: "Session-scoped task",
        items: ["One"],
      }),
    );
    assert.equal(created.todo.sessionKey, sessionA);

    const listA = parseToolResult(await getForA.execute("call-2", {}));
    const listB = parseToolResult(await getForB.execute("call-3", {}));
    assert.equal(listA.todos.length, 1);
    assert.equal(listB.todos.length, 0);

    const crossSessionUpdate = parseToolResult(
      await updateForB.execute("call-4", {
        todo_id: created.todoId,
        updates: [{ item_index: 1, status: "completed" }],
      }),
    );
    assert.match(crossSessionUpdate.error, /not available in this session/);
  });

  it("updates item status timestamps and appends late todo items", async () => {
    const createTool = createTodoCreateTool(tmpDir);
    const updateTool = createTodoUpdateTool(tmpDir);
    const created = parseToolResult(
      await createTool.execute("call-1", {
        task: "Handle a task without initial items",
      }),
    );
    assert.equal(created.todo.status, "pending");

    const appended = parseToolResult(
      await updateTool.execute("call-2", {
        todo_id: created.todoId,
        append_items: [{ id: "analysis", title: "Analyze task" }],
      }),
    );
    assert.equal(appended.todo.status, "running");
    assert.equal(appended.todo.items.length, 1);

    const updated = parseToolResult(
      await updateTool.execute("call-3", {
        todo_id: created.todoId,
        updates: [
          {
            item_id: "analysis",
            status: "completed",
            message: "Analysis done",
            artifact_paths: ["/tmp/analysis.md"],
          },
        ],
      }),
    );

    const item = updated.todo.items[0];
    assert.equal(item.status, "completed");
    assert.equal(item.message, "Analysis done");
    assert.deepEqual(item.artifactPaths, ["/tmp/analysis.md"]);
    assert.equal(typeof item.startedAt, "string");
    assert.equal(typeof item.completedAt, "string");

    const state = await readTodoState(tmpDir);
    assert.equal(state.todos[0]!.itemCount, 1);
    assert.equal(state.todos[0]!.completedItemCount, 1);
  });

  it("keeps todo.json readable after repeated updates", async () => {
    const createTool = createTodoCreateTool(tmpDir);
    const updateTool = createTodoUpdateTool(tmpDir);
    const created = parseToolResult(
      await createTool.execute("call-1", {
        task: "Repeated todo updates",
        items: ["One", "Two", "Three"],
      }),
    );

    for (let index = 1; index <= 3; index++) {
      await updateTool.execute(`call-${index + 1}`, {
        todo_id: created.todoId,
        updates: [{ item_index: index, status: "in_progress" }],
      });
      await updateTool.execute(`call-${index + 10}`, {
        todo_id: created.todoId,
        updates: [{ item_index: index, status: "completed" }],
      });
      const raw = await fs.readFile(getTodoPath(tmpDir, created.todoId), "utf-8");
      assert.doesNotThrow(() => JSON.parse(raw));
    }

    const todo = await readTodo(tmpDir, created.todoId);
    assert.equal(todo.items.every((item) => item.status === "completed"), true);
  });

  it("keeps todo.json readable after concurrent updates", async () => {
    const createTool = createTodoCreateTool(tmpDir);
    const updateTool = createTodoUpdateTool(tmpDir);
    const created = parseToolResult(
      await createTool.execute("call-1", {
        task: "Concurrent todo updates",
        items: ["One"],
      }),
    );

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        updateTool.execute(`call-${index + 2}`, {
          todo_id: created.todoId,
          updates: [
            {
              item_index: 1,
              status: index % 2 === 0 ? "in_progress" : "completed",
              message: `update-${index}`,
            },
          ],
        }),
      ),
    );

    const raw = await fs.readFile(getTodoPath(tmpDir, created.todoId), "utf-8");
    assert.doesNotThrow(() => JSON.parse(raw));
  });

  it("completes a todo when all items are terminal", async () => {
    const createTool = createTodoCreateTool(tmpDir);
    const updateTool = createTodoUpdateTool(tmpDir);
    const completeTool = createTodoCompleteTool(tmpDir);
    const created = parseToolResult(
      await createTool.execute("call-1", {
        task: "Finish documentation",
        items: ["Draft", "Review"],
      }),
    );

    await updateTool.execute("call-2", {
      todo_id: created.todoId,
      updates: [
        { item_index: 1, status: "completed" },
        { item_index: 2, status: "failed", message: "Review unavailable but documented" },
      ],
    });

    const completed = parseToolResult(
      await completeTool.execute("call-3", {
        todo_id: created.todoId,
      }),
    );

    assert.equal(completed.success, true);
    assert.equal(completed.status, "failed");

    const todo = await readTodo(tmpDir, created.todoId);
    assert.equal(todo.status, "failed");
    assert.equal(typeof todo.closedAt, "string");

    const state = await readTodoState(tmpDir);
    assert.equal(state.todos[0]!.status, "failed");
    assert.equal(state.todos[0]!.completedItemCount, 1);
    assert.equal(state.todos[0]!.failedItemCount, 1);
    assert.equal(typeof state.todos[0]!.closedAt, "string");
  });

  it("rejects completion when items are incomplete", async () => {
    const createTool = createTodoCreateTool(tmpDir);
    const completeTool = createTodoCompleteTool(tmpDir);
    const created = parseToolResult(
      await createTool.execute("call-1", {
        task: "Incomplete task",
        items: ["Still pending"],
      }),
    );

    const completed = parseToolResult(
      await completeTool.execute("call-2", {
        todo_id: created.todoId,
      }),
    );

    assert.match(completed.error, /Cannot complete todo/);
    const todo = await readTodo(tmpDir, created.todoId);
    assert.equal(todo.status, "running");
  });

  it("serves todo status by todoId over the HTTP resolver", async () => {
    const createTool = createTodoCreateTool(tmpDir);
    const created = parseToolResult(
      await createTool.execute("call-1", {
        task: "Poll todo state",
        items: ["One"],
      }),
    );

    const statusResponse = await resolveTodoHttpResponse(
      tmpDir,
      "GET",
      `/plugins/conversation-todo-sync/todos/${created.todoId}/status`,
    );
    assert.equal(statusResponse.statusCode, 200);
    assert.equal((statusResponse.body as any).todoId, created.todoId);

    const detailResponse = await resolveTodoHttpResponse(
      tmpDir,
      "GET",
      `/plugins/conversation-todo-sync/todos/${created.todoId}`,
    );
    assert.equal(detailResponse.statusCode, 404);

    const listResponse = await resolveTodoHttpResponse(
      tmpDir,
      "GET",
      "/plugins/conversation-todo-sync/todos",
    );
    assert.equal(listResponse.statusCode, 404);

    const missingResponse = await resolveTodoHttpResponse(
      tmpDir,
      "GET",
      "/plugins/conversation-todo-sync/todos/does-not-exist-abcdef/status",
    );
    assert.equal(missingResponse.statusCode, 404);

    const invalidResponse = await resolveTodoHttpResponse(
      tmpDir,
      "GET",
      "/plugins/conversation-todo-sync/todos/..%2Foutside/status",
    );
    assert.equal(invalidResponse.statusCode, 400);
  });
});
