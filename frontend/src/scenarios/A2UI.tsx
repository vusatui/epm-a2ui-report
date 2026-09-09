/**
 * A2UI scenario — the model composes the interface itself.
 *
 * The surface lives in a page-level A2UIProvider, not inside a chat bubble.
 * That is what lets it survive follow-up turns and lets the server push a data
 * update into it after a form submission, with no second agent turn and no LLM
 * deciding whether the action worked.
 *
 * Flow:
 *   agent tool result  -> useRenderTool -> ApplyOperations -> processMessages
 *   form submit        -> onAction      -> POST /actions   -> processMessages
 *
 * The adapter between AG-UI and A2UI is the small ApplyOperations component
 * below; there is no partial-JSON parser anywhere. Whole, validated messages
 * arrive in one tool result.
 */
import { useEffect, useRef, useState } from "react";
import { useRenderTool } from "@copilotkit/react-core/v2";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIActions,
  useA2UIError,
} from "@copilotkit/a2ui-renderer";
import { z } from "zod";

import { releaseCatalog } from "../a2ui-catalog";
import {
  ChatShell,
  DetailsPanel,
  postApproval,
  useScenarioAgent,
  type ActionResult,
  type DetailsEntry,
} from "../shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SURFACE_ID = "release-surface";

const PROMPTS = [
  "Is release 2.4 ready for production?",
  "Inspect the migration risk.",
  "Help me request the missing approval.",
  "Show me the migration risk alongside the approval form.",
];

type Operation = Record<string, unknown>;

export default function A2UIScenario({
  threadId, onReset,
}: { threadId: string; onReset: () => void }) {
  return (
    // Keying on threadId gives Reset a genuinely empty surface: a new provider
    // means a new MessageProcessor with no surfaces in it.
    <A2UIProviderHost key={threadId} threadId={threadId} onReset={onReset} />
  );
}

function A2UIProviderHost({
  threadId, onReset,
}: { threadId: string; onReset: () => void }) {
  const [details, setDetails] = useState<DetailsEntry>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  /** A form submit inside the surface arrives here. */
  const handleAction = async (message: { userAction?: { name: string; context?: Record<string, unknown> } }) => {
    const action = message.userAction;
    if (!action || action.name !== "submit_approval") return;
    if (submittingRef.current) return; // no repeated submissions
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const ctx = action.context ?? {};
      const result = await postApproval("a2ui", {
        thread_id: threadId,
        release_id: String(ctx.releaseId ?? ""),
        reviewer_id: String(ctx.reviewerId ?? ""),
        comment: String(ctx.comment ?? ""),
      });
      setDetails({ label: "Last action result", payload: result });
      pendingOpsRef.current = result.a2ui_operations ?? null;
      setOpsTick((n) => n + 1);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  // The action handler runs outside the renderer tree, so its data-update
  // messages are handed to the surface through this ref + tick.
  const pendingOpsRef = useRef<Operation[] | null>(null);
  const [opsTick, setOpsTick] = useState(0);

  return (
    <A2UIProvider catalog={releaseCatalog} onAction={handleAction}>
      <A2UIPage
        threadId={threadId}
        onReset={onReset}
        details={details}
        setDetails={setDetails}
        submitting={submitting}
        pendingOpsRef={pendingOpsRef}
        opsTick={opsTick}
      />
    </A2UIProvider>
  );
}

function A2UIPage({
  threadId, onReset, details, setDetails, submitting, pendingOpsRef, opsTick,
}: {
  threadId: string;
  onReset: () => void;
  details: DetailsEntry;
  setDetails: (e: DetailsEntry) => void;
  submitting: boolean;
  pendingOpsRef: React.RefObject<Operation[] | null>;
  opsTick: number;
}) {
  const { release, running } = useScenarioAgent("a2ui");
  const { processMessages } = useA2UIActions();
  const renderError = useA2UIError();
  const [hasSurface, setHasSurface] = useState(false);

  // Apply the server's data update from an action response.
  useEffect(() => {
    const ops = pendingOpsRef.current;
    if (!ops || ops.length === 0) return;
    pendingOpsRef.current = null;
    processMessages(ops);
  }, [opsTick, processMessages, pendingOpsRef]);

  // The agent's surface arrives as this tool's result.
  useRenderTool(
    {
      name: "render_release_surface",
      parameters: z.object({ components: z.array(z.any()) }),
      render: ({ status, result }) => {
        if (status !== "complete") {
          return <p className="text-xs text-muted-fg">Composing the interface…</p>;
        }
        return (
          <ApplyOperations
            raw={result}
            onApplied={(payload, applied) => {
              setDetails({ label: "Last A2UI operations", payload });
              if (applied) setHasSurface(true);
            }}
          />
        );
      },
    },
    [setDetails],
  );

  return (
    <ChatShell
      title="A2UI"
      description="The model composes this interface from a catalog and binds it to a data model. Submitting the form updates the same surface through a server-sent data update — no second agent turn."
      threadId={threadId}
      scenario="a2ui"
      onReset={onReset}
      busy={running || submitting}
    >
      <Card>
        <CardHeader>
          <CardTitle>Composed surface</CardTitle>
        </CardHeader>
        <CardContent>
          {renderError ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-danger">
                The interface could not be rendered: {renderError}
              </p>
              <div>
                <Button size="sm" variant="outline" onClick={onReset}>
                  Retry with a new thread
                </Button>
              </div>
            </div>
          ) : (
            <A2UIRenderer
              surfaceId={SURFACE_ID}
              fallback={
                <p className="text-sm text-muted-fg">
                  Nothing composed yet. Ask a question and the agent will build the
                  interface here.
                </p>
              }
            />
          )}
          {hasSurface && !renderError && (
            <p className="mt-3 text-xs text-muted-fg">
              Follow-up questions update this same surface.
            </p>
          )}
        </CardContent>
      </Card>

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

/**
 * Applies one tool result's A2UI operations to the live surface, exactly once.
 *
 * useRenderTool intentionally keeps historical tool calls renderable, so this
 * render runs again on every re-render and route remount. Re-applying would
 * throw: the processor rejects a createSurface for a surface it already has.
 * Hence both guards — skip an unchanged payload, and drop createSurface when
 * the surface already exists (which also makes a page reload safe, since the
 * server always sends it).
 */
function ApplyOperations({
  raw, onApplied,
}: {
  raw: string;
  onApplied: (payload: unknown, applied: boolean) => void;
}) {
  const { processMessages, getSurface } = useA2UIActions();
  const lastRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastRef.current === raw) return;
    lastRef.current = raw;

    let parsed: { ok?: boolean; a2ui_operations?: Operation[]; errors?: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      onApplied(raw, false);
      return;
    }

    onApplied(parsed, Boolean(parsed.ok));
    if (!parsed.ok || !parsed.a2ui_operations) return;

    const exists = Boolean(getSurface(SURFACE_ID));
    const ops = exists
      ? parsed.a2ui_operations.filter((op) => !("createSurface" in op))
      : parsed.a2ui_operations;
    processMessages(ops);
  }, [raw, processMessages, getSurface, onApplied]);

  return null;
}
