SHELL := /bin/sh

.PHONY: help install install-agent install-webapp dev dev-agent dev-webapp build build-agent build-webapp test test-agent test-integration test-all coverage start daemon-start daemon-stop daemon-status daemon-logs preview-webapp health status validate sync-skills container-build container-up container-down container-logs

help:
	@echo "Targets:"
	@echo "  make install         - install deps for agent + webapp"
	@echo "  make dev             - run agent + webapp together"
	@echo "  make dev-agent       - run agent dev server"
	@echo "  make dev-webapp      - run webapp dev server"
	@echo "  make build           - build agent + webapp"
	@echo "  make test            - run unit tests"
	@echo "  make test-all        - run all tests"
	@echo "  make coverage        - run unit coverage"
	@echo "  make start           - start compiled agent"
	@echo "  make daemon-start    - start the manual background daemon"
	@echo "  make daemon-stop     - stop the background daemon"
	@echo "  make daemon-status   - show daemon status"
	@echo "  make daemon-logs     - tail daemon logs"
	@echo "  make preview-webapp  - preview webapp build on :5173"
	@echo "  make health          - GET /health on local agent"
	@echo "  make status          - GET /status on local agent"
	@echo "  make validate        - validate Nanobot config + skills"
	@echo "  make sync-skills     - sync the local skills tree into the Nanobot workspace"
	@echo "  make container-build - build the containerized dashboard + agent stack"
	@echo "  make container-up    - start the containerized stack"
	@echo "  make container-down  - stop the containerized stack"
	@echo "  make container-logs  - tail the containerized stack logs"

install: install-agent install-webapp

install-agent:
	pnpm install

install-webapp:
	pnpm --prefix webapp install

dev:
	pnpm run dev:all

dev-agent:
	npm run dev:agent

dev-webapp:
	npm run dev:webapp

build:
	pnpm run build:all

build-agent:
	pnpm run build:agent

build-webapp:
	pnpm run build:webapp

test:
	pnpm run test

test-agent:
	pnpm run test:agent

test-integration:
	pnpm run test:integration

test-all:
	pnpm run test:all

coverage:
	pnpm run coverage

start:
	pnpm run start

daemon-start:
	pnpm run daemon:start

daemon-stop:
	pnpm run daemon:stop

daemon-status:
	pnpm run daemon:status

daemon-logs:
	pnpm run daemon:logs

preview-webapp:
	pnpm run start:webapp

health:
	curl -sS http://127.0.0.1:4242/health

status:
	curl -sS http://127.0.0.1:4242/status

validate:
	pnpm run validate

sync-skills:
	pnpm run sync-skills

container-build:
	docker compose --env-file .env.container -f docker-compose.container.yml build

container-up:
	docker compose --env-file .env.container -f docker-compose.container.yml up -d

container-down:
	docker compose --env-file .env.container -f docker-compose.container.yml down

container-logs:
	docker compose --env-file .env.container -f docker-compose.container.yml logs -f
