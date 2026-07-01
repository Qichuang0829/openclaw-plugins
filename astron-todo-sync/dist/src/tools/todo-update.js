import { DEFAULT_SESSION_ID } from "../constants.js";
import { readTodo, todoBelongsToSessionId, updateTodoSummary, validateTodoId, writeTodo, } from "../todo-state.js";
import { jsonResult, nowIso } from "../tool-utils.js";
const UpdateSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        item_id: { type: "string", description: "Todo item ID to update." },
        item_index: { type: "number", description: "1-based todo item index to update." },
        status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "failed"],
            description: "New todo item status.",
        },
        artifact_paths: {
            type: "array",
            description: "Artifact paths or URLs associated with this todo item.",
            items: { type: "string" },
        },
    },
    required: ["status"],
};
const AppendItemSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        id: { type: "string", description: "Stable todo item ID. Defaults to item-N." },
        title: { type: "string", description: "Short user-visible todo item title." },
        description: { type: "string", description: "Optional todo item details." },
    },
    required: ["title"],
};
const TodoUpdateSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        todo_id: { type: "string", description: "Todo ID returned by astron_single_agent_todo_create." },
        updates: {
            type: "array",
            description: "Todo item status updates to apply.",
            items: UpdateSchema,
        },
        append_items: {
            type: "array",
            description: "Optional new todo items to append while executing the same current user message. Do not append items for a later user message; create a new todo instead.",
            items: {
                anyOf: [{ type: "string" }, AppendItemSchema],
            },
        },
    },
    required: ["todo_id"],
};
function makeItem(item, index) {
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
}
function resolveItemIndex(todo, update) {
    if (update.item_id) {
        const index = todo.items.findIndex((item) => item.id === update.item_id);
        return index >= 0 ? index : -1;
    }
    if (Number.isInteger(update.item_index)) {
        return Number(update.item_index) - 1;
    }
    return -1;
}
function applyStatus(item, status, timestamp) {
    if (status === "pending") {
        return { ...item, status, startedAt: null, completedAt: null };
    }
    if (status === "in_progress") {
        return { ...item, status, startedAt: item.startedAt ?? timestamp, completedAt: null };
    }
    return {
        ...item,
        status,
        startedAt: item.startedAt ?? timestamp,
        completedAt: item.completedAt ?? timestamp,
    };
}
function deriveStatusAfterUpdate(currentStatus, items, changed) {
    if (currentStatus === "completed" || currentStatus === "failed") {
        return currentStatus;
    }
    if (items.some((item) => item.status !== "pending")) {
        return "running";
    }
    return changed && currentStatus === "pending" ? "running" : "pending";
}
export function createTodoUpdateTool(stateDir, sessionId = DEFAULT_SESSION_ID) {
    return {
        name: "astron_single_agent_todo_update",
        label: "Update Single-Agent Todo",
        description: "仅用于更新 astron_single_agent_todo_create 为当前单 Agent 用户消息创建的 todo。禁止在 agent-team 流程中使用；team 任务进度由 agent-team 的 todo.md 和 team_update_progress/team_complete 负责。不要更新早前用户消息的 todo；继续、补充、重存、制作表格等新的后续工作应先创建新的单 Agent todo。已关闭 todo 不可修改。不要在用户可见消息中暴露工具名或 todoId。",
        parameters: TodoUpdateSchema,
        async execute(_toolCallId, params) {
            const todoId = params.todo_id?.trim();
            if (!todoId) {
                return jsonResult({ error: "todo_id is required" });
            }
            const validationError = validateTodoId(todoId);
            if (validationError) {
                return jsonResult({ error: validationError });
            }
            let todo;
            try {
                todo = await readTodo(stateDir, sessionId, todoId);
            }
            catch (err) {
                return jsonResult({
                    error: `Todo "${todoId}" not found: ${err instanceof Error ? err.message : String(err)}`,
                });
            }
            if (!todoBelongsToSessionId(todo, sessionId)) {
                return jsonResult({ error: `Todo "${todoId}" is not available in this session.` });
            }
            if (todo.status === "completed" || todo.status === "failed") {
                return jsonResult({
                    error: `Todo "${todoId}" is already closed and cannot be updated.`,
                    status: todo.status,
                    todo,
                });
            }
            const timestamp = nowIso();
            const nextItems = [...todo.items];
            for (const item of params.append_items ?? []) {
                nextItems.push(makeItem(item, nextItems.length));
            }
            for (const update of params.updates ?? []) {
                const index = resolveItemIndex({ items: nextItems }, update);
                if (index < 0 || index >= nextItems.length) {
                    return jsonResult({
                        error: `Todo item not found for update ${JSON.stringify({
                            item_id: update.item_id,
                            item_index: update.item_index,
                        })}`,
                    });
                }
                const current = nextItems[index];
                nextItems[index] = {
                    ...applyStatus(current, update.status, timestamp),
                    ...(update.artifact_paths !== undefined ? { artifactPaths: update.artifact_paths } : {}),
                };
            }
            const nextTodo = {
                ...todo,
                status: deriveStatusAfterUpdate(todo.status, nextItems, Boolean(params.append_items?.length || params.updates?.length)),
                items: nextItems,
                updatedAt: timestamp,
            };
            await writeTodo(stateDir, nextTodo);
            await updateTodoSummary(stateDir, nextTodo);
            return jsonResult({ success: true, todo: nextTodo });
        },
    };
}
