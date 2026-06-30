---
name: astron-todo-sync
description: MUST call astronclaw_todo_create before search/read/write/edit/command tools when a user message will make the user wait on external work or has complex work. This includes live/latest/today lookups such as stock prices, analysis, reports, file generation, checklists, troubleshooting, comparison, planning, and follow-up work like “继续补充并重新保存/整理成表格/再做一版”. One wait-worthy or complex user message = one new todo; never reuse or update an earlier todo for new work. Do not create todo for greetings, simple one-shot Q&A/translation/rewrite/naming/explanation, pure status questions, or obviously instant one-step replies.
---

## 使用原则

这些工具用于同步“当前任务 todo 状态”，不是规划推理工具。todo 内容应能被用户理解，并能通过 UI/HTTP 展示当前做到哪里。

除非用户明确询问插件实现细节，否则不要在最终回复或普通对话中提到 `astron-todo-sync`、`astronclaw_todo_create`、`astronclaw_todo_update`、`astronclaw_todo_get`、`astronclaw_todo_complete`、`todoId`、`todo.json` 或任何工具调用细节。

用户看到的自然语言回复应只包含任务本身的结果、结论、建议、下一步行动或必要免责声明。不要说“我已创建 todo”“我正在调用 astronclaw_todo_update”“我将调用 complete 工具”。

默认使用本工具组同步 todo 状态。一个需要用户等待外部工具结果或包含复杂执行过程的用户消息，对应一个新的 todo。这样的用户消息必须先调用 `astronclaw_todo_create`，再调用搜索、读取、写入、编辑、命令执行或其它外部工具。任务不一定要很大；只要用户会等待几秒以上、等待时间不确定，或需要让 UI/HTTP 客户端展示“正在查/正在处理”的进展，就创建轻量 todo。只有当前用户消息明显不需要拆分、不会让用户等待外部工具结果、也没有用户可见执行过程时，才可以不使用。

必须使用本工具组的场景：

- 任务可以拆成 2 个以上用户可见的实际步骤。
- 任务需要或可能需要调用搜索、网页读取、接口查询、文件读写、代码执行、命令执行、生成文件、调用其它工具等外部工具，并且用户会等待几秒以上或等待时间不确定。
- 任务是实时、最新、今天、当前状态类查询，且需要外部来源获取结果并整理给用户，例如股票股价/涨跌幅/交易状态、公司最新消息、新闻、政策、价格、榜单、公告、天气、汇率等。即使只查询一个对象或一个核心字段，只要会让用户等待外部结果，也要创建轻量 todo。
- 任务需要调用 `write`、`edit` 或其它文件修改工具。必须先为当前用户消息创建新的 todo，再写入或编辑文件。
- 任务需要查询、阅读、比较、归纳多个来源或多类信息。
- 任务需要围绕多个对象或多个指标搜集资料并整理结论，例如多家公司股价/涨跌/市值/近期消息对比。即使用户只要求一轮完成，也必须同步 todo。
- 任务需要先拆解，再执行，再汇总结论。
- 任务包含准备清单、时间顺序、携带物品、注意事项、检查流程、课前/出门前/活动前准备。
- 用户消息要求“继续、补充、重新保存、整理成表格、生成新文件、再做一版”等新的复杂执行动作。即使它引用上一轮结果，也必须创建新的 todo，不能直接编辑旧文件或更新旧 todo。
- 用户要求“完整流程”“逐步推进”“跟踪任务”“不要一次性草率完成”。
- 任务可能持续多轮，或用户后续可能询问当前进度。

可以不使用本工具组的场景仅限非常简单的一步对话，例如：

- 问候或闲聊，例如“你好”“你是谁”。
- 单个事实问答，且不需要搜索、网页、接口或其它会让用户等待的外部工具。
- 翻译一句话、改写一句话、起一个名字、解释一个简单概念。
- 明显非常快的一步回复，不需要展示“正在处理”的过程。
- 纯进度询问，例如“处理好了吗”“保存了吗”“现在到哪了”“刚才那个怎么样了”，且没有新的执行动作。
- 用户明确要求不要创建或同步 todo。

不要因为任务“逻辑线性”“一轮可以完成”“只是查一个数据”“不需要跨轮追踪”而跳过 todo。todo 的用途是把 OpenClaw 当前任务进度同步给 UI/HTTP 客户端，让用户感知执行过程，不是只用于跨轮任务。只要任务能拆分，或会让用户等待外部工具结果，就创建并维护 todo。

当用户给出的信息已经足够推进时，不要为了偏好细节反复提问。可以基于合理假设直接执行，并在最终回复中说明关键假设。只有缺少必要条件会导致任务无法继续、产生明显风险或用户明确要求确认时，才向用户提问。

每个新的复杂用户消息都创建新的 todo。不要复用上一条 todo，不要把新的复杂用户消息合并进旧 todo，也不要因为当前 session 中已经存在 `running`、`completed` 或 `failed` todo 而跳过创建。已关闭的 todo 不再更新。

所有工具都按当前 `sessionId` 隔离。`astronclaw_todo_get` 默认只返回当前会话的 todo；`astronclaw_todo_update`、`astronclaw_todo_complete` 只能操作当前会话中的 todo。

## 工作流

### 1. 全新任务创建 todo：`astronclaw_todo_create`

如果当前用户消息是新的复杂任务，或会让用户等待外部工具结果，先调用 `astronclaw_todo_create`，再调用搜索、读取、写文件、编辑文件、命令执行或其它外部工具。不要先调用 `astronclaw_todo_get` 来寻找可复用 todo；新的复杂或 wait-worthy 用户消息必须有自己的新 todo。todo items 应覆盖真实、用户可理解的执行阶段或检查项，而不是写 Agent 的思考步骤。对于只查询一个实时数据的轻量任务，可以创建 1-2 个简短 item，例如“查询今日行情”“整理结果并回复”。

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

### 2. 查询 todo 状态：`astronclaw_todo_get`

`astronclaw_todo_get` 不是 `astronclaw_todo_create` 的固定前置步骤。只有在用户询问进度、保存状态、刚才任务结果，或需要读取当前 session 的 todo 状态来回答状态问题时才调用。这个检查是内部行为，不要告诉用户。

优先调用 `astronclaw_todo_get` 的场景：

- 用户说“现在进度如何”“处理好了吗”“保存了吗”“刚才那个怎么样了”，且没有提出新的复杂执行动作。
- 当前上下文里没有可用的完整 `todoId`，但你需要回答某个已有 todo 的状态。
- 长对话、上下文压缩或工具结果缺失导致你不确定当前 todo 状态。

```text
astronclaw_todo_get()
```

如果用户消息包含新的复杂执行动作，例如“继续，补充风险提示并重新保存”“把刚才内容整理成表格”“再做一版报告”，不要复用旧 todo；应创建新的 todo 来跟踪这条用户消息。

### 3. 更新 todo：`astronclaw_todo_update`

每完成一个实际阶段后更新当前用户消息创建的 todo item。不要把工具更新内容原样转述给用户。优先使用稳定的 `item_id`，没有 ID 时使用 1-based `item_index`。

```text
astronclaw_todo_update(
  todo_id: "release-checklist-a1b2c3",
  updates: [
    { item_id: "inspect", status: "completed" }
  ]
)
```

如果同一条用户消息执行过程中范围发生变化，可以用 `append_items` 追加 todo item。新的用户消息不要 append 到旧 todo，应创建新的 todo。

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
- 不要复用上一条 todo 来跟踪新的复杂用户消息。
- 不要更新已经 `completed` 或 `failed` 的 todo。
- 不要在同一条用户消息中反复调用 `astronclaw_todo_create`。
- 不要在还有 `pending` 或 `in_progress` item 时调用 `astronclaw_todo_complete`。
- 不要把基础 `todo_id` 当作完整 `todoId` 使用。
- 不要为简单问答、单句解释、翻译、起名等一次性小任务创建 todo。
