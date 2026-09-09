"""FastAPI/AG-UI endpoint plus the form-action route for the A2UI scenario.

The action route is the interesting half. When the A2UI form submits, this
route validates it, updates the thread's state, and returns real A2UI
updateDataModel messages. The browser applies them to the surface that is
already on screen, so the result of the action shows up without a second agent
turn and without an LLM deciding whether it succeeded.

The HTTP envelope around those messages is application-specific; the messages
inside it are ordinary A2UI.
"""

from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from copilotkit import a2ui
from fastapi import FastAPI

from common import (
    ApprovalActionRequest,
    ApprovalActionResponse,
    ReleaseAGUIAgent,
    read_release,
    submit_approval,
)

from .agent import SURFACE_ID, agent, surface_data

PATH = "/api/agents/a2ui"


def register(app: FastAPI) -> None:
    agui_agent = ReleaseAGUIAgent(
        name="a2ui",
        graph=agent,
        description="Release readiness assistant that composes its own A2UI interface.",
        emit_raw_events=False,
    )
    add_langgraph_fastapi_endpoint(app, agui_agent, PATH)

    @app.post(f"{PATH}/actions", response_model=ApprovalActionResponse)
    async def a2ui_actions(body: ApprovalActionRequest) -> ApprovalActionResponse:
        response = await submit_approval(agent, body)

        # Refresh the live surface from whatever the state now says. On failure
        # that is the unchanged snapshot, so the form simply shows the error.
        release = response.release or await read_release(agent, body.thread_id)
        response.a2ui_operations = [
            a2ui.update_data_model(SURFACE_ID, surface_data(release))
        ]
        return response
