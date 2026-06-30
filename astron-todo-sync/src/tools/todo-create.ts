import { DEFAULT_SESSION_ID } from "../constants.js";
import { createTodoIdFromBase, createTodoWorkspace } from "../todo-state.js";
import type { AnyAgentTool, TodoItem, TodoList } from "../types.js";
import { jsonResult, nowIso } from "../tool-utils.js";

const TodoItemObjectSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Stable todo item ID. Defaults to item-N." },
    title: { type: "string", description: "Short user-visible todo item title." },
    description: { type: "string", description: "Optional todo item details." },
  },
  required: ["title"],
} as const;

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
      description:
        "Initial todo items. Strings become item titles; objects can include id/title/description. Extra object fields such as status are accepted but ignored.",
      items: {
        anyOf: [{ type: "string" }, TodoItemObjectSchema],
      },
    },
  },
  required: ["task"],
} as const;

type TodoItemInput = string | { id?: string; title: string; description?: string; [key: string]: unknown };
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
      artifactPaths: [],
    };
  });
}

export function createTodoCreateTool(stateDir: string, sessionId = DEFAULT_SESSION_ID): AnyAgentTool {
  return {
    name: "astronclaw_todo_create",
    label: "Create Conversation Todo",
    description:
      "MUST call this for every current user message that is not obviously instant Q&A, before doing work or using search/read/write/edit/command tools. This includes live/latest/today lookups such as stock prices, research, analysis, planning, file generation, command/code execution, checklists, comparisons, troubleshooting, and follow-up work such as continue/supplement/resave/make a table. One non-instant user message needs one new todo; never reuse an earlier todo for new work. Do not mention tool names or todo IDs to the user.",
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
  } as AnyAgentTool;
}
