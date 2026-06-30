import { HTTP_BASE_PATH, PLUGIN_ID } from "./src/constants.js";
import { createTodoCompleteTool } from "./src/tools/todo-complete.js";
import { createTodoCreateTool } from "./src/tools/todo-create.js";
import { createTodoGetTool } from "./src/tools/todo-get.js";
import { createTodoUpdateTool } from "./src/tools/todo-update.js";
import { createTodoHttpHandler } from "./src/http.js";
import { normalizeSessionId } from "./src/todo-state.js";

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
    "MUST create one new todo for each wait-worthy or complex user message before search/write/edit/command tools so UI and HTTP clients can show current task progress.",
  register(api: any) {
    const stateDir = resolveStateDir(api);

    api.registerTool(
      (ctx: any) => createTodoCreateTool(stateDir, normalizeSessionId(ctx?.sessionId)),
      { name: "astronclaw_todo_create" },
    );
    api.registerTool(
      (ctx: any) => createTodoUpdateTool(stateDir, normalizeSessionId(ctx?.sessionId)),
      { name: "astronclaw_todo_update" },
    );
    api.registerTool(
      (ctx: any) => createTodoCompleteTool(stateDir, normalizeSessionId(ctx?.sessionId)),
      { name: "astronclaw_todo_complete" },
    );
    api.registerTool(
      (ctx: any) => createTodoGetTool(stateDir, normalizeSessionId(ctx?.sessionId)),
      { name: "astronclaw_todo_get" },
    );

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
