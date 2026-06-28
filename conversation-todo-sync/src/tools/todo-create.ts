import { Type } from "typebox";
import { createTodoIdFromBase, createTodoWorkspace } from "../todo-state.js";
import type { AnyAgentTool, TodoItem, TodoList } from "../types.js";
import { jsonResult, nowIso } from "../tool-utils.js";

const TodoItemObjectSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ description: "Stable todo item ID. Defaults to item-N." })),
    title: Type.String({ description: "Short user-visible todo item title." }),
    description: Type.Optional(Type.String({ description: "Optional todo item details." })),
  },
  { additionalProperties: false },
);

const TodoCreateSchema = Type.Object(
  {
    todo_id: Type.Optional(
      Type.String({
        description:
          "Optional base todo ID. Must be lowercase alphanumeric with hyphens; a random suffix is appended.",
      }),
    ),
    task: Type.String({ description: "Original user task represented by this conversation todo list." }),
    items: Type.Optional(
      Type.Array(Type.Union([Type.String(), TodoItemObjectSchema]), {
        description: "Initial todo items. Strings become item titles; objects can include id/title/description.",
      }),
    ),
  },
  { additionalProperties: false },
);

type TodoItemInput = string | { id?: string; title: string; description?: string };
type TodoCreateParams = {
  todo_id?: string;
  task: string;
  items?: TodoItemInput[];
};

function normalizeItems(items: TodoItemInput[] | undefined): TodoItem[] {
  return (items ?? []).map((item, index) => {
    const objectItem =
      typeof item === "string" ? { title: item, description: "" } : { ...item };
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
  });
}

export function createTodoCreateTool(stateDir: string, sessionKey = "default"): AnyAgentTool {
  return {
    name: "astronclaw_todo_create",
    label: "Create Conversation Todo",
    description:
      "Create a persisted conversation todo list for a user-visible multi-step task. Use for moderately complex tasks with multiple phases, checklists, preparation steps, research, analysis, or follow-up. This records the current todo state for UI/HTTP sync; do not mention tool names or todo IDs to the user.",
    parameters: TodoCreateSchema,
    async execute(_toolCallId: string, params: TodoCreateParams) {
      const task = params.task?.trim();
      if (!task) {
        return jsonResult({ error: "task is required" });
      }

      const timestamp = nowIso();
      let todoId: string;
      try {
        todoId = createTodoIdFromBase(params.todo_id);
      } catch (err) {
        return jsonResult({ error: err instanceof Error ? err.message : String(err) });
      }

      const todo: TodoList = {
        todoId,
        sessionKey,
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
  } as AnyAgentTool;
}
