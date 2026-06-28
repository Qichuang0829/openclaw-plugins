import type { ToolResult } from "./types.js";

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

export function nowIso(): string {
  return new Date().toISOString();
}
