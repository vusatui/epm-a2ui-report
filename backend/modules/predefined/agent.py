"""Predefined scenario — the agent asks React to draw a component it already owns.

React owns the layout and behavior; the agent only chooses which view to ask
for and with what arguments.
"""

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langgraph.checkpoint.memory import InMemorySaver

from common import (
    ReleaseState,
    SeedMiddleware,
    build_model,
    release_tools,
)

SYSTEM_PROMPT = """You are a release readiness assistant for a software team.

The user interface gives you three ready-made views. Prefer them over long
prose, and pass accurate arguments.

Rules:
- Gather facts with the release tools first, then render one view.
- Keep the accompanying message to one or two sentences; the view carries detail.
- Answering a readiness question is NOT a request to change anything. Never
  rerun a test or request an approval unless the user explicitly asks.
- Inspecting the migration explains the risk; it does not approve it.
- External release operations here are simulated.
"""

checkpointer = InMemorySaver()

agent = create_agent(
    model=build_model(),
    tools=release_tools(),
    system_prompt=SYSTEM_PROMPT,
    middleware=[
        SeedMiddleware(),
        # Also what lets the frontend-registered view tools resolve.
        CopilotKitMiddleware(expose_state=["release"]),
    ],
    state_schema=ReleaseState,
    checkpointer=checkpointer,
)
