from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from fastapi import FastAPI

from common import ReleaseAGUIAgent

from .agent import agent

PATH = "/api/agents/text"


def register(app: FastAPI) -> None:
    """Expose the compiled agent as an HTTP streaming endpoint."""
    agui_agent = ReleaseAGUIAgent(
        name="text",
        graph=agent,
        description="Release readiness assistant that answers in text.",
        # Raw LangGraph events would double every payload and swamp Details.
        emit_raw_events=False,
    )
    add_langgraph_fastapi_endpoint(app, agui_agent, PATH)
