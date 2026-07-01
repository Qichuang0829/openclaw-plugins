# Astron Todo Sync 描述评审摘录

本文档整理 `astron-todo-sync` 插件当前暴露给 OpenClaw、模型和 skill 机制的描述文本，供与 team 插件冲突评审使用。

## 插件级描述

### package.json

来源：`astron-todo-sync/package.json`

- name: `@openclaw/astron-todo-sync`
- description:

```text
OpenClaw plugin for synchronized single-agent conversation todo state.
```

### openclaw.plugin.json

来源：`astron-todo-sync/openclaw.plugin.json`

- id: `astron-todo-sync`
- name: `Astron Todo Sync`
- description:

```text
Synchronize JSON todo/checklist state for non-instant single-agent chat tasks. Agent-team workflows keep their own todo.md progress.
```

### 运行时插件入口

来源：`astron-todo-sync/index.ts`

- id: `astron-todo-sync`
- name: `Astron Todo Sync`
- description:

```text
Synchronize JSON todo progress for non-instant single-agent chat tasks; do not use for agent-team/team_* workflows, which manage their own todo.md progress.
```

备注：`astron-todo-sync/dist/index.js` 中的运行时 description 与 `index.ts` 一致。

## 工具描述

### astron_single_agent_todo_create

来源：`astron-todo-sync/src/tools/todo-create.ts`

- label: `Create Single-Agent Todo`
- description:

```text
禁止在Team会话场景中使用，适用于单Agent为非即时性query生成新的待办事项。例如对实时/最新/当日信息的查询，例如股价、调研、分析、规划、文件生成、命令/代码执行、清单核对、对比分析、故障排查，以及诸如继续、补充、重存、制作表格等后续工作。
```

参数描述：

| 参数 | 描述 |
| --- | --- |
| `todo_id` | `Optional base todo ID. Must be lowercase alphanumeric with hyphens; a random suffix is appended.` |
| `task` | `Original user task represented by this conversation todo list.` |
| `items` | `Initial todo items. Strings become item titles; objects can include id/title/description. Extra object fields such as status are accepted but ignored.` |
| `items[].id` | `Stable todo item ID. Defaults to item-N.` |
| `items[].title` | `Short user-visible todo item title.` |
| `items[].description` | `Optional todo item details.` |

### astron_single_agent_todo_update

来源：`astron-todo-sync/src/tools/todo-update.ts`

- label: `Update Single-Agent Todo`
- description:

```text
仅用于更新 astron_single_agent_todo_create 为当前单 Agent 用户消息创建的 todo。禁止在 agent-team 流程中使用。不要更新早前用户消息的 todo；继续、补充、重存、制作表格等新的后续工作应先创建新的单 Agent todo。已关闭 todo 不可修改。不要在用户可见消息中暴露工具名或 todoId。
```

参数描述：

| 参数 | 描述 |
| --- | --- |
| `todo_id` | `Todo ID returned by astron_single_agent_todo_create.` |
| `updates` | `Todo item status updates to apply.` |
| `updates[].item_id` | `Todo item ID to update.` |
| `updates[].item_index` | `1-based todo item index to update.` |
| `updates[].status` | `New todo item status.` |
| `updates[].artifact_paths` | `Artifact paths or URLs associated with this todo item.` |
| `append_items` | `Optional new todo items to append while executing the same current user message. Do not append items for a later user message; create a new todo instead.` |
| `append_items[].id` | `Stable todo item ID. Defaults to item-N.` |
| `append_items[].title` | `Short user-visible todo item title.` |
| `append_items[].description` | `Optional todo item details.` |

### astron_single_agent_todo_complete

来源：`astron-todo-sync/src/tools/todo-complete.ts`

- label: `Complete Single-Agent Todo`
- description:

```text
仅用于关闭当前单 Agent 用户消息创建的持久化 todo。禁止在 agent-team 流程中使用。只有所有 todo item 都已 completed 或 failed，且即将发送最终用户结果时才调用本工具。已关闭 todo 不可变；重复完成调用返回已有关闭状态。不要向用户暴露工具名、todoId 或内部状态。
```

参数描述：

| 参数 | 描述 |
| --- | --- |
| `todo_id` | `Todo ID returned by astron_single_agent_todo_create.` |

### astron_single_agent_todo_get

来源：`astron-todo-sync/src/tools/todo-get.ts`

- label: `Get Single-Agent Todo`
- description:

```text
仅用于读取单 Agent 主对话 todo 状态，通常用于进度、保存状态或刚才任务结果类问题。不要用本工具查询 agent-team 任务进度。如果用户提出新的执行工作，包括继续、补充、重存、制作表格，不要用本工具复用旧 todo，应先调用 astron_single_agent_todo_create 创建新的单 Agent todo。不要向用户暴露工具名、todoId 或原始内部状态。
```

参数描述：

| 参数 | 描述 |
| --- | --- |
| `todo_id` | `Todo ID to read. If omitted, lists todo summaries.` |

## 完整 Skill.md

来源：`astron-todo-sync/skills/astron-todo-sync/SKILL.md`

````markdown
---
name: astron-todo-sync
description: 当用户消息不是明显即问即答，且本轮任务不由 agent-team 流程处理时加载本技能。对每个单 Agent 非即时请求，在执行任务或调用搜索、读取、写入、编辑、命令执行等工具前，必须先调用 astron_single_agent_todo_create。适用场景包括实时、最新、今天类查询（如股价）、分析、报告、规划、文件生成、清单、排查、对比，以及“继续补充并重新保存/整理成表格/再做一版”等后续工作。如果 agent 决定调用 team_plan、team_provision、team_execute、team_update_progress、team_complete、team_cleanup 等 team 工具，不要使用本技能；该任务进度由 agent-team 的 todo.md 负责。只有问候、简单单步问答、翻译、改写、起名、概念解释、纯进度询问、用户明确不要 todo，或明显即时一步回复时才跳过。
---

## 使用原则

这些工具用于同步“当前任务 todo 状态”，不是规划推理工具。todo 内容应能被用户理解，并能通过 UI/HTTP 展示当前做到哪里。

这些工具只用于单 Agent 主对话任务。若本轮任务由 `agent-team` 流程处理，或者 agent 决定调用 `team_plan`、`team_provision`、`team_execute`、`team_update_progress`、`team_complete`、`team_cleanup` 等 team 工具，不要调用本工具组。team 任务进度由 `agent-team` 自己的 `todo.md` 和 `team_*` 工具负责，不要再创建一套 JSON todo。

除非用户明确询问插件实现细节，否则不要在最终回复或普通对话中提到 `astron-todo-sync`、`astron_single_agent_todo_create`、`astron_single_agent_todo_update`、`astron_single_agent_todo_get`、`astron_single_agent_todo_complete`、`todoId`、`todo.json` 或任何工具调用细节。

用户看到的自然语言回复应只包含任务本身的结果、结论、建议、下一步行动或必要免责声明。不要说“我已创建 todo”“我正在调用 astron_single_agent_todo_update”“我将调用 complete 工具”。

默认加载并使用本工具组同步单 Agent todo 状态，但 agent-team 流程除外。在创建单 Agent todo 前，先判断当前任务是否应交给 agent-team；如果要走 team 工具，直接使用 agent-team 流程，不调用 `astron_single_agent_todo_create`。除了明显“即问即答”的场景和 agent-team 场景外，其它用户消息都应先创建 todo 再执行。一个非即问即答的单 Agent 用户消息，对应一个新的 todo。这样的用户消息必须先调用 `astron_single_agent_todo_create`，再调用搜索、读取、写入、编辑、命令执行或其它外部工具，或继续做分析、整理、规划、生成内容等工作。

判断标准：如果用户会等待你处理、等待时间不确定、需要外部工具、需要整理输出、需要生成/修改文件、需要比较/分析/规划/排查，或者 UI/HTTP 客户端应该展示“正在查/正在处理”的进展，就创建 todo。任务不一定要大，也不一定要跨轮；非即问即答就创建轻量 todo。如果不确定当前消息是不是即问即答，且当前任务不会交给 agent-team，默认加载这个 skill 并创建 todo。

必须使用本工具组的场景：

- 除“可以不使用”列表里的明显即问即答外，其它所有用户请求。
- agent 已判断不走 agent-team，且任务需要单 Agent 执行。
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
- 当前任务由 agent-team 流程处理，或 agent 决定调用 `team_plan`、`team_provision`、`team_execute`、`team_update_progress`、`team_complete`、`team_cleanup` 等 team 工具。

不要因为任务“逻辑线性”“一轮可以完成”“只是查一个数据”“不需要跨轮追踪”而跳过 todo。todo 的用途是把 OpenClaw 当前单 Agent 任务进度同步给 UI/HTTP 客户端，让用户感知执行过程，不是只用于跨轮任务。只要不是明显即问即答，且不走 agent-team，就创建并维护 todo。

当用户给出的信息已经足够推进时，不要为了偏好细节反复提问。可以基于合理假设直接执行，并在最终回复中说明关键假设。只有缺少必要条件会导致任务无法继续、产生明显风险或用户明确要求确认时，才向用户提问。

每个新的复杂单 Agent 用户消息都创建新的 todo。不要复用上一条 todo，不要把新的复杂用户消息合并进旧 todo，也不要因为当前 session 中已经存在 `running`、`completed` 或 `failed` todo 而跳过创建。已关闭的 todo 不再更新。

所有工具都按当前 `sessionId` 隔离。`astron_single_agent_todo_get` 默认只返回当前会话的 todo；`astron_single_agent_todo_update`、`astron_single_agent_todo_complete` 只能操作当前会话中的 todo。

## 工作流

### 1. 全新任务创建 todo：`astron_single_agent_todo_create`

如果当前用户消息不是明显即问即答，且不走 agent-team，先调用 `astron_single_agent_todo_create`，再执行任务或调用搜索、读取、写文件、编辑文件、命令执行或其它外部工具。不要先调用 `astron_single_agent_todo_get` 来寻找可复用 todo；新的非即问即答单 Agent 用户消息必须有自己的新 todo。todo items 应覆盖真实、用户可理解的执行阶段或检查项，而不是写 Agent 的思考步骤。对于只查询一个实时数据的轻量任务，可以创建 1-2 个简短 item，例如“查询今日行情”“整理结果并回复”。

```text
astron_single_agent_todo_create(
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

### 2. 查询 todo 状态：`astron_single_agent_todo_get`

`astron_single_agent_todo_get` 不是 `astron_single_agent_todo_create` 的固定前置步骤。只有在用户询问进度、保存状态、刚才任务结果，或需要读取当前 session 的 todo 状态来回答状态问题时才调用。这个检查是内部行为，不要告诉用户。

优先调用 `astron_single_agent_todo_get` 的场景：

- 用户说“现在进度如何”“处理好了吗”“保存了吗”“刚才那个怎么样了”，且没有提出新的复杂执行动作。
- 当前上下文里没有可用的完整 `todoId`，但你需要回答某个已有 todo 的状态。
- 长对话、上下文压缩或工具结果缺失导致你不确定当前 todo 状态。

```text
astron_single_agent_todo_get()
```

如果用户消息包含新的复杂执行动作，例如“继续，补充风险提示并重新保存”“把刚才内容整理成表格”“再做一版报告”，且不走 agent-team，不要复用旧 todo；应创建新的 todo 来跟踪这条用户消息。

### 3. 更新 todo：`astron_single_agent_todo_update`

每完成一个实际阶段后更新当前用户消息创建的 todo item。不要把工具更新内容原样转述给用户。优先使用稳定的 `item_id`，没有 ID 时使用 1-based `item_index`。

```text
astron_single_agent_todo_update(
  todo_id: "release-checklist-a1b2c3",
  updates: [
    { item_id: "inspect", status: "completed" }
  ]
)
```

如果同一条用户消息执行过程中范围发生变化，可以用 `append_items` 追加 todo item。新的用户消息不要 append 到旧 todo，应创建新的 todo。

### 4. 查询 todo 状态：`astron_single_agent_todo_get`

当用户询问进度，或你需要恢复上下文时：

```text
astron_single_agent_todo_get(todo_id: "release-checklist-a1b2c3")
```

如果用户问“做到哪了”，可以用自然语言概括 todo 状态，但仍不要暴露工具名、todoId 或原始 JSON。

### 5. 完成 todo：`astron_single_agent_todo_complete`

只有当所有 todo item 都进入 `completed` 或 `failed` 后，才调用完成工具。该工具只负责关闭 todo 状态；没有失败项时关闭为 `completed`，存在失败项时关闭为 `failed`。最终答复直接发给用户，且只描述任务结果。

```text
astron_single_agent_todo_complete(
  todo_id: "release-checklist-a1b2c3"
)
```

## 常见错误

- 不要在用户可见回复中暴露工具名、todo ID、内部状态文件或“已调用某工具”。
- 不要跨会话使用其它会话返回的 `todoId`。
- 不要复用上一条 todo 来跟踪新的复杂用户消息。
- 不要更新已经 `completed` 或 `failed` 的 todo。
- 不要在同一条用户消息中反复调用 `astron_single_agent_todo_create`。
- 不要在还有 `pending` 或 `in_progress` item 时调用 `astron_single_agent_todo_complete`。
- 不要把基础 `todo_id` 当作完整 `todoId` 使用。
- 不要为明显即问即答的小任务创建 todo；如果需要等待、工具、整理、分析或执行过程，就不是即问即答，应创建 todo。
- 不要在 agent-team 流程中创建、查询、更新或完成本插件的 todo；team 进度由 `agent-team` 的 `todo.md` 和 `team_*` 工具负责。
````
