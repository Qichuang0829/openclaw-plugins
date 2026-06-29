# conversation-todo-sync 设计方案

## 定位

`conversation-todo-sync` 是一个会话 todo 状态同步插件。它不负责替 Agent 思考、拆解或编排任务，而是把 Agent 已经决定要推进的多步骤事项保存成结构化 todo，让用户界面或 HTTP 客户端可以读取“现在做到哪一步、哪些已经完成、哪些失败”。

适用场景：

- 日常多步骤任务：出门准备、搬家检查、聚会筹备、会议流程、资料整理。
- 需要持续展示状态的任务：查询多份资料、比较多个选项、生成多个交付物。
- 续接任务：用户问“继续刚才的任务”“现在做到哪了”“把刚才那件事补一项”。

不适用场景：

- 单句问答、翻译、改写、命名。
- 纯解释问题，没有明显的多步骤执行状态。
- Agent 只是内部想一想，不需要向用户同步 todo 状态。

## 总体结构

```text
OpenClaw Plugin Runtime
  |-- registerTool(astronclaw_todo_create)
  |-- registerTool(astronclaw_todo_update)
  |-- registerTool(astronclaw_todo_complete)
  |-- registerTool(astronclaw_todo_get)
  |-- registerHttpRoute(/plugins/conversation-todo-sync/todos)
  |
  `-- stateDir/
      `-- conversation-todos/
          `-- sessions/
              `-- <sessionId>/
                  |-- session.json
                  `-- <todoId>/
                      |-- todo.json
                      `-- artifacts/
```

工具给 Agent 使用，HTTP 给 UI 或外部客户端读取。文件持久化放在 OpenClaw runtime state 目录下，避免写入插件安装目录。

## 存储位置

插件通过 `api.runtime.state.resolveStateDir()` 获取 OpenClaw 的运行时状态目录。如果运行时没有提供该 API，则回退到 `api.stateDir`，再回退到 `.openclaw`。

示例：

```text
/home/selfwsl/.openclaw/
  conversation-todos/
    sessions/
      35e2872a-2f6a-45ff-80be-a9a6aaa7401c/
        session.json
        dinner-checklist-a1b2c3/
          todo.json
          artifacts/
```

`session.json` 保存 `sessionId` 元信息。`todo.json` 是单个 todo 的完整状态。目录名直接使用 OpenClaw 原生 `sessionId`，插件会校验它是 UUID 形态，避免把非法字符串当成路径。

## 数据模型

### TodoItemStatus

```ts
type TodoItemStatus = "pending" | "in_progress" | "completed" | "failed";
```

表示单个事项的状态：

- `pending`: 还没开始。
- `in_progress`: 正在处理。
- `completed`: 已完成。
- `failed`: 该事项失败或无法继续。

### TodoStatus

```ts
type TodoStatus = "pending" | "running" | "completed" | "failed";
```

表示整个 todo 列表的状态：

- `pending`: 已创建但尚未推进。
- `running`: 至少有一个事项正在推进。
- `completed`: 所有事项都进入终态，且没有失败。
- `failed`: 至少一个事项失败，或整体任务失败。

### TodoItem

```ts
type TodoItem = {
  id: string;
  title: string;
  description: string;
  status: TodoItemStatus;
  startedAt: string | null;
  completedAt: string | null;
  artifactPaths: string[];
};
```

这是用户可理解的一个 todo 项。`artifactPaths` 用于关联生成的本地文件，例如清单、表格、报告。

### TodoList

```ts
type TodoList = {
  todoId: string;
  sessionId: string;
  task: string;
  status: TodoStatus;
  items: TodoItem[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
};
```

这是单个任务的完整 todo 状态。工具更新和 HTTP 详情接口都以它为核心。

### TodoSummary

```ts
type TodoSummary = {
  todoId: string;
  sessionId: string;
  task: string;
  status: TodoStatus;
  itemCount: number;
  pendingItemCount: number;
  inProgressItemCount: number;
  completedItemCount: number;
  failedItemCount: number;
  todoPath: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
};
```

这是 `astronclaw_todo_get` 返回的轻量摘要。插件不再维护全局 `todo-state.json`，而是按 session 目录枚举该会话下的 `todo.json` 并即时生成摘要。

## 工具协议

### astronclaw_todo_create

用途：为当前会话创建一个新的 todo 列表。

典型输入：

```json
{
  "todo_id": "dinner-checklist",
  "task": "安排今晚家庭晚餐",
  "items": [
    "确认人数和口味",
    "整理菜单和采购清单",
    "安排烹饪时间线",
    "给出上桌前检查项"
  ]
}
```

关键规则：

- 全新多步骤任务应直接创建，不需要先查询。
- `todo_id` 是可选基础 ID，工具会追加短随机后缀生成完整 `todoId`。
- 后续更新必须使用工具返回的完整 `todoId`。

### astronclaw_todo_update

用途：更新一个或多个 todo 项，也可以追加新事项。

典型输入：

```json
{
  "todo_id": "dinner-checklist-a1b2c3",
  "updates": [
    {
      "item_index": 0,
      "status": "completed"
    },
    {
      "item_index": 1,
      "status": "in_progress"
    }
  ]
}
```

关键规则：

- 可用 `item_id` 或 `item_index` 定位事项。
- 一次调用可以批量更新多个事项。
- 若执行中发现新事项，可以通过 `append_items` 追加。

### astronclaw_todo_get

用途：读取当前会话已有 todo，主要用于续接任务或回答状态查询。

典型输入：

```json
{}
```

或：

```json
{
  "todo_id": "dinner-checklist-a1b2c3"
}
```

关键规则：

- 新任务不要固定先调用它。
- 用户说“继续刚才的任务”“现在做到哪了”时，应先调用它。
- 不传 `todo_id` 返回当前 session 的 todo 摘要列表。

### astronclaw_todo_complete

用途：标记整个 todo 已结束，并更新 `closedAt`。

典型输入：

```json
{
  "todo_id": "dinner-checklist-a1b2c3"
}
```

关键规则：

- 只有所有事项都处于 `completed` 或 `failed` 后才能调用。
- 它不要求 Agent 再写一份 summary。
- Agent 给用户的最终答复仍然直接发给用户，工具只保存结构化状态。

## HTTP 协议

HTTP 只作为前端轮询接口使用。前端使用当前对话的 `session_id` 查询该会话下所有 todo。

```http
GET /plugins/conversation-todo-sync/todos?session_id=<sessionId>
```

返回规则：

- 成功返回 `{ sessionId, todos }`，其中 `todos` 是该 session 下的完整 `TodoList[]`。
- 缺少或传空 `session_id` 返回 `400`。
- `session_id` 不是 UUID 形态时返回 `400`。
- 找不到该 session 时返回空 `todos` 数组。
- 不支持的方法返回 `405`。

前端轮询流程：

```ts
async function pollTodos(sessionId: string) {
  const res = await fetch(`/plugins/conversation-todo-sync/todos?session_id=${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error(`todo status request failed: ${res.status}`);

  const { todos } = await res.json();
  const done = todos.every((todo) => todo.status === "completed" || todo.status === "failed");
  return { state: done ? "done" : "running", todos };
}
```

轮询建议：

- 前端拿到当前对话 `session_id` 后，只调用这一条接口。
- `pending` 或 `running` 时继续轮询。
- `completed` 或 `failed` 时停止轮询。

## 会话隔离

工具层按 `sessionId` 隔离。每次工具注册时都会从 OpenClaw tool context 读取当前 `sessionId`，并写入 todo 状态。

隔离规则：

- `astronclaw_todo_create` 创建的 todo 绑定当前 `sessionId`。
- `astronclaw_todo_get` 默认只列当前会话的 todo。
- `astronclaw_todo_update` 只能更新当前会话拥有的 todo。
- `astronclaw_todo_complete` 只能完成当前会话拥有的 todo。

这样做的原因是 OpenClaw 可能同时服务多个会话。工具层必须防止 Agent 在不同会话之间误读或误改 todo。HTTP 前端接口也按 `session_id` 读取对应 session 目录，避免全局扫描所有 todo。

## 日常任务完整流程

用户输入：

```text
帮我安排今晚 19:00 到 20:30 的家庭整理任务。两个成人，一个 8 岁孩子，不要反问，直接完成。最后给我任务分工、时间安排、物品清单和检查标准。
```

推荐工具流程：

```text
astronclaw_todo_create
  创建 4 个事项：分工、时间线、物品清单、检查标准

astronclaw_todo_update
  标记“分工”完成，标记“时间线”进行中

astronclaw_todo_update
  标记“时间线”完成，标记“物品清单”完成，标记“检查标准”进行中

astronclaw_todo_update
  标记所有剩余事项完成

astronclaw_todo_complete
  完成整个 todo

最终答复
  直接把家庭整理方案发给用户
```

用户看到的是最终整理方案；前端拿到当前对话 `session_id` 后，可以通过单一 HTTP 状态接口轮询该会话下的 todo，知道每个事项是否完成。

## 设计取舍

- 不把工具使用规则塞进全局系统提示词。工具描述和 skill 已经提供触发条件，状态记录也在工具结果和持久化文件中。
- 不保存重复的最终 summary 文件。最终答复属于对话内容，todo 插件只保存结构化事项状态。
- 不把 todo 当成任务编排器。真正的执行逻辑仍由 Agent 和其它工具完成，本插件只负责同步状态。
- 保留单一 HTTP 状态查询入口，便于前端按 `session_id` 轮询展示该会话下的所有 todo。

## 验收标准

- 复杂日常任务能自动创建、更新并完成 todo。
- 简单问答不会误触发 todo 工具。
- 续接任务能先读取已有 todo，而不是重复创建。
- HTTP 状态接口能按 `session_id` 准确反映当前会话下所有 todo 的状态。
- 用户最终回复不泄漏 `astronclaw_todo_create`、`astronclaw_todo_update`、`astronclaw_todo_complete`、`astronclaw_todo_get`、`todoId`、`todo.json` 等内部实现细节。
