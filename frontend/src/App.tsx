/**
 * Routes, the single CopilotKit provider, and one stable thread per scenario.
 *
 * There is one provider for the whole app rather than one per route, so moving
 * between scenarios never tears down chat. The three agents are module-scope
 * instances (see agents.ts), which is also why each scenario's conversation
 * survives navigation without any code here to preserve it.
 */
import { useCallback, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { CopilotKit } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

import { agents, SCENARIOS, type ScenarioId } from "./agents";
import { cn } from "@/lib/utils";
import TextScenario from "./scenarios/Text";
import PredefinedScenario from "./scenarios/Predefined";
import A2UIScenario from "./scenarios/A2UI";

const newThreadId = () => crypto.randomUUID();

const LABELS: Record<ScenarioId, string> = {
  text: "Text",
  predefined: "Predefined",
  a2ui: "A2UI",
};

export default function App() {
  // Held here, above the routes, so navigation cannot reset them. A separate
  // browser tab loads this module afresh and therefore gets its own threads.
  const [threads, setThreads] = useState<Record<ScenarioId, string>>(() => ({
    text: newThreadId(),
    predefined: newThreadId(),
    a2ui: newThreadId(),
  }));

  /**
   * Reset clears only the selected page.
   *
   * A new thread id alone is not enough: with an explicit threadId, CopilotChat
   * skips its own auto-clear, and messages live on the module-scope agent
   * rather than the component. So the transcript and the mirrored state have to
   * be cleared here too. The backend needs nothing — a new thread id has an
   * empty checkpoint, and the seeding hook fills it from a fresh fixture copy.
   */
  const reset = useCallback((scenario: ScenarioId) => {
    const agent = agents[scenario];
    agent.setMessages([]);
    agent.setState({});
    setThreads((prev) => ({ ...prev, [scenario]: newThreadId() }));
  }, []);

  return (
    <CopilotKit
      agents__unsafe_dev_only={agents}
      // The Details panel below is this demo's debug surface; CopilotKit's own
      // dev inspector would just overlay it.
      enableInspector={false}
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-4 border-b border-border px-4 py-3">
          <div>
            <h1 className="text-sm font-semibold">Release Readiness Agent</h1>
            <p className="text-xs text-muted-fg">
              One agent, three ways of presenting it. Release operations are simulated.
            </p>
          </div>
          <nav className="ml-auto flex gap-1">
            {SCENARIOS.map((id) => (
              <NavLink
                key={id}
                to={`/${id}`}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-1.5 text-sm",
                    isActive ? "bg-primary text-white" : "hover:bg-muted",
                  )
                }
              >
                {LABELS[id]}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="min-h-0 flex-1">
          <Routes>
            <Route path="/" element={<Navigate to="/text" replace />} />
            <Route
              path="/text"
              element={<TextScenario threadId={threads.text} onReset={() => reset("text")} />}
            />
            <Route
              path="/predefined"
              element={
                <PredefinedScenario
                  threadId={threads.predefined}
                  onReset={() => reset("predefined")}
                />
              }
            />
            <Route
              path="/a2ui"
              element={<A2UIScenario threadId={threads.a2ui} onReset={() => reset("a2ui")} />}
            />
          </Routes>
        </main>
      </div>
    </CopilotKit>
  );
}
