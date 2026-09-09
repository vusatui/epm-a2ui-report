/**
 * The custom A2UI catalog for this demo.
 *
 * The model does not invent widgets: it picks from these four domain
 * components plus the basic layout components (Column, Row, Card, Text,
 * Divider) and arranges them. The prop contract lives in
 * contracts/release-catalog.json, which the Python agent reads to build its
 * prompt and to validate what the model produced. The catalogId below must
 * match that file exactly — the renderer matches catalogs by string equality.
 *
 * ApprovalForm is the point of the whole scenario: the model decides *where*
 * the form goes and what surrounds it, but the form itself is developer-owned
 * React — it holds its own fields, enforces its own required-field rules, and
 * raises its own submit action.
 */
import { useState } from "react";
import {
  createCatalog,
  DynamicBooleanSchema,
  DynamicStringSchema,
  type CatalogDefinitions,
} from "@copilotkit/a2ui-renderer";
import { z } from "zod";

import contract from "../../contracts/release-catalog.json";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Select, Textarea } from "@/components/ui/field";

export const CATALOG_ID: string = contract.catalogId;

/** Anything bindable arrives resolved at render time; these narrow the type. */
const asText = (v: unknown): string => (typeof v === "string" ? v : "");
const asBool = (v: unknown): boolean => v === true;
const asList = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

type Blocker = { title?: string; detail?: string };
type Reviewer = { id: string; name: string; role?: string };

/** A bindable array: either a literal array or a {path} binding. */
const DynamicArraySchema = z.union([z.array(z.any()), z.object({ path: z.string() })]);

export const definitions = {
  ReleaseSummary: {
    description: contract.components.ReleaseSummary.description,
    props: z.object({
      releaseName: DynamicStringSchema,
      statusLabel: DynamicStringSchema,
      ready: DynamicBooleanSchema.optional(),
      passingChecks: DynamicArraySchema.optional(),
    }),
  },
  BlockerList: {
    description: contract.components.BlockerList.description,
    props: z.object({
      title: DynamicStringSchema.optional(),
      blockers: DynamicArraySchema.optional(),
    }),
  },
  MigrationRiskCard: {
    description: contract.components.MigrationRiskCard.description,
    props: z.object({
      name: DynamicStringSchema,
      risk: DynamicStringSchema.optional(),
      summary: DynamicStringSchema.optional(),
      details: DynamicStringSchema.optional(),
      mitigation: DynamicStringSchema.optional(),
    }),
  },
  ApprovalForm: {
    description: contract.components.ApprovalForm.description,
    props: z.object({
      releaseId: DynamicStringSchema,
      reviewers: DynamicArraySchema.optional(),
      status: DynamicStringSchema.optional(),
      statusMessage: DynamicStringSchema.optional(),
    }),
  },
} satisfies CatalogDefinitions;

export const releaseCatalog = createCatalog(
  definitions,
  {
    ReleaseSummary: ({ props }) => {
      const ready = asBool(props.ready);
      return (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>{asText(props.releaseName)}</CardTitle>
              <Badge tone={ready ? "success" : "warning"}>
                {ready ? "Ready" : "Blocked"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p>{asText(props.statusLabel)}</p>
            {asList<string>(props.passingChecks).length > 0 && (
              <p className="mt-2 text-xs text-muted-fg">
                Passing: {asList<string>(props.passingChecks).join(", ")}
              </p>
            )}
          </CardContent>
        </Card>
      );
    },

    BlockerList: ({ props }) => {
      const blockers = asList<Blocker>(props.blockers);
      return (
        <Card>
          <CardHeader>
            <CardTitle>{asText(props.title) || "Blockers"}</CardTitle>
          </CardHeader>
          <CardContent>
            {blockers.length === 0 ? (
              <p className="text-muted-fg">No blockers.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {blockers.map((b, i) => (
                  <li key={i} className="border-l-2 border-warning/50 pl-3">
                    <div className="font-medium">{b.title}</div>
                    {b.detail && <div className="text-xs text-muted-fg">{b.detail}</div>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      );
    },

    MigrationRiskCard: ({ props }) => (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{asText(props.name)}</CardTitle>
            <Badge tone="danger">{asText(props.risk) || "unknown"} risk</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {asText(props.summary) && <p>{asText(props.summary)}</p>}
          {asText(props.details) && (
            <p className="text-xs text-muted-fg">{asText(props.details)}</p>
          )}
          {asText(props.mitigation) && (
            <p className="text-xs">
              <span className="font-medium">Mitigation: </span>
              {asText(props.mitigation)}
            </p>
          )}
        </CardContent>
      </Card>
    ),

    // The form owns its fields, its validation and its submission.
    ApprovalForm: ({ props, dispatch }) => {
      const reviewers = asList<Reviewer>(props.reviewers);
      const status = asText(props.status) || "not_requested";
      const pending = status === "pending";

      const [reviewerId, setReviewerId] = useState("");
      const [comment, setComment] = useState("");
      const [error, setError] = useState<string | null>(null);
      const [sending, setSending] = useState(false);

      const submit = () => {
        if (!reviewerId) return setError("Choose a reviewer.");
        if (!comment.trim()) return setError("Add a comment for the reviewer.");
        setError(null);
        setSending(true);
        dispatch?.({
          event: {
            name: "submit_approval",
            context: { releaseId: asText(props.releaseId), reviewerId, comment: comment.trim() },
          },
        });
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
            {asText(props.statusMessage) && (
              <p className="text-xs text-muted-fg">{asText(props.statusMessage)}</p>
            )}
            <div className="flex flex-col gap-1">
              <Label htmlFor="a2ui-reviewer">Reviewer (required)</Label>
              <Select
                id="a2ui-reviewer"
                value={reviewerId}
                disabled={pending || sending}
                onChange={(e) => setReviewerId(e.target.value)}
              >
                <option value="">Select a reviewer…</option>
                {reviewers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.role ? ` — ${r.role}` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="a2ui-comment">Comment (required)</Label>
              <Textarea
                id="a2ui-comment"
                value={comment}
                disabled={pending || sending}
                placeholder="Why does this need review?"
                onChange={(e) => setComment(e.target.value)}
              />
            </div>
            {error && <p className="text-xs text-danger">{error}</p>}
            <div className="flex items-center gap-2">
              <Button onClick={submit} disabled={pending || sending}>
                {sending && !pending ? "Submitting…" : "Request approval"}
              </Button>
              <span className="text-xs text-muted-fg">Simulated — no email is sent.</span>
            </div>
          </CardContent>
        </Card>
      );
    },
  },
  { catalogId: CATALOG_ID, includeBasicCatalog: true },
);
