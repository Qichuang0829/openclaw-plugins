import type { ToolResult } from "./types.js";

export type ToolErrorCode =
  | "INVALID_ARGUMENT"
  | "TODO_UNAVAILABLE"
  | "TODO_CLOSED"
  | "TODO_ITEM_NOT_FOUND"
  | "TODO_HAS_OPEN_ITEMS"
  | "INTERNAL_ERROR";

export type ToolNextAction = {
  tool: string;
  instruction: string;
  arguments?: Record<string, unknown>;
};

type ToolErrorOptions = {
  nextAction?: ToolNextAction;
  extra?: Record<string, unknown>;
};

export function jsonResult(payload: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : undefined,
  };
}

export function errorResult(
  code: ToolErrorCode,
  error: string,
  options: ToolErrorOptions = {},
): ToolResult {
  return jsonResult({
    ...(options.extra ?? {}),
    success: false,
    error,
    code,
    retryable: false,
    ...(options.nextAction ? { next_action: options.nextAction } : {}),
  });
}

export function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}
