import { HTTP_BASE_PATH, PLUGIN_ID } from "./src/constants.js";
import { createTodoCompleteTool } from "./src/tools/todo-complete.js";
import { createTodoCreateTool } from "./src/tools/todo-create.js";
import { createTodoGetTool } from "./src/tools/todo-get.js";
import { createTodoUpdateTool } from "./src/tools/todo-update.js";
import { createTodoHttpHandler } from "./src/http.js";
import { failLatestOpenTodoForSession, normalizeSessionId } from "./src/todo-state.js";
import { nowIso } from "./src/tool-utils.js";

function resolveStateDir(api: any): string {
  const fromRuntime = api?.runtime?.state?.resolveStateDir?.();
  if (typeof fromRuntime === "string" && fromRuntime.length > 0) {
    return fromRuntime;
  }
  return api?.stateDir ?? ".openclaw";
}

const plugin = {
  id: PLUGIN_ID,
  name: "Astron Todo Sync",
  description:
    "Synchronize JSON todo progress for non-instant single-agent chat tasks; do not use for agent-team/team_* workflows, which manage their own todo.md progress.",
  register(api: any) {
    const stateDir = resolveStateDir(api);

    api.registerTool(
      (ctx: any) => createTodoCreateTool(stateDir, normalizeSessionId(ctx?.sessionId)),
      { name: "astron_single_agent_todo_create" },
    );
    api.registerTool(
      (ctx: any) => createTodoUpdateTool(stateDir, normalizeSessionId(ctx?.sessionId)),
      { name: "astron_single_agent_todo_update" },
    );
    api.registerTool(
      (ctx: any) => createTodoCompleteTool(stateDir, normalizeSessionId(ctx?.sessionId)),
      { name: "astron_single_agent_todo_complete" },
    );
    api.registerTool(
      (ctx: any) => createTodoGetTool(stateDir, normalizeSessionId(ctx?.sessionId)),
      { name: "astron_single_agent_todo_get" },
    );

    api.on?.("agent_end", async (_event: any, ctx: any) => {
      if (!ctx?.sessionId) {
        return;
      }
      try {
        const closedTodo = await failLatestOpenTodoForSession(
          stateDir,
          normalizeSessionId(ctx.sessionId),
          nowIso(),
        );
        if (closedTodo) {
          api.logger?.info?.(`[${PLUGIN_ID}] closed unfinished todo on agent_end: ${closedTodo.todoId}`);
        }
      } catch (err) {
        api.logger?.warn?.(
          `[${PLUGIN_ID}] failed to close unfinished todo on agent_end: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    if (typeof api.registerHttpRoute === "function") {
      api.registerHttpRoute({
        path: HTTP_BASE_PATH,
        handler: createTodoHttpHandler(stateDir),
        auth: "plugin",
        match: "prefix",
      });
    } else {
      api.logger?.warn?.(`[${PLUGIN_ID}] registerHttpRoute is not available; todo state remains file/tool readable.`);
    }
  },
};

export default plugin;
