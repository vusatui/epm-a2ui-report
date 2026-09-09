SHELL := /bin/bash

.PHONY: install dev backend frontend build

install:
	uv sync --directory backend
	pnpm --dir frontend install

backend:
	cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload

frontend:
	pnpm --dir frontend dev

# Start both servers. The trap stops only the two children we started.
# Neither is wrapped in a subshell: $$! must be the server process itself,
# or the trap kills the wrapper and leaves the server orphaned on its port.
dev:
	@trap 'kill $$BACK $$FRONT 2>/dev/null' INT TERM EXIT; \
	uv run --directory backend uvicorn main:app --host 127.0.0.1 --port 8000 --reload & BACK=$$!; \
	pnpm --dir frontend dev & FRONT=$$!; \
	wait

build:
	pnpm --dir frontend build
