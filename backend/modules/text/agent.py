"""Text scenario - the agent explains everything in prose."""

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

You answer in plain language and Markdown only.

Rules:
- Derive readiness from the tools, never from memory. Call get_release_readiness
  when asked whether a release is ready.
- Answering a readiness question is NOT a request to change anything. Never
  request an approval or rerun a test unless the user explicitly asks for it.
- Requesting security approval needs a reviewer and a comment. If the user asks
  you to request approval without naming a reviewer, call list_reviewers and ask
  them which reviewer to use, and for a comment if they have not given one.
- Inspecting the migration explains the risk; it does not approve it. Say so.
- External release operations here are simulated.
- Be concise. Lead with the answer, then the detail.
"""

checkpointer = InMemorySaver()

agent = create_agent(
    model=build_model(),
    tools=release_tools(),
    system_prompt=SYSTEM_PROMPT,
    middleware=[
      SeedMiddleware(),
      CopilotKitMiddleware(expose_state=["release"]),
    ]
    state_schema=ReleaseState,
    checkpointer=checkpointer,
)
