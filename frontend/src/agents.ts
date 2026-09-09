import { HttpAgent } from "@ag-ui/client";

/**
 * One AG-UI client per scenario, created at module scope.
 *
 * Identity must be stable: an inline object literal would churn CopilotKit's
 * tool/renderer registration on every render. Keeping the instances here also
 * means each scenario's conversation survives route navigation for free —
 * messages live on the agent, not on the React component.
 *
 * The URLs are relative so they go through the Vite /api proxy to FastAPI,
 * which keeps the OpenRouter key out of the browser entirely.
 */
export const SCENARIOS = ["text", "predefined", "a2ui"] as const;
export type ScenarioId = (typeof SCENARIOS)[number];

export const agents: Record<ScenarioId, HttpAgent> = {
  text: new HttpAgent({ url: "/api/agents/text" }),
  predefined: new HttpAgent({ url: "/api/agents/predefined" }),
  a2ui: new HttpAgent({ url: "/api/agents/a2ui" }),
};
