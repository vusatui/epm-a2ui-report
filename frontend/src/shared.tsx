/**
 * Pieces every scenario reuses: the page shell, the Details panel, and the
 * three developer-written release views.
 *
 * The Predefined scenario registers the views below as CopilotKit components.
 * The A2UI scenario does not use them at all — there the model composes the
 * interface from the catalog instead. Comparing the two is the point of the demo.
 */
import { useEffect, useState } from "react";
import type { AbstractAgent } from "@ag-ui/client";
import { CopilotChat, useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";

import { type ScenarioId } from "./agents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Select, Textarea } from "@/components/ui/field";

// ---------------------------------------------------------------- types

export type Reviewer = { id: string; name: string; role?: string };
export type Blocker = { id: string; title: string; detail: string };

export type ReleaseSnapshot = {
  id: string;
  name: string;
  checks: { id: string; name: string; status: string; detail: string }[];
  migration: {
    id: string; name: string; risk: string; review_required: boolean;
    summary: string; details: string; mitigation: string; inspected: boolean;
  };
  approval: {
    status: "not_requested" | "pending";
    reviewer_id: string | null; reviewer_name: string | null; comment: string | null;
  };
  reviewers: Reviewer[];
};

export type ActionResult = {
  ok: boolean;
  message: string;
  status?: string | null;
  already_pending?: boolean;
  error?: string | null;
  release?: ReleaseSnapshot | null;
  readiness?: { ready: boolean; blockers: Blocker[] } | null;
  a2ui_operations?: Record<string, unknown>[] | null;
};

/** The last payload worth showing in Details. */
export type DetailsEntry = { label: string; payload: unknown } | null;

// ---------------------------------------------------------------- action route

export async function postApproval(
  scenario: ScenarioId,
  body: { thread_id: string; release_id: string; reviewer_id: string; comment: string },
): Promise<ActionResult> {
  const res = await fetch(`/api/agents/${scenario}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "request_approval", ...body }),
  });
  if (!res.ok) {
    return { ok: false, message: `Request failed (${res.status} ${res.statusText}).` };
  }
  return (await res.json()) as ActionResult;
}

// ---------------------------------------------------------------- agent observation

/**
 * Watch one scenario's agent for the state and the last useful payload.
 *
 * This only listens to events the SDK already emits — there is no event
 * timeline engine, trace service or debug endpoint behind the Details panel.
 */
export function useScenarioAgent(scenario: ScenarioId) {
  const { agent, isReady } = useAgent({
    agentId: scenario,
    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
    throttleMs: 100,
  });

  const [details, setDetails] = useState<DetailsEntry>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!isReady || !agent) return;
    const sub = agent.subscribe({
      onRunInitialized: () => setRunning(true),
      onRunFinalized: () => setRunning(false),
      onRunFailed: () => setRunning(false),
      onToolCallResultEvent: ({ event }) => {
        const raw = (event as { content?: string }).content;
        setDetails({ label: "Last tool result", payload: safeParse(raw) });
      },
      onNewToolCall: ({ toolCall }) => {
        setDetails({
          label: `Tool call: ${toolCall.function?.name ?? "unknown"}`,
          payload: safeParse(toolCall.function?.arguments),
        });
      },
    });
    return () => sub.unsubscribe();
  }, [agent, isReady]);

  const release = (agent?.state as { release?: ReleaseSnapshot } | undefined)?.release;

  return { agent: agent as AbstractAgent | undefined, isReady, release, running, details, setDetails };
}

function safeParse(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------- page shell

export function ChatShell({
  title, description, threadId, scenario, onReset, busy, children,
}: {
  title: string;
  description: string;
  threadId: string;
  scenario: ScenarioId;
  onReset: () => void;
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <header>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted-fg">{description}</p>
        </header>
        {children}
      </section>

      <section className="flex min-h-0 flex-col rounded-lg border border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-fg">
            Chat · thread {threadId.slice(0, 8)}
          </span>
          <Button size="sm" variant="outline" onClick={onReset} disabled={busy}>
            Reset
          </Button>
        </div>
        <div className="relative min-h-0 flex-1">
          {/* No disabled prop exists on CopilotChat, so an overlay is what keeps
              input out while an action is in flight on this thread. */}
          {busy && (
            <div className="absolute inset-0 z-10 cursor-not-allowed bg-white/50" />
          )}
          <CopilotChat agentId={scenario} threadId={threadId} />
        </div>
      </section>
    </div>
  );
}

export function DetailsPanel({
  release, entry,
}: { release?: ReleaseSnapshot; entry: DetailsEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <CardTitle>Details</CardTitle>
          <span className="text-xs text-muted-fg">{open ? "Hide" : "Show"}</span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="flex flex-col gap-3">
          <div>
            <div className="mb-1 text-xs font-medium text-muted-fg">Release state</div>
            <Json value={release ?? "No state yet for this thread."} />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted-fg">
              {entry?.label ?? "Last payload"}
            </div>
            <Json value={entry?.payload ?? "Nothing yet."} />
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-relaxed">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

// ---------------------------------------------------------------- release views
//
// Developer-written components. The Predefined scenario registers these with
// CopilotKit so the agent can ask for them by name with typed arguments.

export function ReleaseReviewView({
  releaseName, statusLabel, ready, blockers = [], passingChecks = [],
}: {
  releaseName: string; statusLabel?: string; ready?: boolean;
  blockers?: { title: string; detail?: string }[]; passingChecks?: string[];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{releaseName}</CardTitle>
          <Badge tone={ready ? "success" : "warning"}>{ready ? "Ready" : "Blocked"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {statusLabel && <p>{statusLabel}</p>}
        {blockers.length > 0 && (
          <ul className="flex flex-col gap-2">
            {blockers.map((b, i) => (
              <li key={i} className="border-l-2 border-warning/50 pl-3">
                <div className="font-medium">{b.title}</div>
                {b.detail && <div className="text-xs text-muted-fg">{b.detail}</div>}
              </li>
            ))}
          </ul>
        )}
        {passingChecks.length > 0 && (
          <p className="text-xs text-muted-fg">Passing: {passingChecks.join(", ")}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function MigrationReviewView({
  name, risk, summary, details, mitigation,
}: {
  name: string; risk?: string; summary?: string; details?: string; mitigation?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{name}</CardTitle>
          <Badge tone="danger">{risk ?? "unknown"} risk</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {summary && <p>{summary}</p>}
        {details && <p className="text-xs text-muted-fg">{details}</p>}
        {mitigation && (
          <p className="text-xs">
            <span className="font-medium">Mitigation: </span>{mitigation}
          </p>
        )}
        <p className="text-xs text-muted-fg">
          Inspecting the migration does not approve it; review is still required.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * The approval form for the Predefined scenario.
 *
 * includeMigrationContext is the explicit developer-written variant: one extra
 * section, chosen by the agent through a typed boolean, for "show me the
 * migration risk alongside the approval form".
 */
export function ApprovalFormView({
  releaseId, reviewers, status, statusMessage, migration,
  includeMigrationContext = false, disabled = false, onSubmit,
}: {
  releaseId: string;
  reviewers: Reviewer[];
  status: string;
  statusMessage?: string;
  migration?: ReleaseSnapshot["migration"];
  includeMigrationContext?: boolean;
  disabled?: boolean;
  onSubmit: (reviewerId: string, comment: string) => Promise<void> | void;
}) {
  const pending = status === "pending";
  const [reviewerId, setReviewerId] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const locked = pending || sending || disabled;

  const submit = async () => {
    if (!reviewerId) return setError("Choose a reviewer.");
    if (!comment.trim()) return setError("Add a comment for the reviewer.");
    setError(null);
    setSending(true);
    try {
      await onSubmit(reviewerId, comment.trim());
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Request security approval</CardTitle>
          <Badge tone={pending ? "success" : "neutral"}>
            {pending ? "Pending" : "Not requested"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {statusMessage && <p className="text-xs text-muted-fg">{statusMessage}</p>}

        {includeMigrationContext && migration && (
          <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
            <div className="text-xs font-semibold">
              Migration context — {migration.name} ({migration.risk} risk)
            </div>
            <p className="mt-1 text-xs text-muted-fg">{migration.summary}</p>
            <p className="mt-1 text-xs">
              <span className="font-medium">Mitigation: </span>{migration.mitigation}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <Label htmlFor="pd-reviewer">Reviewer (required)</Label>
          <Select id="pd-reviewer" value={reviewerId} disabled={locked}
                  onChange={(e) => setReviewerId(e.target.value)}>
            <option value="">Select a reviewer…</option>
            {reviewers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}{r.role ? ` — ${r.role}` : ""}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="pd-comment">Comment (required)</Label>
          <Textarea id="pd-comment" value={comment} disabled={locked}
                    placeholder="Why does this need review?"
                    onChange={(e) => setComment(e.target.value)} />
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex items-center gap-2">
          <Button onClick={submit} disabled={locked}>
            {sending ? "Submitting…" : "Request approval"}
          </Button>
          <span className="text-xs text-muted-fg">
            Simulated — release {releaseId}, no email is sent.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
