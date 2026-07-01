import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import plugin from "../index.js";
import { DEFAULT_SESSION_ID } from "../src/constants.js";
import { createTodoHttpHandler, resolveTodoHttpResponse } from "../src/http.js";
import {
  getSessionPath,
  getTodoPath,
  readTodo,
  readTodoSummaries,
} from "../src/todo-state.js";
import { createTodoCompleteTool } from "../src/tools/todo-complete.js";
import { createTodoCreateTool } from "../src/tools/todo-create.js";
import { createTodoGetTool } from "../src/tools/todo-get.js";
import { createTodoUpdateTool } from "../src/tools/todo-update.js";

function parseToolResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]!.text);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type HookHandler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;

function registerPluginForTest(stateDir: string) {
  const hooks = new Map<string, HookHandler[]>();
  plugin.register({
    stateDir,
    registerTool() {},
    registerHttpRoute() {},
    on(name: string, handler: HookHandler) {
      hooks.set(name, [...(hooks.get(name) ?? []), handler]);
    },
    logger: {
      info() {},
      warn() {},
    },
  });
  return { hooks };
}

async function emitHook(hooks: Map<string, HookHandler[]>, name: string, event: unknown, ctx: unknown) {
  for (const handler of hooks.get(name) ?? []) {
    await handler(event, ctx);
  }
}

const SESSION_A = "11111111-1111-1111-1111-111111111111";
const SESSION_B = "22222222-2222-2222-2222-222222222222";
const UNKNOWN_SESSION = "33333333-3333-3333-3333-333333333333";

describe("astron-todo-sync", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "astron-todo-sync-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("exposes single-agent tool names and excludes agent-team progress", () => {
    const createTool = createTodoCreateTool(tmpDir);
    const updateTool = createTodoUpdateTool(tmpDir);
    const completeTool = createTodoCompleteTool(tmpDir);
    const getTool = createTodoGetTool(tmpDir);

    assert.equal(createTool.name, "astron_single_agent_todo_create");
    assert.equal(updateTool.name, "astron_single_agent_todo_update");
    assert.equal(completeTool.name, "astron_single_agent_todo_complete");
    assert.equal(getTool.name, "astron_single_agent_todo_get");

    assert.equal(
      createTool.description,
      "禁止在Team会话场景中使用，适用于单Agent为非即时性query生成新的待办事项。例如对实时/最新/当日信息的查询，例如股价、调研、分析、规划、文件生成、命令/代码执行、清单核对、对比分析、故障排查，以及诸如继续、补充、重存、制作表格等后续工作。",
    );
    for (const tool of [updateTool, completeTool, getTool]) {
      assert.match(tool.description, /agent-team/);
    }
    assert.match(getTool.description, /不要用本工具查询 agent-team 任务进度/);
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

    const todo = await readTodo(tmpDir, DEFAULT_SESSION_ID, result.todoId);
    assert.equal(todo.task, "Build a release checklist");
    assert.equal(todo.sessionId, DEFAULT_SESSION_ID);
    assert.equal("sessionKey" in todo, false);
    assert.equal(todo.status, "running");
    assert.equal(todo.items.length, 2);
    assert.equal(todo.items[0].id, "item-1");
    assert.equal(todo.items[1].description, "Run focused verification");

    await fs.access(getTodoPath(tmpDir, DEFAULT_SESSION_ID, result.todoId));
    const sessionPath = getSessionPath(tmpDir, DEFAULT_SESSION_ID);
    const session = JSON.parse(await fs.readFile(sessionPath, "utf-8"));
    assert.equal(path.basename(path.dirname(sessionPath)), DEFAULT_SESSION_ID);
    assert.equal(session.sessionId, DEFAULT_SESSION_ID);
    assert.equal("sessionKey" in session, false);

    const summaries = await readTodoSummaries(tmpDir, DEFAULT_SESSION_ID);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]!.todoId, result.todoId);
    assert.equal(summaries[0]!.itemCount, 2);
    assert.equal(summaries[0]!.pendingItemCount, 2);
    assert.equal(summaries[0]!.completedItemCount, 0);
    assert.equal(summaries[0]!.failedItemCount, 0);
  });

  it("accepts and ignores extra create item fields", async () => {
    const tool = createTodoCreateTool(tmpDir);
    const schema = tool.parameters as any;
    const objectItemSchema = schema.properties.items.items.anyOf[1];
    assert.notEqual(objectItemSchema.additionalProperties, false);

    const result = parseToolResult(
      await tool.execute("call-1", {
        task: "Compare stocks",
        items: [
          {
            id: "item-1",
            title: "Search recent stock prices",
            status: "in_progress",
            artifactPaths: ["/tmp/report.md"],
          },
        ],
      }),
    );

    assert.equal(result.success, true);
    const todo = await readTodo(tmpDir, DEFAULT_SESSION_ID, result.todoId);
    assert.equal(todo.items.length, 1);
    assert.equal(todo.items[0].id, "item-1");
    assert.equal(todo.items[0].title, "Search recent stock prices");
    assert.equal(todo.items[0].status, "pending");
    assert.equal(todo.items[0].artifactPaths.length, 0);
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
      { method: "GET", url: "/plugins/astron-todo-sync/todos" } as any,
      res as any,
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /session_id is required/);
  });

  it("isolates todo lists and updates by session id", async () => {
    const sessionA = SESSION_A;
    const sessionB = SESSION_B;
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
    assert.equal(created.todo.sessionId, sessionA);
    assert.equal("sessionKey" in created.todo, false);

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
    assert.match(crossSessionUpdate.error, /not found|not available in this session/);
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
            artifact_paths: ["/tmp/analysis.md"],
          },
        ],
      }),
    );

    const item = updated.todo.items[0];
    assert.equal(item.status, "completed");
    assert.deepEqual(item.artifactPaths, ["/tmp/analysis.md"]);
    assert.equal(typeof item.startedAt, "string");
    assert.equal(typeof item.completedAt, "string");

    const summaries = await readTodoSummaries(tmpDir, DEFAULT_SESSION_ID);
    assert.equal(summaries[0]!.itemCount, 1);
    assert.equal(summaries[0]!.completedItemCount, 1);
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
      const raw = await fs.readFile(getTodoPath(tmpDir, DEFAULT_SESSION_ID, created.todoId), "utf-8");
      assert.doesNotThrow(() => JSON.parse(raw));
    }

    const todo = await readTodo(tmpDir, DEFAULT_SESSION_ID, created.todoId);
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
            },
          ],
        }),
      ),
    );

    const raw = await fs.readFile(getTodoPath(tmpDir, DEFAULT_SESSION_ID, created.todoId), "utf-8");
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
        { item_index: 2, status: "failed" },
      ],
    });

    const beforeComplete = await readTodo(tmpDir, DEFAULT_SESSION_ID, created.todoId);
    assert.equal(beforeComplete.status, "running");

    const completed = parseToolResult(
      await completeTool.execute("call-3", {
        todo_id: created.todoId,
      }),
    );

    assert.equal(completed.success, true);
    assert.equal(completed.status, "failed");

    const todo = await readTodo(tmpDir, DEFAULT_SESSION_ID, created.todoId);
    assert.equal(todo.status, "failed");
    assert.equal(typeof todo.closedAt, "string");

    const summaries = await readTodoSummaries(tmpDir, DEFAULT_SESSION_ID);
    assert.equal(summaries[0]!.status, "failed");
    assert.equal(summaries[0]!.completedItemCount, 1);
    assert.equal(summaries[0]!.failedItemCount, 1);
    assert.equal(typeof summaries[0]!.closedAt, "string");
  });

  it("retries completion after a delayed terminal update", async () => {
    const createTool = createTodoCreateTool(tmpDir);
    const updateTool = createTodoUpdateTool(tmpDir);
    const completeTool = createTodoCompleteTool(tmpDir);
    const created = parseToolResult(
      await createTool.execute("call-1", {
        task: "Finish with concurrent tool calls",
        items: ["Draft", "Review"],
      }),
    );

    const completePromise = completeTool.execute("call-2", {
      todo_id: created.todoId,
    });
    const updatePromise = wait(50).then(() =>
      updateTool.execute("call-3", {
        todo_id: created.todoId,
        updates: [
          { item_index: 1, status: "completed" },
          { item_index: 2, status: "completed" },
        ],
      }),
    );

    const completed = parseToolResult(await completePromise);
    await updatePromise;

    assert.equal(completed.success, true);
    assert.equal(completed.status, "completed");

    const todo = await readTodo(tmpDir, DEFAULT_SESSION_ID, created.todoId);
    assert.equal(todo.status, "completed");
    assert.equal(typeof todo.closedAt, "string");
  });

  it("does not update a closed todo", async () => {
    const createTool = createTodoCreateTool(tmpDir);
    const updateTool = createTodoUpdateTool(tmpDir);
    const completeTool = createTodoCompleteTool(tmpDir);
    const created = parseToolResult(
      await createTool.execute("call-1", {
        task: "Keep closed todo immutable",
        items: ["Draft"],
      }),
    );

    await updateTool.execute("call-2", {
      todo_id: created.todoId,
      updates: [{ item_index: 1, status: "completed" }],
    });
    await completeTool.execute("call-3", {
      todo_id: created.todoId,
    });

    const beforeUpdate = await readTodo(tmpDir, DEFAULT_SESSION_ID, created.todoId);
    const updated = parseToolResult(
      await updateTool.execute("call-4", {
        todo_id: created.todoId,
        updates: [{ item_index: 1, status: "in_progress" }],
      }),
    );
    const afterUpdate = await readTodo(tmpDir, DEFAULT_SESSION_ID, created.todoId);

    assert.match(updated.error, /already closed/);
    assert.deepEqual(afterUpdate, beforeUpdate);
  });

  it("returns existing closed todo when complete is called again", async () => {
    const createTool = createTodoCreateTool(tmpDir);
    const updateTool = createTodoUpdateTool(tmpDir);
    const completeTool = createTodoCompleteTool(tmpDir);
    const created = parseToolResult(
      await createTool.execute("call-1", {
        task: "Complete once",
        items: ["Draft"],
      }),
    );

    await updateTool.execute("call-2", {
      todo_id: created.todoId,
      updates: [{ item_index: 1, status: "completed" }],
    });
    await completeTool.execute("call-3", {
      todo_id: created.todoId,
    });

    const firstClosed = await readTodo(tmpDir, DEFAULT_SESSION_ID, created.todoId);
    const completedAgain = parseToolResult(
      await completeTool.execute("call-4", {
        todo_id: created.todoId,
      }),
    );
    const secondClosed = await readTodo(tmpDir, DEFAULT_SESSION_ID, created.todoId);

    assert.equal(completedAgain.success, true);
    assert.equal(completedAgain.status, "completed");
    assert.deepEqual(secondClosed, firstClosed);
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
    const todo = await readTodo(tmpDir, DEFAULT_SESSION_ID, created.todoId);
    assert.equal(todo.status, "running");
  });

  it("fails the latest open todo on agent_end", async () => {
    const { hooks } = registerPluginForTest(tmpDir);
    const createTool = createTodoCreateTool(tmpDir, SESSION_A);
    const first = parseToolResult(
      await createTool.execute("call-1", {
        task: "Older unfinished task",
        items: ["Old step"],
      }),
    );
    await wait(10);
    const latest = parseToolResult(
      await createTool.execute("call-2", {
        task: "Latest unfinished task",
        items: ["Latest step"],
      }),
    );

    await emitHook(hooks, "agent_end", { success: true }, { sessionId: SESSION_A });

    const olderTodo = await readTodo(tmpDir, SESSION_A, first.todoId);
    const latestTodo = await readTodo(tmpDir, SESSION_A, latest.todoId);
    assert.equal(olderTodo.status, "running");
    assert.equal(latestTodo.status, "failed");
    assert.equal(latestTodo.items[0]!.status, "failed");
    assert.equal(typeof latestTodo.items[0]!.completedAt, "string");
    assert.equal(typeof latestTodo.closedAt, "string");

    const statusResponse = await resolveTodoHttpResponse(
      tmpDir,
      "GET",
      `/plugins/astron-todo-sync/todos?session_id=${SESSION_A}`,
    );
    assert.equal((statusResponse.body as any).todos[0].todoId, latest.todoId);
    assert.equal((statusResponse.body as any).todos[0].status, "failed");
  });

  it("does not change the latest closed todo on agent_end", async () => {
    const { hooks } = registerPluginForTest(tmpDir);
    const createTool = createTodoCreateTool(tmpDir);
    const updateTool = createTodoUpdateTool(tmpDir);
    const completeTool = createTodoCompleteTool(tmpDir);
    const created = parseToolResult(
      await createTool.execute("call-1", {
        task: "Closed before agent_end",
        items: ["Done"],
      }),
    );

    await updateTool.execute("call-2", {
      todo_id: created.todoId,
      updates: [{ item_index: 1, status: "completed" }],
    });
    await completeTool.execute("call-3", {
      todo_id: created.todoId,
    });

    const beforeHook = await readTodo(tmpDir, DEFAULT_SESSION_ID, created.todoId);
    await emitHook(hooks, "agent_end", { success: false }, { sessionId: DEFAULT_SESSION_ID });
    const afterHook = await readTodo(tmpDir, DEFAULT_SESSION_ID, created.todoId);

    assert.deepEqual(afterHook, beforeHook);
  });

  it("serves session todos over the HTTP resolver", async () => {
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
      `/plugins/astron-todo-sync/todos?session_id=${DEFAULT_SESSION_ID}`,
    );
    assert.equal(statusResponse.statusCode, 200);
    assert.equal((statusResponse.body as any).sessionId, DEFAULT_SESSION_ID);
    assert.equal((statusResponse.body as any).todos[0].todoId, created.todoId);

    const oldStatusResponse = await resolveTodoHttpResponse(
      tmpDir,
      "GET",
      `/plugins/astron-todo-sync/todos/${created.todoId}/status`,
    );
    assert.equal(oldStatusResponse.statusCode, 404);

    const missingSessionKeyResponse = await resolveTodoHttpResponse(
      tmpDir,
      "GET",
      "/plugins/astron-todo-sync/todos",
    );
    assert.equal(missingSessionKeyResponse.statusCode, 400);

    const emptySessionResponse = await resolveTodoHttpResponse(
      tmpDir,
      "GET",
      `/plugins/astron-todo-sync/todos?session_id=${UNKNOWN_SESSION}`,
    );
    assert.equal(emptySessionResponse.statusCode, 200);
    assert.deepEqual((emptySessionResponse.body as any).todos, []);

    const invalidSessionResponse = await resolveTodoHttpResponse(
      tmpDir,
      "GET",
      "/plugins/astron-todo-sync/todos?session_id=not-a-uuid",
    );
    assert.equal(invalidSessionResponse.statusCode, 400);
  });

  it("rejects legacy session_key HTTP requests", async () => {
    const statusResponse = await resolveTodoHttpResponse(
      tmpDir,
      "GET",
      "/plugins/astron-todo-sync/todos?session_key=agent%3Amain%3Aexplicit%3A44444444-4444-4444-4444-444444444444",
    );

    assert.equal(statusResponse.statusCode, 400);
    assert.equal((statusResponse.body as any).error, "session_id is required");
  });

  it("omits legacy item message fields from todo status responses", async () => {
    const createTool = createTodoCreateTool(tmpDir);
    const created = parseToolResult(
      await createTool.execute("call-1", {
        task: "Poll legacy todo state",
        items: ["One"],
      }),
    );

    const todoPath = getTodoPath(tmpDir, DEFAULT_SESSION_ID, created.todoId);
    const legacyTodo = JSON.parse(await fs.readFile(todoPath, "utf-8"));
    legacyTodo.items[0].message = "legacy detail";
    await fs.writeFile(todoPath, `${JSON.stringify(legacyTodo, null, 2)}\n`, "utf-8");

    const statusResponse = await resolveTodoHttpResponse(
      tmpDir,
      "GET",
      `/plugins/astron-todo-sync/todos?session_id=${DEFAULT_SESSION_ID}`,
    );

    assert.equal(statusResponse.statusCode, 200);
    assert.equal("message" in (statusResponse.body as any).todos[0].items[0], false);
  });
});
