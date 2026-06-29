import { DEFAULT_SESSION_ID } from "../constants.js";
import { createTodoIdFromBase, createTodoWorkspace } from "../todo-state.js";
import { jsonResult, nowIso } from "../tool-utils.js";
const TodoItemObjectSchema = {
    type: "object",
    additionalProperties: false,
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
            description: "Initial todo items. Strings become item titles; objects can include id/title/description.",
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
        name: "astronclaw_todo_create",
        label: "Create Conversation Todo",
        description: "Create a persisted conversation todo list for a user-visible multi-step task. Use for moderately complex tasks with multiple phases, checklists, preparation steps, research, analysis, or follow-up. This records the current todo state for UI/HTTP sync; do not mention tool names or todo IDs to the user.",
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
