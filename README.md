# Release Readiness Agent

A small teaching demo for **Beyond Chat: Powering Agent-Driven Interfaces with A2UI**.

One agent, one fixture, three ways of putting it on screen:

| Page | AG-UI endpoint | Presentation |
|---|---|---|
| `/text` | `POST /api/agents/text` | Text / Markdown |
| `/predefined` | `POST /api/agents/predefined` | Complete components the developer wrote |
| `/a2ui` | `POST /api/agents/a2ui` | An interface the model composes itself |

All three run at the same time in one FastAPI application under one Uvicorn
process, with one React app in front of them. **Every release operation is
simulated** — nothing is deployed, no email is sent, no database is touched.

## Setup

```bash
cp .env.example .env      # then put your OpenRouter key in it
make install
make dev
```

- App: http://127.0.0.1:5173 (redirects to `/text`)
- API: http://127.0.0.1:8000, health at `/api/health`

`.env` is git-ignored and read only by Python. The browser never sees the key:
the frontend calls relative `/api/...` URLs, which Vite proxies to FastAPI.

```dotenv
OPENROUTER_API_KEY=
OPENROUTER_MODEL=dots-studio/dots-3-note-preview:free
```

The app starts fine without a key and says so when you use the chat, instead of
failing at the provider. `dots-studio/dots-3-note-preview:free` is free and
advertises `tools`, `tool_choice` and `structured_outputs`, which all three
scenarios need. You can set `OPENROUTER_MODEL=openrouter/free` instead, but the
free router may pick a model with weak tool-calling and the demo will get
flaky. There is no paid fallback. Fixture facts are reproducible; model output
is not deterministic.

| Command | Action |
|---|---|
| `make install` | `uv sync` in `backend/`, `pnpm install` in `frontend/` |
| `make dev` | Uvicorn and Vite together; Ctrl-C stops both |
| `make backend` | Uvicorn only, with reload |
| `make frontend` | Vite only |
| `make build` | Frontend TypeScript check and production build |

## Walkthrough

1. **Compare the three pages.** Ask each one
   `Is release 2.4 ready for production?`. `/text` answers in prose, `/predefined`
   draws a `ReleaseReview` card, `/a2ui` composes a surface. Same tools, same
   facts, three presentations.
2. **Open [`backend/common.py`](backend/common.py)** for the parts every
   scenario shares: the OpenRouter model setup, the `release-2.4` fixture
   (`SEED`), the `ReleaseState` graph state, `SeedMiddleware`, and the five
   release operations. Every operation is a pure function returning a new
   snapshot, so `SEED` is never mutated.
3. **Compare the three `agent.py` files.** They are deliberately near-identical:
   [`text`](backend/modules/text/agent.py) and
   [`predefined`](backend/modules/predefined/agent.py) differ only in their
   prompt, and [`a2ui`](backend/modules/a2ui/agent.py) adds one tool,
   `render_release_surface`. The scenarios differ in presentation, not ability.
4. **Show endpoints and frontend rendering.** Each
   [`endpoint.py`](backend/modules/a2ui/endpoint.py) has a `register(app)` that
   registers the AG-UI streaming endpoint and, for two of them, a plain POST
   action route. On the frontend,
   [`Predefined.tsx`](frontend/src/scenarios/Predefined.tsx) registers three
   components with `useComponent`, while
   [`A2UI.tsx`](frontend/src/scenarios/A2UI.tsx) hosts a page-level A2UI surface.
5. **Follow an approval submission and its A2UI data update.** On `/a2ui`, ask
   `Show me the migration risk alongside the approval form.`, fill the form and
   submit. Watch it in the Details panel: the form raises an A2UI action, the
   page POSTs to `/api/agents/a2ui/actions`, and the response carries
   `updateDataModel` messages that update the surface already on screen. No
   second agent turn, and no LLM deciding whether it worked.

Suggested prompts are listed on each page. For text-mode approval, continue with
`Request security approval from Alex Morgan with the comment: Please review the
migration risk before deployment.`

## Fixture

`release-2.4`, displayed as **Release 2.4**:

| Item | Initial state | Operation |
|---|---|---|
| Integration test | Failed: payment-provider sandbox timeout | An explicit rerun turns it green |
| Orders-index migration | High risk, review required: possible table lock | Inspecting shows details and mitigation; it does **not** resolve the review |
| Security approval | Not requested | A valid request moves it to pending |
| Reviewers | Alex Morgan, Sam Patel (stable ids) | Valid approval recipients |

Plus three passing checks. Readiness is always derived from state, never stored.
A pending approval is still a blocker, so the release never becomes "ready" —
that is the fixture being honest, not a bug.

## How state works

The release snapshot lives in LangGraph thread state, persisted by
`InMemorySaver`. Each scenario compiles its agent and checkpointer once at
startup and gets its own thread id per browser app instance. Tools never mutate
state; they return `Command(update=...)`.

A new thread id means an empty checkpoint, and `SeedMiddleware` fills it from a
fresh copy of the fixture exactly once. That is the whole reset mechanism —
there is no reset API, session API or generation system. Reset clears the
current page only (transcript, mirrored state, composed surface, form fields)
and is disabled while a run or submission is active. Navigating between pages
preserves each conversation, because messages live on the module-scope agent
instances in [`agents.ts`](frontend/src/agents.ts). Opening a second browser tab
gives you fresh threads; restarting the backend loses all state. One Uvicorn
worker.

**One sharp edge worth knowing.** The AG-UI adapter feeds `RunAgentInput.state`
into the graph on every run, and the browser echoes its mirrored copy of that
state each time. Left alone, a stale browser copy would overwrite whatever the
server wrote — including from the action routes, and including straight after a
Reset. `ReleaseAGUIAgent` in `common.py` blanks the inbound state so the
checkpoint stays authoritative. It costs nothing, because the adapter re-reads
messages from the checkpoint anyway.

One consequence worth noticing when you compare the two form scenarios: the
action route writes to the checkpoint, but the browser's mirrored agent state
only refreshes on the next agent run. `/a2ui` solves that properly — the
response carries `updateDataModel` messages and the live surface updates itself.
`/predefined` has no such channel, so `Predefined.tsx` keeps the returned
snapshot in local state until the next run supersedes it. Same problem, and a
fair illustration of what the A2UI data model buys you.

## A2UI notes

**Protocol version: v0.9.** The talk uses v0.9.1, and the two are compatible,
but the renderer in this stack builds its `MessageProcessor` without a version
option, so it runs v0.9 — and CopilotKit's Python A2UI helpers stamp `v0.9` too.
Using v0.9 consistently on both sides is simpler and avoids a mismatch nobody
would enjoy debugging. The messages are otherwise exactly the v0.9.1 shapes.

**Fixed versus dynamic composition is a separate question from protocol
choice.** A2UI can perfectly well describe a layout the developer fixed in
advance; nothing about the protocol requires a model to invent the arrangement.
This demo pairs them only to make the contrast visible: `/predefined` is fixed
composition without A2UI, `/a2ui` is dynamic composition with it. You could
build either combination.

**The catalog is the contract.**
[`contracts/release-catalog.json`](contracts/release-catalog.json) holds the
catalog id and the four domain components — `ReleaseSummary`, `BlockerList`,
`MigrationRiskCard`, `ApprovalForm`. Python reads it to build the prompt and to
validate what the model produced;
[`a2ui-catalog.tsx`](frontend/src/a2ui-catalog.tsx) registers the matching React
implementations and merges in the basic layout components. The catalog id must
be byte-identical on both sides — the renderer matches catalogs by exact string
equality, and a mismatch gives you a surface that silently never paints.

`ApprovalForm` is the point: the model decides *where* the form goes and what
surrounds it, but the form is developer-owned React that holds its own fields,
enforces its own required-field rules and raises its own submit action. The
model arranges; it does not build inputs out of primitives.

**The surface is page-level, not per-message.** It lives in one `A2UIProvider`
on the page, so follow-up turns update the same surface and the server can push
a data update into it. Operations are applied idempotently: the renderer throws
on a duplicate `createSurface`, and CopilotKit deliberately keeps historical
tool calls renderable, so `ApplyOperations` in `A2UI.tsx` skips unchanged
payloads and drops `createSurface` when the surface already exists.

If the model emits an invalid tree, Python's validator rejects it with specific
errors and the agent gets exactly one correction attempt; after that the page
shows an error with Retry. There is no fallback engine and no canned answer.

## Stack

| Layer | Version |
|---|---|
| Python | 3.12 |
| langchain / langgraph | 1.4.0 / 1.2.11 |
| copilotkit (Python) | 0.1.96 |
| ag-ui-langgraph | 0.0.45 |
| FastAPI / Uvicorn | 0.141.1 / 0.52.4 |
| @copilotkit/react-core, @copilotkit/a2ui-renderer | 1.70.3 |
| @ag-ui/client | 0.0.59 (pinned exactly by react-core) |
| React / Vite / Tailwind | 19 / 7 / 4 |

Two integration details that are easy to get wrong:

- `LangGraphAGUIAgent` comes from `copilotkit`, not from `ag_ui_langgraph` —
  that package exports the base `LangGraphAgent`. Its constructor also does not
  accept `emit_raw_events`, and the adapter clones the agent per request and
  refuses to silently drop a non-default flag, so `ReleaseAGUIAgent` accepts and
  re-applies it.
- The frontend uses CopilotKit's **v2** API
  (`@copilotkit/react-core/v2`), because the direct `HttpAgent` +
  `agents__unsafe_dev_only` connection exists only there. The v1 hooks
  (`useCopilotAction`, `useCoAgent`, `useCoAgentStateRender`) do not work under a
  v2 provider; the equivalents used here are `useComponent`, `useRenderTool` and
  `useAgent`.

A2UI is rendered with `@copilotkit/a2ui-renderer` driven directly, rather than
through CopilotKit's automatic in-transcript A2UI path. That path needs a Node
`CopilotRuntime` this demo deliberately does not have, and it binds each surface
to a single tool call, which would rule out both follow-up updates and the
server-pushed data update.

## Limitations

- Everything is in memory. Restarting the backend loses all threads and state.
- No tests and no test framework, by design.
- No authentication, no authorization, no real release operations.
- The free model is not deterministic and can be slow; requests use bounded
  timeouts and retries.
- The chat input is covered by an overlay while an action is in flight, because
  `CopilotChat` has no `disabled` prop.
