---
name: astron-todo-sync
description: 默认在可拆分、会调用工具、多步骤执行、资料查询、分析比较、方案制定、准备清单、分阶段执行或跨多轮任务中创建并维护当前 conversation todo/checklist 状态。用于把 Agent 当前任务进度同步给用户界面或 HTTP 客户端查看；只有问候、闲聊、单个事实、翻译、命名、单句解释等非常简单的一步任务不要使用。
---

## 使用原则

这些工具用于同步“当前任务 todo 状态”，不是规划推理工具。todo 内容应能被用户理解，并能通过 UI/HTTP 展示当前做到哪里。

除非用户明确询问插件实现细节，否则不要在最终回复或普通对话中提到 `astron-todo-sync`、`astronclaw_todo_create`、`astronclaw_todo_update`、`astronclaw_todo_get`、`astronclaw_todo_complete`、`todoId`、`todo.json` 或任何工具调用细节。

用户看到的自然语言回复应只包含任务本身的结果、结论、建议、下一步行动或必要免责声明。不要说“我已创建 todo”“我正在调用 astronclaw_todo_update”“我将调用 complete 工具”。

默认使用本工具组同步 todo 状态。只有任务明显不需要拆分、不会调用任何外部工具、也没有用户可见执行过程时，才可以不使用。

必须使用本工具组的场景：

- 任务可以拆成 2 个以上用户可见的实际步骤。
- 任务需要或可能需要调用搜索、网页读取、接口查询、文件读写、代码执行、命令执行、生成文件、调用其它工具等外部工具。
- 任务需要查询、阅读、比较、归纳多个来源或多类信息。
- 任务需要围绕多个对象或多个指标搜集资料并整理结论，例如多家公司股价/涨跌/市值/近期消息对比。即使用户只要求一轮完成，也必须同步 todo。
- 任务需要先拆解，再执行，再汇总结论。
- 任务包含准备清单、时间顺序、携带物品、注意事项、检查流程、课前/出门前/活动前准备。
- 用户要求“完整流程”“逐步推进”“跟踪任务”“不要一次性草率完成”。
- 任务可能持续多轮，或用户后续可能询问当前进度。

可以不使用本工具组的场景仅限非常简单的一步对话，例如：

- 问候或闲聊，例如“你好”“你是谁”。
- 单个事实问答，且不需要搜索或其它工具。
- 翻译一句话、改写一句话、起一个名字、解释一个简单概念。
- 用户明确要求不要创建或同步 todo。

不要因为任务“逻辑线性”“一轮可以完成”“只是信息查询加整理”“不需要跨轮追踪”而跳过 todo。todo 的用途是把 OpenClaw 当前任务进度同步给 UI/HTTP 客户端，让用户感知执行过程，不是只用于跨轮任务。只要任务能拆分，或涉及工具调用，就创建并维护 todo。

当用户给出的信息已经足够推进时，不要为了偏好细节反复提问。可以基于合理假设直接执行，并在最终回复中说明关键假设。只有缺少必要条件会导致任务无法继续、产生明显风险或用户明确要求确认时，才向用户提问。

在当前会话中最多维护一个主要活跃 todo，除非用户明确切换到新的独立任务。不要因为进入新一轮对话就重新创建 todo。

所有工具都按当前 `sessionKey` 隔离。`astronclaw_todo_get` 默认只返回当前会话的 todo；`astronclaw_todo_update`、`astronclaw_todo_complete` 只能操作当前会话中的 todo。

## 工作流

### 1. 全新任务创建 todo：`astronclaw_todo_create`

如果用户明确发起一个全新的稍复杂任务，并且当前上下文没有活跃 todo，直接调用 `astronclaw_todo_create`，不要先调用 `astronclaw_todo_get`。todo items 应覆盖真实、用户可理解的执行阶段或检查项，而不是写 Agent 的思考步骤。

```text
astronclaw_todo_create(
  todo_id: "release-checklist",
  task: "Build and verify the release checklist",
  items: [
    { id: "inspect", title: "Inspect repository state" },
    { id: "verify", title: "Run focused verification" },
    { id: "summarize", title: "Summarize outcome" }
  ]
)
```

后续所有调用都必须使用返回的完整 `todoId`，例如 `release-checklist-a1b2c3`，不要只使用基础 ID。

### 2. 恢复或续接 todo：`astronclaw_todo_get`

`astronclaw_todo_get` 不是 `astronclaw_todo_create` 的固定前置步骤。只有在需要恢复、续接或确认已有 todo 时才调用。这个检查是内部行为，不要告诉用户。

优先调用 `astronclaw_todo_get` 的场景：

- 用户说“继续”“接着刚才”“现在进度如何”“恢复这个任务”。
- 当前上下文里没有可用的完整 `todoId`，但你需要继续一个可能已经存在的 todo。
- 用户的新消息看起来仍属于当前会话的同一个未完成任务。
- 长对话、上下文压缩或工具结果缺失导致你不确定当前 todo 状态。

```text
astronclaw_todo_get()
```

如果返回的 todo 中已有同一任务的 `pending` 或 `running` 项目，继续使用该 todo，不要新建。

### 3. 更新 todo：`astronclaw_todo_update`

每完成一个实际阶段后更新对应 todo item。不要把工具更新内容原样转述给用户。优先使用稳定的 `item_id`，没有 ID 时使用 1-based `item_index`。

```text
astronclaw_todo_update(
  todo_id: "release-checklist-a1b2c3",
  updates: [
    { item_id: "inspect", status: "completed" }
  ]
)
```

如果任务范围发生变化，可以用 `append_items` 追加 todo item，而不是重新创建 todo。

### 4. 查询 todo 状态：`astronclaw_todo_get`

当用户询问进度，或你需要恢复上下文时：

```text
astronclaw_todo_get(todo_id: "release-checklist-a1b2c3")
```

如果用户问“做到哪了”，可以用自然语言概括 todo 状态，但仍不要暴露工具名、todoId 或原始 JSON。

### 5. 完成 todo：`astronclaw_todo_complete`

只有当所有 todo item 都进入 `completed` 或 `failed` 后，才调用完成工具。该工具只负责关闭 todo 状态；没有失败项时关闭为 `completed`，存在失败项时关闭为 `failed`。最终答复直接发给用户，且只描述任务结果。

```text
astronclaw_todo_complete(
  todo_id: "release-checklist-a1b2c3"
)
```

## 常见错误

- 不要在用户可见回复中暴露工具名、todo ID、内部状态文件或“已调用某工具”。
- 不要跨会话使用其它会话返回的 `todoId`。
- 不要在同一任务中反复调用 `astronclaw_todo_create`。
- 不要在还有 `pending` 或 `in_progress` item 时调用 `astronclaw_todo_complete`。
- 不要把基础 `todo_id` 当作完整 `todoId` 使用。
- 不要为简单问答、单句解释、翻译、起名等一次性小任务创建 todo。
