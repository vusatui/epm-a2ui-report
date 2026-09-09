"""A2UI scenario — the model composes the interface from a catalog.

The other two scenarios choose between shapes the developer already fixed. Here
the model decides the composition: which components appear, in what order, and
nested how. It does that by calling render_release_surface with an A2UI
component tree, which this module validates and turns into real, versioned A2UI
operations (createSurface / updateComponents / updateDataModel).

Operational values are never baked into the components. They are bound to data
paths, and the data model is populated here from release state — which is what
lets a form submission update the live surface later without asking an LLM
whether it worked. See modules/a2ui/endpoint.py.
"""

import json
from pathlib import Path
from typing import Any

from ag_ui_a2ui_toolkit import validate_a2ui_components
from copilotkit import CopilotKitMiddleware, a2ui
from langchain.agents import create_agent
from langchain.tools import ToolRuntime
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from langchain_core.messages import ToolMessage

from common import (
    ROOT,
    MissingKeyMiddleware,
    ReleaseState,
    SeedMiddleware,
    build_model,
    fresh_release,
    readiness,
    release_tools,
)

CONTRACT = json.loads((ROOT / "contracts" / "release-catalog.json").read_text())
CATALOG_ID: str = CONTRACT["catalogId"]
SURFACE_ID = "release-surface"
MAX_ATTEMPTS = 2  # one initial attempt plus one correction

# The validator flags any component name outside the catalog. Layout components
# come from the basic catalog the frontend merges in.
VALIDATOR_CATALOG: dict[str, Any] = {
    "components": {
        **{name: {"properties": spec["properties"]}
           for name, spec in CONTRACT["components"].items()},
        **{name: {"properties": {}} for name in CONTRACT["layoutComponents"]},
    }
}


def surface_data(release: dict[str, Any]) -> dict[str, Any]:
    """The A2UI data model, populated from release state.

    Components bind to these paths, so refreshing this object is all it takes
    to update what a live surface displays.
    """
    status = readiness(release)
    migration = release["migration"]
    approval = release["approval"]

    if approval["status"] == "pending":
        message = (
            f"Requested from {approval['reviewer_name']} — \"{approval['comment']}\" "
            f"(simulated)."
        )
    else:
        message = "Security approval has not been requested yet."

    return {
        "release": {"id": release["id"], "name": release["name"]},
        "readiness": {
            "ready": status["ready"],
            "statusLabel": (
                f"{release['name']} is ready for production."
                if status["ready"]
                else f"{release['name']} is not ready: "
                     f"{len(status['blockers'])} blocker(s) outstanding."
            ),
            "passingChecks": status["passing_checks"],
        },
        "blockers": [{"title": b["title"], "detail": b["detail"]}
                     for b in status["blockers"]],
        "migration": {
            "name": migration["name"],
            "risk": migration["risk"],
            "summary": migration["summary"],
            "details": migration["details"],
            "mitigation": migration["mitigation"],
        },
        "approval": {"status": approval["status"], "message": message},
        "reviewers": release["reviewers"],
    }


def build_operations(components: list[dict[str, Any]],
                     release: dict[str, Any]) -> list[dict[str, Any]]:
    """Genuine A2UI v0.9 operations for one surface update.

    createSurface is always included; the browser drops it when it already has
    this surface. That keeps a reload safe in both directions without the
    server having to track what the browser currently holds.
    """
    return [
        a2ui.create_surface(SURFACE_ID, CATALOG_ID),
        a2ui.update_components(SURFACE_ID, components),
        a2ui.update_data_model(SURFACE_ID, surface_data(release)),
    ]


COMPOSITION_GUIDE = json.dumps(
    {"layoutComponents": CONTRACT["layoutComponents"],
     "components": CONTRACT["components"]},
    indent=2,
)

SYSTEM_PROMPT = f"""You are a release readiness assistant for a software team.

You build the interface yourself. Instead of writing long answers, call
render_release_surface with an A2UI component tree and let the surface carry the
detail. Keep your chat message to one short sentence.

## Catalog

You may only use these component types:

{COMPOSITION_GUIDE}

## How to write components

- A flat array of objects, each with a unique "id" and a "component" type.
- Exactly one component must have "id": "root". It is the entry point.
- Containers reference children by id: Column and Row take "children" (an array
  of ids), Card takes "child" (a single id).
- Bind operational values to the data model instead of copying text in. A bound
  prop is written as {{"path": "/some/path"}}.

Available data paths: /release/id, /release/name, /readiness/ready,
/readiness/statusLabel, /readiness/passingChecks, /blockers, /migration/name,
/migration/risk, /migration/summary, /migration/details, /migration/mitigation,
/approval/status, /approval/message, /reviewers.

Example of a bound component:
{{"id": "summary", "component": "ReleaseSummary",
  "releaseName": {{"path": "/release/name"}},
  "statusLabel": {{"path": "/readiness/statusLabel"}},
  "ready": {{"path": "/readiness/ready"}},
  "passingChecks": {{"path": "/readiness/passingChecks"}}}}

## Composition rules

- Compose what the request actually calls for. If the user asks for the
  migration risk *alongside* the approval form, put MigrationRiskCard and
  ApprovalForm as siblings in the same Column so both are visible at once.
- ApprovalForm is self-contained. Never add your own reviewer picker, comment
  box or submit button, and do not call request_security_approval when you show
  the form — the form submits itself.
- Gather facts with the release tools before rendering, and bind rather than
  paraphrase.
- Answering a readiness question is NOT a request to change anything. Never
  rerun a test or request approval unless the user explicitly asks.
- If render_release_surface reports validation errors, fix them and call it
  once more. If it reports that no attempts remain, apologise briefly and stop.
- External release operations here are simulated.
"""


def a2ui_tools() -> list[Any]:
    @tool
    def render_release_surface(components: list[dict], runtime: ToolRuntime) -> Command:
        """Render or update the release interface from an A2UI component tree.

        Pass a flat array of A2UI components, exactly one with id "root".
        Bind operational values to data paths rather than inlining them.
        """
        state = runtime.state
        release = state.get("release")
        if not isinstance(release, dict):
            release = fresh_release()

        attempts = int(state.get("a2ui_attempts") or 0) + 1
        # Bindings are checked against the data model the surface will carry,
        # so the data has to be passed in or every {"path": ...} looks broken.
        result = validate_a2ui_components(
            components=components,
            data=surface_data(release),
            catalog=VALIDATOR_CATALOG,
            validate_bindings=True,
        )

        if not result["valid"]:
            exhausted = attempts >= MAX_ATTEMPTS
            payload = {
                "ok": False,
                "errors": result["errors"],
                "attempts_remaining": 0 if exhausted else MAX_ATTEMPTS - attempts,
                "message": (
                    "The component tree is invalid and no attempts remain."
                    if exhausted else
                    "The component tree is invalid. Fix the errors and call this tool once more."
                ),
            }
            return Command(update={
                "a2ui_attempts": 0 if exhausted else attempts,
                "messages": [ToolMessage(json.dumps(payload),
                                         tool_call_id=runtime.tool_call_id)],
            })

        operations = build_operations(components, release)
        payload = {"ok": True, "a2ui_operations": operations}
        return Command(update={
            "a2ui_attempts": 0,
            "last_surface": {"surface_id": SURFACE_ID, "components": components},
            "messages": [ToolMessage(json.dumps(payload),
                                     tool_call_id=runtime.tool_call_id)],
        })

    return [render_release_surface]


checkpointer = InMemorySaver()

agent = create_agent(
    model=build_model(),
    tools=[*release_tools(), *a2ui_tools()],
    system_prompt=SYSTEM_PROMPT,
    middleware=[
        MissingKeyMiddleware(),
        SeedMiddleware(),
        CopilotKitMiddleware(expose_state=["release"]),
    ],
    state_schema=ReleaseState,
    checkpointer=checkpointer,
)
