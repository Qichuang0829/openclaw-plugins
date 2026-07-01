# Astron Todo Sync 描述评审摘录

本文档整理 `astron-todo-sync` 插件当前暴露给 OpenClaw 和模型的插件、工具描述文本，供与 team 插件冲突评审使用。

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

### astron_single_agent_todo_update

来源：`astron-todo-sync/src/tools/todo-update.ts`

- label: `Update Single-Agent Todo`
- description:

```text
仅用于更新 astron_single_agent_todo_create 为当前单 Agent 用户消息创建的 todo。禁止在 agent-team 流程中使用。不要更新早前用户消息的 todo；继续、补充、重存、制作表格等新的后续工作应先创建新的单 Agent todo。已关闭 todo 不可修改。不要在用户可见消息中暴露工具名或 todoId。
```

### astron_single_agent_todo_complete

来源：`astron-todo-sync/src/tools/todo-complete.ts`

- label: `Complete Single-Agent Todo`
- description:

```text
仅用于关闭当前单 Agent 用户消息创建的持久化 todo。禁止在 agent-team 流程中使用。只有所有 todo item 都已 completed 或 failed，且即将发送最终用户结果时才调用本工具。已关闭 todo 不可变；重复完成调用返回已有关闭状态。不要向用户暴露工具名、todoId 或内部状态。
```

### astron_single_agent_todo_get

来源：`astron-todo-sync/src/tools/todo-get.ts`

- label: `Get Single-Agent Todo`
- description:

```text
仅用于读取单 Agent 主对话 todo 状态，通常用于进度、保存状态或刚才任务结果类问题。不要用本工具查询 agent-team 任务进度。如果用户提出新的执行工作，包括继续、补充、重存、制作表格，不要用本工具复用旧 todo，应先调用 astron_single_agent_todo_create 创建新的单 Agent todo。不要向用户暴露工具名、todoId 或原始内部状态。
```
