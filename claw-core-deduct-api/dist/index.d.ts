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
declare const clawCoreDeductApiPlugin: {
    id: string;
    name: string;
    description: string;
    kind: "utility";
    register(api: OpenClawPluginApi): void;
};
export default clawCoreDeductApiPlugin;
