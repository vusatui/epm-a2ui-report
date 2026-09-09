/**
 * Text scenario — everything arrives as prose in the chat.
 *
 * The page registers no components at all. Compare this file with
 * Predefined.tsx and A2UI.tsx: the difference between the three scenarios is
 * almost entirely on this side plus the agent's prompt.
 */
import { ChatShell, DetailsPanel, useScenarioAgent } from "../shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PROMPTS = [
  "Is release 2.4 ready for production?",
  "Inspect the migration risk.",
  "Rerun the failed integration test.",
  "Help me request the missing approval.",
  "Request security approval from Alex Morgan with the comment: Please review the migration risk before deployment.",
];

export default function TextScenario({
  threadId, onReset,
}: { threadId: string; onReset: () => void }) {
  const { release, details, running } = useScenarioAgent("text");

  return (
    <ChatShell
      title="Text"
      description="The agent explains findings in Markdown. No buttons, no embedded forms — if it needs a reviewer, it asks for one in a sentence."
      threadId={threadId}
      scenario="text"
      onReset={onReset}
      busy={running}
    >
      <Card>
        <CardHeader>
          <CardTitle>Try asking</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1 text-sm text-muted-fg">
            {PROMPTS.map((p) => (
              <li key={p}>· {p}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <DetailsPanel release={release} entry={details} />
    </ChatShell>
  );
}
