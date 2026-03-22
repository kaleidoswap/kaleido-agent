# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

KaleidoAgent is an autonomous Bitcoin L2 portfolio rebalancer for [KaleidoSwap](https://kaleidoswap.com). It uses Claude AI with MCP (Model Context Protocol) servers to maintain target allocations across BTC, USDT (RGB), and XAUT (RGB) on the Lightning Network, executing atomic HTLC swaps and managing Lightning channels via LSPS1.

## Commands

```bash
# Install
npm run install:all        # Install both agent + webapp deps

# Development
npm run dev:agent          # Run agent (tsx, file watching)
npm run dev:webapp         # Vite dev server on :5173
npm run dev:all            # Run both together

# Build
npm run build:agent        # tsc compile agent → /dist
npm run build:webapp       # Vite build webapp
npm run build:all          # Build both

# Run compiled agent
npm start

# Tests
npm test                   # Unit tests
npm run test:watch         # Watch mode
npm run test:integration   # Integration tests
npm run coverage           # v8 coverage report

# Run a single test file
npx vitest run tests/unit/scheduler.test.ts
```

The status server runs on `127.0.0.1:4242`. Check health with:
```bash
make health   # curl /health
make status   # curl /status (full state JSON)
```

## Architecture

The project is a Node.js/TypeScript monorepo: agent backend in `/src`, React webapp in `/webapp`.

### Agent Backend (`/src`)

The agent has three operational loops, each driven by a separate agent turn via Claude:
- **rebalance** — detects allocation drift vs. targets, executes swaps
- **heartbeat** — node health, RGB transfer flush, channel management
- **daily_summary** — full portfolio snapshot, trade history

**Execution flow:** `index.ts` → connects 4 MCP servers → starts `Scheduler` + `StatusServer` → loops trigger `agent-runner.ts` → LLM turn with MCP tools → results written to `AgentState`.

**Key files:**
- `index.ts` — entry point; boots MCP, scheduler, status server
- `agent-runner.ts` — single agent turn; handles Anthropic + OpenAI providers; tracks token costs
- `scheduler.ts` — manual trigger API (no built-in cron; loops fire on demand or via HTTP)
- `mcp-manager.ts` — spawns MCP server processes, collects tools, executes tool calls
- `chat-runner.ts` — single-turn wallet assistant; parses `<action>` tags for swap/navigate
- `status-server.ts` — HTTP API on :4242 (`/status`, `/config`, `/run`, `/chat`, `/health`)
- `agent-state.ts` — in-memory state: loop stats, portfolio snapshot, cumulative costs
- `config-store.ts` — runtime config (provider, model, API keys); persists to `.env`
- `agent-config-store.ts` — portfolio + schedule config; reads/writes `agent.config.json`
- `prompts.ts` — system prompts and tool name allowlists per loop type
- `providers/` — `AIProvider` interface with Anthropic and OpenAI implementations

### MCP Servers (external processes)

Four MCP servers are spawned as child processes:
| Server | Purpose |
|---|---|
| `kaleidoswap-mcp` | KaleidoSwap API: quotes, orders, atomic swaps, LSPS1 channel purchase |
| `wdk-wallet-rln-mcp` | RLN node: balances, invoices, payments, atomic taker role |
| `mpp-gateway-mcp` | Market data: prices, OHLCV, sentiment |
| `kaleido-node-mcp` | Kaleido node lifecycle management |

Their connection params are configured in `agent.config.json` under `mcp.*`.

### Webapp (`/webapp`)

React + Vite + Tailwind CSS. Polls `/status` every 5s via `useAgentStatus` hook.

Key components: `Sidebar` (loop run buttons + stats), `LoopCard` (per-loop stats), `ChatPanel` (wallet assistant), `SettingsPanel` (provider/model/API key), `ActionModal` (handles swap/navigate actions from chat).

## Configuration

**`agent.config.json`** — primary config file (portfolio targets, MCP server params, schedule intervals):
```json
{
  "agent": { "model": "claude-sonnet-4-6", "max_tokens": 2048, "max_tool_calls_per_run": 20 },
  "mcp": { "kaleidoswap": {...}, "wdk_wallet": {...}, "mpp_gateway": {...}, "kaleido_node": {...} },
  "portfolio": {
    "targets": { "BTC": 70, "USDT": 20, "XAUT": 10 },
    "rebalance_threshold_pct": 5,
    "max_swap_usd": 200,
    "dry_run": true,
    "trading_mode": "atomic"
  },
  "schedule": { "rebalance_interval_sec": 3600, "heartbeat_interval_sec": 3600 }
}
```

**`.env`** — secrets only (written by `config-store.ts`):
```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...       # optional
```

**Key env vars:**
- `DRY_RUN` — defaults to `true`; set `false` for live trading
- `KALEIDOSWAP_API_URL` — defaults to `https://api.staging.kaleidoswap.com`
- `RLN_NODE_URL` — defaults to `http://localhost:3001`
- `CONFIG_PATH` — defaults to `./agent.config.json`

## Swap Modes

- **atomic** — 5-step HTLC (fast, no deposit address needed)
- **rest** — deposit-based REST orders (fallback)
- **both** — try atomic first, fall back to REST

The atomic swap flow uses `kaleidoswap-mcp` for maker side and `wdk-wallet-rln-mcp` for taker side, coordinated by the agent within a single tool-call sequence.

## Testing

Tests live in `/tests/unit/` and `/tests/integration/`. Vitest with `pool: 'forks'`. The unit tests mock MCP connections and provider calls. Integration tests (`heartbeat.test.ts`) require real MCP servers.

When modifying scheduler or agent-runner logic, the corresponding unit tests in `/tests/unit/` must be updated.
