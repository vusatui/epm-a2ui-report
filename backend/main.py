from fastapi import FastAPI

from modules.a2ui import endpoint as a2ui_endpoint
from modules.predefined import endpoint as predefined_endpoint
from modules.text import endpoint as text_endpoint

app = FastAPI(title="Release Readiness Agent")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


text_endpoint.register(app)
predefined_endpoint.register(app)
a2ui_endpoint.register(app)
