import { Type } from "typebox";
import { readTodo, todoBelongsToSession, updateTodoSummary, validateTodoId, writeTodo, } from "../todo-state.js";
import { jsonResult, nowIso } from "../tool-utils.js";
const TodoItemStatusSchema = Type.Union([
    Type.Literal("pending"),
    Type.Literal("in_progress"),
    Type.Literal("completed"),
    Type.Literal("failed"),
]);
const UpdateSchema = Type.Object({
    item_id: Type.Optional(Type.String({ description: "Todo item ID to update." })),
    item_index: Type.Optional(Type.Number({ description: "1-based todo item index to update." })),
    status: TodoItemStatusSchema,
    message: Type.Optional(Type.String({ description: "Short current-state message for this todo item." })),
    artifact_paths: Type.Optional(Type.Array(Type.String(), { description: "Artifact paths or URLs associated with this todo item." })),
}, { additionalProperties: false });
const AppendItemSchema = Type.Object({
    id: Type.Optional(Type.String({ description: "Stable todo item ID. Defaults to item-N." })),
    title: Type.String({ description: "Short user-visible todo item title." }),
    description: Type.Optional(Type.String({ description: "Optional todo item details." })),
}, { additionalProperties: false });
const TodoUpdateSchema = Type.Object({
    todo_id: Type.String({ description: "Todo ID returned by astronclaw_todo_create." }),
    updates: Type.Optional(Type.Array(UpdateSchema, { description: "Todo item status updates to apply." })),
    append_items: Type.Optional(Type.Array(Type.Union([Type.String(), AppendItemSchema]), {
        description: "Optional new todo items to append when the task scope changes.",
    })),
}, { additionalProperties: false });
function makeItem(item, index) {
    const objectItem = typeof item === "string" ? { title: item, description: "" } : { ...item };
    return {
        id: objectItem.id?.trim() || `item-${index + 1}`,
        title: objectItem.title.trim(),
        description: objectItem.description?.trim() ?? "",
        status: "pending",
        startedAt: null,
        completedAt: null,
        message: "",
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
    if (items.some((item) => item.status === "failed")) {
        return "failed";
    }
    if (items.some((item) => item.status !== "pending")) {
        return "running";
    }
    return changed && currentStatus === "pending" ? "running" : "pending";
}
export function createTodoUpdateTool(stateDir, sessionKey = "default") {
    return {
        name: "astronclaw_todo_update",
        label: "Update Conversation Todo",
        description: "Update the persisted conversation todo state after a real item starts, completes, fails, or changes. Use this to keep the user-visible todo/checklist state accurate through HTTP/UI sync. Do not mention tool names or todo IDs in user-facing messages.",
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
                todo = await readTodo(stateDir, todoId);
            }
            catch (err) {
                return jsonResult({
                    error: `Todo "${todoId}" not found: ${err instanceof Error ? err.message : String(err)}`,
                });
            }
            if (!todoBelongsToSession(todo, sessionKey)) {
                return jsonResult({ error: `Todo "${todoId}" is not available in this session.` });
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
                    ...(update.message !== undefined ? { message: update.message } : {}),
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
