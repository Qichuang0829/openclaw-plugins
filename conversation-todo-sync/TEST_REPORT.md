# conversation-todo-sync 测试报告

测试时间：2026-06-28  
测试对象：OpenClaw 插件 `conversation-todo-sync`  
插件路径：`scripts/plugins/conversation-todo-sync`  
运行时状态目录：`/home/selfwsl/.openclaw/conversation-todos`

## 结论

通过。

- 单元测试：11/11 通过。
- OpenClaw 插件检查：`openclaw plugins doctor` 无问题。
- HTTP 路由：单一前端会话 todo 列表接口、缺少 `session_id`、未知 session、不支持方法均按预期返回。
- 5 个日常任务调试集：5/5 通过。
- 20 个最终验收任务：20/20 通过。
- 复杂新任务会创建、更新并关闭 todo。
- 简单问答不会误触发 todo 工具。
- 续接任务会读取已有 todo，不会重复创建。
- 用户最终回复未泄漏 `conversation-todo-sync`、`astronclaw_todo_create`、`astronclaw_todo_update`、`astronclaw_todo_complete`、`astronclaw_todo_get`、`todoId`、`todo.json` 等内部细节。

## 已验证配置

OpenClaw 当前允许工具：

```json
[
  "astronclaw_todo_create",
  "astronclaw_todo_update",
  "astronclaw_todo_get",
  "astronclaw_todo_complete"
]
```

OpenClaw 当前加载插件：

```text
/home/selfwsl/gitlab/astronclaw-core-cicd/scripts/plugins/conversation-todo-sync
```

运行日志显示网关加载：

```text
http server listening (7 plugins: browser, conversation-todo-sync, device-pair, file-transfer, memory-core, phone-control, talk-voice)
gateway ready
```

## 验收规则

复杂新任务必须满足：

- 工具序列包含 `astronclaw_todo_create`、`astronclaw_todo_update`、`astronclaw_todo_complete`。
- 不在 `astronclaw_todo_create` 前固定调用 `astronclaw_todo_get`。
- 当前 session 新增 1 个 todo。
- HTTP 状态接口能按 `session_id` 读取该会话下的 todo。
- todo 最终 `status` 为 `completed`。
- `pendingItemCount` 为 0，`completedItemCount` 等于事项总数。
- 最终回复不泄漏内部工具和文件名。

简单任务必须满足：

- 不调用任何 `todo_*` 工具。
- 当前 session 不新增 todo。

续接任务必须满足：

- 调用 `astronclaw_todo_get`。
- 不调用 `astronclaw_todo_create`。
- 当前 session 不新增重复 todo。

## 5 任务调试集

结果文件：`/tmp/conversation-todo-5-results.json`

| ID | 类型 | 任务 | 工具序列 | todo 状态 | 结果 |
| --- | --- | --- | --- | --- | --- |
| T01 | 复杂新任务 | 家庭整理任务 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `home-tidy-plan-871e10` / `completed` / 4 of 4 | 通过 |
| T02 | 复杂新任务 | 猫咪体检准备 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `cat-vet-checkup-847ad1` / `completed` / 4 of 4 | 通过 |
| T03 | 简单任务 | 简单解释 | 无 | 未创建 todo | 通过 |
| T04 | 复杂新任务 | 团队周会流程 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `weekly-meeting-flow-988e68` / `completed` / 3 of 3 | 通过 |
| T05 | 续接任务 | 续接周会任务 | `astronclaw_todo_get` | 未创建重复 todo | 通过 |

调试集中发现并修复的问题：

- `TodoSummary` 摘要缺少事项计数字段，Agent 内部恢复 todo 时无法直接表达当前完成度。已补充 `itemCount`、`pendingItemCount`、`inProgressItemCount`、`completedItemCount`、`failedItemCount`。
- 整体关闭时间原先没有结构化字段。已补充 `closedAt`。
- 有失败事项时整体状态不应误导为完成。`astronclaw_todo_complete` 现在会在有失败事项时关闭为 `failed`。

## 20 任务最终验收

结果文件：`/tmp/conversation-todo-20-results.json`

| ID | 类型 | 任务 | 工具序列 | todo 状态 | 结果 |
| --- | --- | --- | --- | --- | --- |
| T01 | 复杂新任务 | 三天家庭晚餐 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `family-dinners-c36fd4` / `completed` / 4 of 4 | 通过 |
| T02 | 复杂新任务 | 周末洗衣收纳 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `laundry-closet-plan-3eb1d2` / `completed` / 4 of 4 | 通过 |
| T03 | 简单任务 | 一句话解释 | 无 | 未创建 todo | 通过 |
| T04 | 复杂新任务 | 猫咪体检准备 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `cat-vet-prep-49d734` / `completed` / 5 of 5 | 通过 |
| T05 | 复杂新任务 | 搬家前一天检查 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `move-eve-checklist-d3d6d1` / `completed` / 4 of 4 | 通过 |
| T06 | 复杂新任务 | 亲子科学实验 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `science-activity-plan-c35214` / `completed` / 4 of 4 | 通过 |
| T07 | 复杂新任务 | 读书计划 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `reading-plan-e647e1` / `completed` / 3 of 3 | 通过 |
| T08 | 复杂新任务 | 两天一夜行李 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `packing-checklist-fd2dea` / `completed` / 4 of 4 | 通过 |
| T09 | 简单任务 | 简单改写 | 无 | 未创建 todo | 通过 |
| T10 | 复杂新任务 | 团队周会流程 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `weekly-meeting-design-8dd8ab` / `completed` / 3 of 3 | 通过 |
| T11 | 续接任务 | 续接周会 | `astronclaw_todo_get` | 未创建重复 todo | 通过 |
| T12 | 复杂新任务 | 新手机数据迁移 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `phone-migration-9b0ef0` / `completed` / 4 of 4 | 通过 |
| T13 | 复杂新任务 | 工作日早晨流程 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `morning-routine-284fd2` / `completed` / 4 of 4 | 通过 |
| T14 | 复杂新任务 | 办公桌和线缆收纳 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `desk-cable-plan-cf788f` / `completed` / 4 of 4 | 通过 |
| T15 | 复杂新任务 | 家庭生日聚会 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `birthday-party-plan-27ecab` / `completed` / 6 of 6 | 通过 |
| T16 | 续接任务 | 续接生日聚会 | `astronclaw_todo_get` | 未创建重复 todo | 通过 |
| T17 | 复杂新任务 | 家庭药箱整理 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `medicine-cabinet-check-ee9f13` / `completed` / 5 of 5 | 通过 |
| T18 | 复杂新任务 | 家庭应急包 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `family-emergency-kit-388901` / `completed` / 4 of 4 | 通过 |
| T19 | 复杂新任务 | 孩子手工作业准备 | `read -> astronclaw_todo_create -> astronclaw_todo_update -> astronclaw_todo_complete` | `craft-homework-plan-204be3` / `completed` / 4 of 4 | 通过 |
| T20 | 简单任务 | 简单计算 | 无 | 未创建 todo | 通过 |

## HTTP 抽样

前端状态接口：

```http
GET /plugins/conversation-todo-sync/todos?session_id=<sessionId>
```

返回该 session 下的完整 `TodoList[]`，每个 todo 包含整体状态和每个 item 的 `status`、`startedAt`、`completedAt`、`artifactPaths`：

```json
{
  "sessionId": "35e2872a-2f6a-45ff-80be-a9a6aaa7401c",
  "todos": [
    {
      "todoId": "family-dinners-c36fd4",
      "status": "completed",
      "items": [
        {
          "id": "menu",
          "title": "制定每日菜单",
          "status": "completed"
        }
      ]
    }
  ]
}
```

前端轮询规则：

- 前端从当前对话上下文拿到 `session_id`。
- 前端只轮询 `GET /plugins/conversation-todo-sync/todos?session_id=<sessionId>`。
- `pending` 或 `running` 时继续轮询。
- `completed` 或 `failed` 时停止轮询。

## 最终判断

当前实现已经满足“准确给用户提供当前 todo 状态”的生产前验收标准：

- 名称和语义已经从任务设计概念收敛为 todo/checklist 状态同步。
- 工具描述和 skill 能稳定触发日常多步骤任务。
- 新任务、简单任务、续接任务三类行为区分清晰。
- HTTP 状态接口能按 `session_id` 表达该会话下 todo 的整体状态和事项级完成度。
- session 隔离有效，续接不会重复创建 todo。
