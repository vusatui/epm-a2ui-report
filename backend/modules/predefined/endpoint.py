from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from fastapi import FastAPI

from common import (
    ApprovalActionRequest,
    ApprovalActionResponse,
    ReleaseAGUIAgent,
    submit_approval,
)

from .agent import agent

PATH = "/api/agents/predefined"


def register(app: FastAPI) -> None:
    agui_agent = ReleaseAGUIAgent(
        name="predefined",
        graph=agent,
        description="Release readiness assistant that renders predefined components.",
        emit_raw_events=False,
    )
    add_langgraph_fastapi_endpoint(app, agui_agent, PATH)

    @app.post(f"{PATH}/actions", response_model=ApprovalActionResponse)
    async def predefined_actions(body: ApprovalActionRequest):
        """Submit the approval form. An ordinary POST route, beside the adapter."""
        return await submit_approval(agent, body)
