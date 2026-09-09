from __future__ import annotations

import os
from copy import deepcopy
from pathlib import Path
from typing import Any, NotRequired

from copilotkit import LangGraphAGUIAgent
from dotenv import load_dotenv
from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware, hook_config
from langchain_core.messages import AIMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

# --------------------------------------------------------------------------
# Model configuration (OpenRouter is the only external service)
# --------------------------------------------------------------------------

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "dots-studio/dots-3-note-preview:free"


def api_key() -> str:
    return os.getenv("OPENROUTER_API_KEY", "").strip()


def model_name() -> str:
    return os.getenv("OPENROUTER_MODEL", DEFAULT_MODEL).strip()


def build_model() -> ChatOpenAI:
    return ChatOpenAI(
        model=model_name(),
        base_url=OPENROUTER_BASE_URL,
        api_key=api_key,
        timeout=60,
        max_retries=2,
        temperature=0,
    )


# --------------------------------------------------------------------------
# Fixture: release-2.4
# --------------------------------------------------------------------------

SEED: dict[str, Any] = {
    "id": "release-2.4",
    "name": "Release 2.4",
    "checks": [
        {"id": "unit-tests", "name": "Unit tests", "status": "passed",
         "detail": "412 passed in 38s"},
        {"id": "lint", "name": "Lint and type check", "status": "passed",
         "detail": "No findings"},
        {"id": "dependency-scan", "name": "Dependency scan", "status": "passed",
         "detail": "No known vulnerabilities"},
        {"id": "integration-tests", "name": "Integration tests", "status": "failed",
         "detail": "Payment-provider sandbox timeout after 30s"},
    ],
    "migration": {
        "id": "orders-index",
        "name": "Orders-index migration",
        "risk": "high",
        "review_required": True,
        "summary": "Possible table lock on the orders table",
        "details": (
            "The migration adds a composite index on orders(customer_id, created_at). "
            "On the current 84M-row table the default path takes an ACCESS EXCLUSIVE "
            "lock for an estimated 8-12 minutes, which would stall checkout writes."
        ),
        "mitigation": (
            "Build the index with CREATE INDEX CONCURRENTLY in a separate migration "
            "step, run it outside peak hours, and keep a DROP INDEX rollback ready."
        ),
        "inspected": False,
    },
    "approval": {
        "kind": "security",
        "status": "not_requested",   # not_requested -> pending
        "reviewer_id": None,
        "reviewer_name": None,
        "comment": None,
    },
    "reviewers": [
        {"id": "rev-alex-morgan", "name": "Alex Morgan", "role": "Security engineer"},
        {"id": "rev-sam-patel", "name": "Sam Patel", "role": "Platform lead"},
    ],
}


def fresh_release() -> dict[str, Any]:
    """A new thread always starts from an untouched copy of the fixture."""
    return deepcopy(SEED)


# --------------------------------------------------------------------------
# Graph state
# --------------------------------------------------------------------------

class ReleaseState(AgentState):
    """Messages (from AgentState) plus the release snapshot for this thread."""

    release: NotRequired[dict[str, Any]]
    # A2UI scenario only: what the live surface currently shows, so a follow-up
    # turn can update it instead of rebuilding it.
    last_surface: NotRequired[dict[str, Any]]
    # A2UI scenario only: correction attempts used for the current render.
    a2ui_attempts: NotRequired[int]


class SeedMiddleware(AgentMiddleware[Any, Any]):
    """Initialize every new thread from a fresh seed copy, exactly once."""

    state_schema = ReleaseState
    
    def before_agent(self, state, runtime):  # noqa: ANN001
        release = state.get("release")
        if not isinstance(release, dict) or "checks" not in release:
            return {"release": fresh_release()}
        return None


class ReleaseAGUIAgent(LangGraphAGUIAgent):
    """Make the checkpoint authoritative for domain state.

    ag_ui_langgraph's prepare_stream does `state_input = input.state or {}` and
    feeds that to the graph, while the browser echoes its mirrored copy of the
    state on every run. Left alone, a stale browser copy of `release` overwrites
    whatever the server wrote (including from the /actions routes, and including
    right after a Reset). Blanking the inbound state costs nothing: prepare_stream
    re-reads `messages` from the checkpoint itself.
    """

    def __init__(self, *, name, graph, description=None, config=None, **flags):  # noqa: ANN001
        # LangGraphAGUIAgent's constructor accepts only these four arguments, but
        # the adapter clones the agent per request and refuses to silently drop a
        # non-default stream flag. Accepting **flags here lets clone() round-trip
        # them (e.g. emit_raw_events=False) instead of raising.
        super().__init__(name=name, graph=graph, description=description, config=config)
        for key, value in flags.items():
            setattr(self, key, value)

    async def prepare_stream(self, input, agent_state, config):  # noqa: ANN001, A002
        return await super().prepare_stream(
            input.model_copy(update={"state": {}}), agent_state, config
        )


# --------------------------------------------------------------------------
# Release operations
#
# Ordinary functions, shared by every agent's tools and by the /actions routes.
# Each takes a snapshot and returns (new_snapshot, result). None of them mutate
# their argument. All external release operations here are SIMULATED.
# --------------------------------------------------------------------------

def check_by_id(release: dict[str, Any], check_id: str) -> dict[str, Any] | None:
    return next((c for c in release["checks"] if c["id"] == check_id), None)


def readiness(release: dict[str, Any]) -> dict[str, Any]:
    """Derive readiness from state — never stored, always recomputed."""
    blockers: list[dict[str, str]] = []

    for check in release["checks"]:
        if check["status"] == "failed":
            blockers.append({
                "id": check["id"],
                "title": f"{check['name']} failed",
                "detail": check["detail"],
            })

    migration = release["migration"]
    if migration["review_required"]:
        blockers.append({
            "id": migration["id"],
            "title": f"{migration['name']} needs review ({migration['risk']} risk)",
            "detail": migration["summary"],
        })

    approval = release["approval"]
    if approval["status"] == "not_requested":
        blockers.append({
            "id": "security-approval",
            "title": "Security approval has not been requested",
            "detail": "A reviewer must be asked to sign off before release.",
        })
    elif approval["status"] == "pending":
        blockers.append({
            "id": "security-approval",
            "title": "Security approval is pending",
            "detail": f"Waiting on {approval['reviewer_name']}.",
        })

    return {
        "release_id": release["id"],
        "release_name": release["name"],
        "ready": not blockers,
        "blockers": blockers,
        "passing_checks": [c["name"] for c in release["checks"] if c["status"] == "passed"],
    }


def inspect_migration(release: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return details and mitigation. Inspecting does NOT resolve the review."""
    updated = deepcopy(release)
    updated["migration"]["inspected"] = True
    m = updated["migration"]
    return updated, {
        "id": m["id"],
        "name": m["name"],
        "risk": m["risk"],
        "summary": m["summary"],
        "details": m["details"],
        "mitigation": m["mitigation"],
        "review_required": m["review_required"],
        "note": "Inspecting the migration does not approve it; review is still required.",
    }


def find_reviewer(release: dict[str, Any], identifier: str) -> dict[str, Any] | None:
    """Look a reviewer up by stable id or by name (case-insensitive)."""
    needle = (identifier or "").strip().lower()
    for reviewer in release["reviewers"]:
        if needle in (reviewer["id"].lower(), reviewer["name"].lower()):
            return reviewer
    return None


def rerun_integration_test(release: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """An explicit rerun turns the failed integration test green (simulated)."""
    updated = deepcopy(release)
    check = check_by_id(updated, "integration-tests")
    if check is None:
        return release, {"ok": False, "message": "No integration test on this release."}
    if check["status"] == "passed":
        return release, {"ok": True, "message": f"{check['name']} already passed.",
                         "status": "passed"}
    check["status"] = "passed"
    check["detail"] = "412 passed in 41s (simulated rerun; sandbox reachable)"
    return updated, {"ok": True, "status": "passed",
                     "message": f"{check['name']} passed on rerun."}


def request_approval(
    release: dict[str, Any], reviewer_identifier: str, comment: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Validate and record a security approval request (simulated).

    An already-pending approval returns the existing result rather than
    creating a second one.
    """
    approval = release["approval"]
    if approval["status"] == "pending":
        return release, {
            "ok": True,
            "already_pending": True,
            "status": "pending",
            "reviewer_id": approval["reviewer_id"],
            "reviewer_name": approval["reviewer_name"],
            "comment": approval["comment"],
            "message": (
                f"Security approval is already pending with "
                f"{approval['reviewer_name']}."
            ),
        }

    reviewer = find_reviewer(release, reviewer_identifier)
    if reviewer is None:
        known = ", ".join(f"{r['name']} ({r['id']})" for r in release["reviewers"])
        return release, {"ok": False, "error": "unknown_reviewer",
                         "message": f"Unknown reviewer. Known reviewers: {known}."}

    if not (comment or "").strip():
        return release, {"ok": False, "error": "missing_comment",
                         "message": "A comment for the reviewer is required."}

    updated = deepcopy(release)
    updated["approval"] = {
        "kind": "security",
        "status": "pending",
        "reviewer_id": reviewer["id"],
        "reviewer_name": reviewer["name"],
        "comment": comment.strip(),
    }
    return updated, {
        "ok": True,
        "already_pending": False,
        "status": "pending",
        "reviewer_id": reviewer["id"],
        "reviewer_name": reviewer["name"],
        "comment": comment.strip(),
        "message": f"Security approval requested from {reviewer['name']} (simulated).",
    }


# --------------------------------------------------------------------------
# Pydantic models for the UI action routes
# --------------------------------------------------------------------------

class ApprovalActionRequest(BaseModel):
    """Body for POST /api/agents/{scenario}/actions."""

    action: str = Field(description="Only 'request_approval' is supported.")
    thread_id: str = Field(min_length=1)
    release_id: str = Field(min_length=1)
    reviewer_id: str = ""
    comment: str = ""


class ApprovalActionResponse(BaseModel):
    ok: bool
    message: str
    status: str | None = None
    already_pending: bool = False
    error: str | None = None
    release: dict[str, Any] | None = None
    readiness: dict[str, Any] | None = None
    # A2UI only: data-update messages to apply to the live surface.
    a2ui_operations: list[dict[str, Any]] | None = None


# --------------------------------------------------------------------------
# Shared tools
#
# The same five tools back all three scenarios — the scenarios differ in how
# they present the results, not in what they can do. Each tool reads the
# current thread's snapshot from state and returns a graph-state update;
# nothing mutates state in place.
# --------------------------------------------------------------------------

import json  # noqa: E402

from langchain_core.messages import ToolMessage  # noqa: E402
from langchain_core.tools import tool  # noqa: E402
from langchain.tools import ToolRuntime  # noqa: E402
from langgraph.types import Command  # noqa: E402


def _update(runtime: ToolRuntime, payload: dict[str, Any],
            release: dict[str, Any] | None = None) -> Command:
    """Return a tool result plus, optionally, a new release snapshot.

    ToolNode requires exactly one ToolMessage carrying this call's id.
    """
    update: dict[str, Any] = {
        "messages": [ToolMessage(json.dumps(payload),
                                 tool_call_id=runtime.tool_call_id)]
    }
    if release is not None:
        update["release"] = release
    return Command(update=update)


def _release_of(runtime: ToolRuntime) -> dict[str, Any]:
    release = runtime.state.get("release")
    return release if isinstance(release, dict) else fresh_release()


def release_tools() -> list[Any]:
    """The five shared release tools, built fresh for each agent."""

    @tool
    def get_release_readiness(runtime: ToolRuntime) -> Command:
        """Check whether the release is ready for production and list any blockers."""
        return _update(runtime, readiness(_release_of(runtime)))

    @tool
    def inspect_migration_risk(runtime: ToolRuntime) -> Command:
        """Get details and mitigation for the pending database migration.

        Inspecting does not approve the migration or clear its review requirement.
        """
        updated, result = inspect_migration(_release_of(runtime))
        return _update(runtime, result, updated)

    @tool
    def list_reviewers(runtime: ToolRuntime) -> Command:
        """List the reviewers who can be asked for a security approval."""
        return _update(runtime, {"reviewers": _release_of(runtime)["reviewers"]})

    @tool
    def rerun_failed_integration_test(runtime: ToolRuntime) -> Command:
        """Rerun the failed integration test (simulated). Only run when asked to."""
        updated, result = rerun_integration_test(_release_of(runtime))
        return _update(runtime, result, updated if result.get("ok") else None)

    @tool
    def request_security_approval(reviewer: str, comment: str,
                                  runtime: ToolRuntime) -> Command:
        """Request security approval from a reviewer (simulated).

        Requires a reviewer (name or id) and a comment explaining the request.
        Only call this when the user has actually asked to request approval.
        """
        updated, result = request_approval(_release_of(runtime), reviewer, comment)
        return _update(runtime, result, updated if result.get("ok") else None)

    return [
        get_release_readiness,
        inspect_migration_risk,
        list_reviewers,
        rerun_failed_integration_test,
        request_security_approval,
    ]


# --------------------------------------------------------------------------
# Shared handling for the UI action routes
#
# Both /predefined/actions and /a2ui/actions submit the same approval request.
# They read and update the graph's state through public APIs only — there is no
# parallel domain-state dictionary anywhere in this demo.
# --------------------------------------------------------------------------

async def read_release(graph: Any, thread_id: str) -> dict[str, Any]:
    """Current snapshot for a thread, seeding it if the thread is brand new."""
    snapshot = await graph.aget_state({"configurable": {"thread_id": thread_id}})
    release = (snapshot.values or {}).get("release")
    return release if isinstance(release, dict) else fresh_release()


async def submit_approval(graph: Any, body: ApprovalActionRequest) -> ApprovalActionResponse:
    """Validate a form submission, update thread state, and report the result.

    Subsequent agent turns see the update because it is written to the same
    checkpoint the agent runs against.
    """
    if body.action != "request_approval":
        return ApprovalActionResponse(
            ok=False, error="unknown_action",
            message=f"Unsupported action: {body.action}.")

    config = {"configurable": {"thread_id": body.thread_id}}
    release = await read_release(graph, body.thread_id)

    if body.release_id != release["id"]:
        return ApprovalActionResponse(
            ok=False, error="unknown_release",
            message=f"Unknown release: {body.release_id}.")

    updated, result = request_approval(release, body.reviewer_id, body.comment)

    if not result.get("ok"):
        return ApprovalActionResponse(
            ok=False, error=result.get("error"), message=result["message"],
            release=release, readiness=readiness(release))

    if updated is not release:
        await graph.aupdate_state(config, {"release": updated})

    return ApprovalActionResponse(
        ok=True,
        message=result["message"],
        status=result["status"],
        already_pending=bool(result.get("already_pending")),
        release=updated,
        readiness=readiness(updated),
    )
