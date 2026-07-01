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
        description: "禁止在Team会话场景中使用，适用于单Agent为非即时性query生成新的待办事项。例如对实时/最新/当日信息的查询，例如股价、调研、分析、规划、文件生成、命令/代码执行、清单核对、对比分析、故障排查，以及诸如继续、补充、重存、制作表格等后续工作。",
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
