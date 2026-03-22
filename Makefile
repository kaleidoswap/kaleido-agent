SHELL := /bin/sh

.PHONY: help install install-agent install-webapp dev dev-agent dev-webapp build build-agent build-webapp test test-agent test-integration test-all coverage start preview-webapp health status

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
	@echo "  make preview-webapp  - preview webapp build on :5173"
	@echo "  make health          - GET /health on local agent"
	@echo "  make status          - GET /status on local agent"

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

preview-webapp:
	pnpm run start:webapp

health:
	curl -sS http://127.0.0.1:4242/health

status:
	curl -sS http://127.0.0.1:4242/status
