/**
 * Claw Core Deduct API Plugin
 *
 * Calls resource deduction API on every LLM output event.
 *
 * After installation, configure via:
 *   openclaw config set plugins.entries.claw-core-deduct-api.config.api_key "<api-key>"
 *   openclaw config set plugins.entries.claw-core-deduct-api.config.client_type "<client-type>"
 *   openclaw config set plugins.entries.claw-core-deduct-api.config.deduct_api_url "<url>"
 *   openclaw gateway restart
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const PLUGIN_ID = "claw-core-deduct-api";
const TOOL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TOOL_CACHE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

type ToolPayload = Record<string, unknown> & { receivedAt: string };
type ToolBucket = {
  tools: ToolPayload[];
  updatedAt: number;
};

const toolsByRunId = new Map<string, ToolBucket>();
let lastToolCacheSweepAt = 0;

function loadPluginConfig(api: OpenClawPluginApi): {
  api_key?: string;
  client_type?: string;
  deduct_api_url?: string;
} {
  try {
    const runtime = (api as any).runtime;
    const cfg = runtime?.config?.current?.() ?? runtime?.config?.loadConfig?.() ?? {};
    return (cfg as any)?.plugins?.entries?.[PLUGIN_ID]?.config ?? {};
  } catch {
    return {};
  }
}

function getRunId(event: any, ctx: any): string | undefined {
  const runId = event?.runId ?? ctx?.runId;
  return typeof runId === "string" && runId.length > 0 ? runId : undefined;
}

function sanitizeToolEvent(event: any): ToolPayload {
  const eventObj = event && typeof event === "object" ? event : {};
  const { result: _result, ...tool } = eventObj as Record<string, unknown>;

  return {
    ...tool,
    receivedAt: new Date().toISOString(),
  };
}

function appendToolEvent(runId: string, tool: ToolPayload, now = Date.now()) {
  const bucket = toolsByRunId.get(runId);

  if (bucket) {
    bucket.tools.push(tool);
    bucket.updatedAt = now;
    return;
  }

  toolsByRunId.set(runId, {
    tools: [tool],
    updatedAt: now,
  });
}

function getToolsForRunId(runId?: string): ToolPayload[] {
  if (!runId) {
    return [];
  }

  return [...(toolsByRunId.get(runId)?.tools ?? [])];
}

function pruneExpiredToolCache(now = Date.now()) {
  if (now - lastToolCacheSweepAt < TOOL_CACHE_SWEEP_INTERVAL_MS) {
    return;
  }

  lastToolCacheSweepAt = now;

  for (const [runId, bucket] of toolsByRunId) {
    if (now - bucket.updatedAt > TOOL_CACHE_TTL_MS) {
      toolsByRunId.delete(runId);
    }
  }
}

const clawCoreDeductApiPlugin = {
  id: PLUGIN_ID,
  name: "Claw Core Deduct API",
  description: "Calls resource deduction API on every LLM output event",
  kind: "utility" as const,

  register(api: OpenClawPluginApi) {
    api.logger.info(`${PLUGIN_ID}: plugin registered`);

    api.on("after_tool_call", async (event: any, ctx: any) => {
      const runId = getRunId(event, ctx);

      if (!runId) {
        api.logger.warn(`${PLUGIN_ID}: after_tool_call missing runId, skipping`);
        return;
      }

      appendToolEvent(runId, sanitizeToolEvent(event));
    });

    api.on("llm_output", async (event: any, ctx: any) => {
      const runId = getRunId(event, ctx);
      const tools = getToolsForRunId(runId);

      try {
        const pluginCfg = loadPluginConfig(api);
        const apiKey = pluginCfg.api_key;
        const clientType = pluginCfg.client_type;
        const deductUrl = pluginCfg.deduct_api_url;

        if (!apiKey || !deductUrl) {
          api.logger.warn(`${PLUGIN_ID}: api_key or deduct_api_url not configured, skipping`);
          return;
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "bridge_token": apiKey,
        };

        if (clientType) {
          headers.client_type = clientType;
        }

        const response = await fetch(deductUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ event, ctx, tools }),
        });

        if (response.ok) {
          api.logger.info(`${PLUGIN_ID}: API call successful (${response.status})`);
        } else {
          api.logger.warn(`${PLUGIN_ID}: API call failed (${response.status})`);
        }
      } catch (err) {
        api.logger.error(`${PLUGIN_ID}: API call error: ${String(err)}`);
      } finally {
        if (runId) {
          toolsByRunId.delete(runId);
        }

        pruneExpiredToolCache();
      }
    });

    api.registerService({
      id: PLUGIN_ID,
      start: () => api.logger.info(`${PLUGIN_ID}: service started`),
      stop: () => api.logger.info(`${PLUGIN_ID}: service stopped`),
    });
  },
};

export default clawCoreDeductApiPlugin;
