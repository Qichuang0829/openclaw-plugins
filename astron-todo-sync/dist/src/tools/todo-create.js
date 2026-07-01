import { DEFAULT_SESSION_ID } from "../constants.js";
import { createTodoIdFromBase, createTodoWorkspace } from "../todo-state.js";
import { jsonResult, nowIso } from "../tool-utils.js";
const TodoItemObjectSchema = {
    type: "object",
    properties: {
        id: { type: "string", description: "Stable todo item ID. Defaults to item-N." },
        title: { type: "string", description: "Short user-visible todo item title." },
        description: { type: "string", description: "Optional todo item details." },
    },
    required: ["title"],
};
const TodoCreateSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        todo_id: {
            type: "string",
            description: "Optional base todo ID. Must be lowercase alphanumeric with hyphens; a random suffix is appended.",
        },
        task: { type: "string", description: "Original user task represented by this conversation todo list." },
        items: {
            type: "array",
            description: "Initial todo items. Strings become item titles; objects can include id/title/description. Extra object fields such as status are accepted but ignored.",
            items: {
                anyOf: [{ type: "string" }, TodoItemObjectSchema],
            },
        },
    },
    required: ["task"],
};
function normalizeItems(items) {
    return (items ?? []).map((item, index) => {
        const objectItem = typeof item === "string" ? { title: item, description: "" } : { ...item };
        return {
            id: objectItem.id?.trim() || `item-${index + 1}`,
            title: objectItem.title.trim(),
            description: objectItem.description?.trim() ?? "",
            status: "pending",
            startedAt: null,
            completedAt: null,
            artifactPaths: [],
        };
    });
}
export function createTodoCreateTool(stateDir, sessionId = DEFAULT_SESSION_ID) {
    return {
        name: "astron_single_agent_todo_create",
        label: "Create Single-Agent Todo",
        description: "仅用于单 Agent 主对话任务。禁止在 agent-team 流程中使用：只要本轮任务将调用或已经调用 team_plan、team_provision、team_execute、team_update_progress、team_complete、team_cleanup 等 team 工具，就不要调用本工具；该任务进度由 agent-team 的 todo.md 负责。对每个非即时性用户请求，在执行任务或调用搜索、读取、写入、编辑、命令工具前调用本工具创建一个新的 todo；包括实时/最新/当日查询（如股价）、调研、分析、规划、文件生成、命令/代码执行、清单核对、对比分析、故障排查以及继续/补充/重存/制作表格等后续工作。一个非即时请求只创建一个新 todo，不复用旧 todo，不向用户暴露工具名或 todoId。",
        parameters: TodoCreateSchema,
        async execute(_toolCallId, params) {
            const task = params.task?.trim();
            if (!task) {
                return jsonResult({ error: "task is required" });
            }
            const timestamp = nowIso();
            let todoId;
            try {
                todoId = createTodoIdFromBase(params.todo_id);
            }
            catch (err) {
                return jsonResult({ error: err instanceof Error ? err.message : String(err) });
            }
            const todo = {
                todoId,
                sessionId,
                task,
                status: params.items?.length ? "running" : "pending",
                items: normalizeItems(params.items),
                createdAt: timestamp,
                updatedAt: timestamp,
            };
            const summary = await createTodoWorkspace(stateDir, todo);
            return jsonResult({
                success: true,
                ...summary,
                todo,
            });
        },
    };
}
