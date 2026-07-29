import { DEFAULT_SESSION_ID } from "../constants.js";
import {
  readTodo,
  todoBelongsToSessionId,
  updateTodoSummary,
  validateTodoId,
  writeTodo,
} from "../todo-state.js";
import type { AnyAgentTool, TodoItem, TodoItemStatus, TodoStatus } from "../types.js";
import { errorResult, isErrorCode, jsonResult, nowIso } from "../tool-utils.js";

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
} as const;

const AppendItemSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", description: "Stable todo item ID. Defaults to item-N." },
    title: { type: "string", description: "Short user-visible todo item title." },
    description: { type: "string", description: "Optional todo item details." },
  },
  required: ["title"],
} as const;

const TodoUpdateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    todo_id: { type: "string", description: "Todo ID returned by astron_single_agent_todo_create." },
    items: {
      type: "array",
      description: "Todo item status changes to apply.",
      items: UpdateSchema,
    },
    append_items: {
      type: "array",
      description:
        "Optional new todo items to append while executing the same current user message. Do not append items for a later user message; create a new todo instead.",
      items: {
        anyOf: [{ type: "string" }, AppendItemSchema],
      },
    },
  },
  required: ["todo_id"],
} as const;

type TodoItemInput = string | { id?: string; title: string; description?: string };
type TodoUpdateParams = {
  todo_id: string;
  items?: Array<{
    item_id?: string;
    item_index?: number;
    status: TodoItemStatus;
    artifact_paths?: string[];
  }>;
  append_items?: TodoItemInput[];
};

function prepareTodoUpdateArguments(args: unknown): unknown {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return args;
  }

  const record = args as Record<string, unknown>;
  const hasItems = Object.prototype.hasOwnProperty.call(record, "items");
  const hasUpdates = Object.prototype.hasOwnProperty.call(record, "updates");

  if (hasItems && hasUpdates) {
    const { updates: _legacyUpdates, ...prepared } = record;
    return prepared;
  }
  if (!hasItems && Array.isArray(record.updates)) {
    const { updates, ...prepared } = record;
    return { ...prepared, items: updates };
  }
  return args;
}

function makeItem(item: TodoItemInput, index: number): TodoItem {
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

function resolveItemIndex(todo: { items: TodoItem[] }, update: { item_id?: string; item_index?: number }) {
  if (update.item_id) {
    const index = todo.items.findIndex((item) => item.id === update.item_id);
    return index >= 0 ? index : -1;
  }

  if (Number.isInteger(update.item_index)) {
    return Number(update.item_index) - 1;
  }

  return -1;
}

function applyStatus(item: TodoItem, status: TodoItemStatus, timestamp: string): TodoItem {
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

function deriveStatusAfterUpdate(currentStatus: TodoStatus, items: TodoItem[], changed: boolean): TodoStatus {
  if (currentStatus === "completed" || currentStatus === "failed") {
    return currentStatus;
  }
  if (items.some((item) => item.status !== "pending")) {
    return "running";
  }
  return changed && currentStatus === "pending" ? "running" : "pending";
}

export function createTodoUpdateTool(stateDir: string, sessionId = DEFAULT_SESSION_ID): AnyAgentTool {
  return {
    name: "astron_single_agent_todo_update",
    label: "Update Single-Agent Todo",
    description:
      "状态变更必须通过顶层 items 参数提交，不要使用 updates。仅用于更新 astron_single_agent_todo_create 为当前单 Agent 用户消息创建的 todo。禁止在 agent-team 流程中使用。不要更新早前用户消息的 todo；继续、补充、重存、制作表格等新的后续工作应先创建新的单 Agent todo。已关闭 todo 不可修改。不要在用户可见消息中暴露工具名或 todoId。",
    parameters: TodoUpdateSchema,
    prepareArguments: prepareTodoUpdateArguments,
    async execute(_toolCallId: string, params: TodoUpdateParams) {
      const todoId = params.todo_id?.trim();
      if (!todoId) {
        return errorResult("INVALID_ARGUMENT", "todo_id is required", {
          nextAction: {
            tool: "astron_single_agent_todo_update",
            instruction: "Provide the current todo_id and call the update tool again.",
          },
        });
      }
      const validationError = validateTodoId(todoId);
      if (validationError) {
        return errorResult("INVALID_ARGUMENT", validationError, {
          nextAction: {
            tool: "astron_single_agent_todo_update",
            instruction: "Correct the todo_id and call the update tool again.",
          },
        });
      }

      let todo;
      try {
        todo = await readTodo(stateDir, sessionId, todoId);
      } catch (err) {
        if (isErrorCode(err, "ENOENT")) {
          return errorResult("TODO_UNAVAILABLE", `Todo "${todoId}" is not available in this session.`, {
            nextAction: {
              tool: "astron_single_agent_todo_get",
              instruction:
                "List todos available in the current session without reusing this todo_id.",
              arguments: {},
            },
          });
        }
        return errorResult("INTERNAL_ERROR", "Failed to read todo state.");
      }
      if (!todoBelongsToSessionId(todo, sessionId)) {
        return errorResult("TODO_UNAVAILABLE", `Todo "${todoId}" is not available in this session.`, {
          nextAction: {
            tool: "astron_single_agent_todo_get",
            instruction: "List todos available in the current session without reusing this todo_id.",
            arguments: {},
          },
        });
      }
      if (todo.status === "completed" || todo.status === "failed") {
        return errorResult(
          "TODO_CLOSED",
          `Todo "${todoId}" is already closed and cannot be updated. Do not retry updating this todo_id. For continued, supplemental, retry, or regenerated work, call astron_single_agent_todo_create to create a new single-agent todo for the current work.`,
          {
            nextAction: {
              tool: "astron_single_agent_todo_create",
              instruction:
                "Create a new single-agent todo from the current user request without reusing the closed todo_id.",
            },
            extra: {
              status: todo.status,
              todo,
            },
          },
        );
      }

      const timestamp = nowIso();
      const nextItems = [...todo.items];

      for (const item of params.append_items ?? []) {
        nextItems.push(makeItem(item, nextItems.length));
      }

      for (const update of params.items ?? []) {
        const index = resolveItemIndex({ items: nextItems }, update);
        if (index < 0 || index >= nextItems.length) {
          return errorResult(
            "TODO_ITEM_NOT_FOUND",
            `Todo item not found for update ${JSON.stringify({
              item_id: update.item_id,
              item_index: update.item_index,
            })}`,
            {
              nextAction: {
                tool: "astron_single_agent_todo_get",
                instruction:
                  "Read the current todo to refresh valid item IDs or indexes before updating again.",
                arguments: { todo_id: todoId },
              },
            },
          );
        }

        const current = nextItems[index]!;
        nextItems[index] = {
          ...applyStatus(current, update.status, timestamp),
          ...(update.artifact_paths !== undefined ? { artifactPaths: update.artifact_paths } : {}),
        };
      }

      const nextTodo = {
        ...todo,
        status: deriveStatusAfterUpdate(
          todo.status,
          nextItems,
          Boolean(params.append_items?.length || params.items?.length),
        ),
        items: nextItems,
        updatedAt: timestamp,
      };
      try {
        await updateTodoSummary(stateDir, nextTodo);
        await writeTodo(stateDir, nextTodo);
      } catch {
        return errorResult("INTERNAL_ERROR", "Failed to update todo state.");
      }

      return jsonResult({ success: true, todo: nextTodo });
    },
  } as AnyAgentTool;
}
