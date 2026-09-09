/**
 * Predefined scenario — the agent picks a component the developer already wrote.
 *
 * useComponent registers a frontend tool, so these three views are shipped to
 * the agent with every run and the backend declares nothing to match them
 * (see modules/predefined/agent.py). The agent chooses which view to show and
 * with what arguments; React owns the layout and all of the behavior.
 *
 * Note ApprovalForm: the agent supplies only the release id and one boolean.
 * Reviewers, current status and migration text are read from thread state here,
 * so the model can never invent a reviewer id.
 */
import { useEffect, useState } from "react";
import { useComponent } from "@copilotkit/react-core/v2";
import { z } from "zod";

import {
  ApprovalFormView,
  ChatShell,
  DetailsPanel,
  MigrationReviewView,
  ReleaseReviewView,
  postApproval,
  useScenarioAgent,
  type DetailsEntry,
  type ReleaseSnapshot,
} from "../shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PROMPTS = [
  "Is release 2.4 ready for production?",
  "Inspect the migration risk.",
  "Help me request the missing approval.",
  "Show me the migration risk alongside the approval form.",
];

export default function PredefinedScenario({
  threadId, onReset,
}: { threadId: string; onReset: () => void }) {
  const { release, details, running, setDetails } = useScenarioAgent("predefined");
  const [submitting, setSubmitting] = useState(false);

  /**
   * The action route writes to the thread checkpoint, but the browser's
   * mirrored agent state only refreshes on the next agent run. Without this the
   * form would still say "Not requested" straight after a successful submit.
   * The A2UI scenario solves the same problem with a server-sent data update.
   */
  const [actionRelease, setActionRelease] = useState<ReleaseSnapshot | null>(null);
  const current = actionRelease ?? release;

  // A new agent turn re-syncs state from the server, so stop shadowing it.
  useEffect(() => {
    if (running) setActionRelease(null);
  }, [running]);
  useEffect(() => setActionRelease(null), [threadId]);

  useComponent(
    {
      name: "ReleaseReview",
      description:
        "Show the release readiness verdict with its blocker list. Use for readiness questions.",
      parameters: z.object({
        releaseName: z.string(),
        statusLabel: z.string().optional(),
        ready: z.boolean().optional(),
        blockers: z
          .array(z.object({ title: z.string(), detail: z.string().optional() }))
          .optional(),
        passingChecks: z.array(z.string()).optional(),
      }),
      render: (props) => <ReleaseReviewView {...props} />,
    },
    [],
  );

  useComponent(
    {
      name: "MigrationReview",
      description: "Show the pending migration's risk, details and mitigation.",
      parameters: z.object({
        name: z.string(),
        risk: z.string().optional(),
        summary: z.string().optional(),
        details: z.string().optional(),
        mitigation: z.string().optional(),
      }),
      render: (props) => <MigrationReviewView {...props} />,
    },
    [],
  );

  useComponent(
    {
      name: "ApprovalForm",
      description:
        "Show the security-approval form. The form collects the reviewer and comment " +
        "and submits itself. Set includeMigrationContext to true to show the migration " +
        "risk in the same form.",
      parameters: z.object({
        releaseId: z.string(),
        includeMigrationContext: z.boolean().optional(),
      }),
      render: ({ releaseId, includeMigrationContext }) => (
        <ApprovalFormView
          releaseId={releaseId}
          reviewers={current?.reviewers ?? []}
          status={current?.approval.status ?? "not_requested"}
          statusMessage={
            current?.approval.status === "pending"
              ? `Requested from ${current.approval.reviewer_name} — ` +
                `"${current.approval.comment}" (simulated).`
              : undefined
          }
          migration={current?.migration}
          includeMigrationContext={includeMigrationContext}
          disabled={submitting}
          onSubmit={async (reviewerId, comment) => {
            setSubmitting(true);
            try {
              const result = await postApproval("predefined", {
                thread_id: threadId,
                release_id: releaseId,
                reviewer_id: reviewerId,
                comment,
              });
              setDetails({ label: "Last action result", payload: result } as DetailsEntry);
              if (result.release) setActionRelease(result.release);
            } finally {
              setSubmitting(false);
            }
          }}
        />
      ),
    },
    [current, threadId, submitting],
  );

  return (
    <ChatShell
      title="Predefined"
      description="The agent asks for one of three components the developer already wrote, passing typed arguments. React owns the layout and behavior."
      threadId={threadId}
      scenario="predefined"
      onReset={onReset}
      busy={running || submitting}
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
          <p className="mt-2 text-xs text-muted-fg">
            The last prompt takes the explicit form variant: one developer-written
            branch, <code>includeMigrationContext</code>, in shared.tsx.
          </p>
        </CardContent>
      </Card>
      <DetailsPanel release={current} entry={details} />
    </ChatShell>
  );
}
