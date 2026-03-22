# KaleidoAgent

> Autonomous Bitcoin L2 portfolio rebalancer — Claude AI + WDK + KaleidoSwap

KaleidoAgent is a fully autonomous, non-custodial trading agent that maintains a target allocation across **BTC**, **USDT (RGB)**, and **XAUT (RGB)** on the Lightning Network. It uses Claude AI via MCP tools to detect portfolio drift, execute atomic HTLC swaps, and manage Lightning channel liquidity — without human intervention.

**Hackathon Galáctica: WDK Edition 1**
Tracks: **Agent Wallets (WDK + Agent Integration)** · **Autonomous DeFi Agent**

---

## Demo

> Video: _[link to be added before submission]_
> Live dashboard: `http://localhost:5173` (after running locally)

---

## What It Does

You define target allocations (e.g. 70% BTC / 20% USDT / 10% XAUT). The agent does the rest:

1. **Detects drift** — compares live balances against targets every hour
2. **Gets a live quote** from KaleidoSwap DEX
3. **Executes an atomic HTLC swap** on Lightning — no custodian, no deposit address
4. **Manages Lightning channels** via LSPS1 — auto-purchases liquidity when running low
5. **Reports** a daily portfolio snapshot + trade history

All decisions are reasoned by an LLM (Claude). All execution happens through WDK wallet primitives. All swaps settle trustlessly on-chain.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      KaleidoAgent                        │
│                                                          │
│  Scheduler ──► AgentRunner (Claude + MCP tool calls)     │
│    │                    │                                │
│    ├── rebalance loop   └──► MCP Manager                 │
│    ├── heartbeat loop         │                          │
│    └── daily summary          ├── kaleido-mcp            │
│                               │   (WDK Spark + RLN +     │
│  StatusServer :4242           │    KaleidoSwap DEX +     │
│  React Dashboard :5173        │    MPP/L402)             │
│                               └── mpp-gateway-mcp        │
│                                   (market data)          │
└──────────────────────────────────────────────────────────┘
```

### Three Autonomous Loops

| Loop | Interval | Skill | Purpose |
|------|----------|-------|---------|
| `rebalance` | 1 hour | `portfolio-manager` | Drift detection → atomic swap execution |
| `heartbeat` | 5 min | `channel-manager` | Node health, RGB flush, LSPS1 channel purchase |
| `daily_summary` | 00:00 UTC | `kaleidoagent` | Portfolio snapshot, trade history, market data |

### MCP Servers

| Server | Purpose | Key Tools |
|--------|---------|-----------|
| `kaleido-mcp` | Unified wallet + DEX interface | `spark_*`, `rln_*`, `kaleidoswap_*`, `mpp_*` |
| `mpp-gateway-mcp` | Market data + MPP/L402 | `l402_get_price`, `l402_get_ohlcv`, `mpp_*` |

---

## WDK Integration

KaleidoAgent integrates WDK at two levels:

**Spark L2 wallet** — `spark_get_balance`, `spark_send`, `spark_receive`, asset transfers on Bitcoin L2

**RLN node** — `rln_get_balances`, `rln_send_payment`, `rln_create_invoice`, Lightning channels with RGB asset support

The agent uses these tools to:
- Read multi-asset balances (BTC sats + USDT RGB + XAUT RGB)
- Execute atomic HTLC swaps as the taker: whitelist the HTLC, provide pubkey, confirm settlement
- Purchase Lightning channels via LSPS1 when outbound liquidity drops critically low

### Atomic Swap Flow (5 steps, fully coordinated by the agent)

```
1. kaleidoswap_get_quote         → rfq_id + raw amounts
2. kaleidoswap_atomic_init       → swapstring + payment_hash  (maker)
3. wdk_atomic_taker              → whitelist HTLC on RLN      (taker)
4. kaleidoswap_atomic_execute    → trigger HTLC settlement    (maker)
5. kaleidoswap_atomic_status     → poll until Succeeded
```

No intermediary. No custodian. Settles atomically on Lightning.

### Channel Purchase Flow (LSPS1)

When `auto_buy_channel=true` and outbound drops below `min_outbound_liquidity_sat`:

```
1. kaleidoswap_lsp_estimate_fees  → fee breakdown
2. kaleidoswap_lsp_create_order   → bolt11_invoice + order_id
3. wdk_pay_invoice                → Lightning payment from RLN wallet
4. kaleidoswap_lsp_get_order      → poll → CHANNEL_OPENING → COMPLETED
```

---

## Agent Intelligence

Agent behavior is defined in SKILL.md files — markdown documents loaded at startup that give the agent its operational logic, risk rules, and tool usage guidance.

### `portfolio-manager` skill

1. Read live balances from Spark + RLN via WDK tools
2. Compute current allocation vs. targets
3. If max drift > `rebalance_threshold_pct` (default 5%): determine which pair to swap
4. Apply risk checks: `min_btc_reserve`, `max_swap_usd`, `stop_loss`, open order count
5. Get live quote → execute atomic swap → confirm settlement → log result

### `channel-manager` skill

1. Read RLN node info: peer count, channel count, total/outbound capacity
2. Flush any stuck RGB transfer states
3. If outbound < `min_outbound_liquidity_sat` and `auto_buy_channel=true`: run LSPS1 channel purchase
4. Report health status

The agent reasons about *why* to act (drift magnitude, opportunity cost, risk limits) — not just *how* to execute.

---

## Features

- **Non-custodial** — WDK keys stay local; agent holds no external custody
- **Atomic swaps** — HTLC-based, trustless, no deposit address needed
- **RGB assets** — USDT and XAUT as RGB assets on Lightning
- **LSPS1 liquidity management** — auto-purchases inbound/outbound when needed
- **Multi-asset tracking** — unified balance view across Spark + Lightning
- **Risk controls** — `dry_run`, `max_swap_usd`, `min_btc_reserve`, `stop_loss`
- **MPP/L402** — agent can pay for premium market data via Lightning micropayments
- **Telegram operator surface** — Nanobot gateway for remote control/monitoring
- **React dashboard** — live portfolio, task scheduler, wallet assistant chat
- **Multi-provider LLM** — Anthropic (Claude) or OpenAI as reasoning engine
- **Docker** — production-ready containerized deployment

---

## Quick Start

### Prerequisites

- Node.js 20+
- [`kaleido` CLI](https://github.com/kaleidoswap/kaleido)
- [Nanobot](https://nanobot.dev) runtime
- Anthropic API key

### Install & Run

```bash
git clone https://github.com/kaleidoswap/kaleidoagent.git
cd kaleidoagent

# Install dependencies (agent + webapp)
npm run install:all

# Configure
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY

# Edit agent.config.json:
#   mcp.kaleido.env.WDK_SEED         ← your wallet seed
#   mcp.kaleido.env.RLN_NODE_URL     ← your RLN node
#   portfolio.dry_run = false        ← when ready for live trading

# Build
npm run build:all

# Start (foreground)
npm start

# Or background daemon
npm run daemon:start
```

Open dashboard: `http://localhost:5173`
Status API: `http://localhost:4242`

### Docker (isolated)

```bash
cp .env.container.example .env.container
# Fill in: ANTHROPIC_API_KEY, WDK_SEED, RLN_NODE_URL, etc.

docker compose --env-file .env.container \
  -f docker-compose.container.yml up -d
```

---

## Configuration

**`agent.config.json`**:

```json
{
  "agent": {
    "model": "claude-sonnet-4-6",
    "max_tokens": 4096,
    "max_tool_calls_per_run": 30
  },
  "portfolio": {
    "targets": { "BTC": 70, "USDT": 20, "XAUT": 10 },
    "rebalance_threshold_pct": 5,
    "max_swap_usd": 200,
    "min_btc_reserve_sats": 50000,
    "stop_loss_btc_sats": 30000,
    "dry_run": true,
    "trading_mode": "atomic",
    "lsp": {
      "lsp_balance_sat": 500000,
      "client_balance_sat": 20000,
      "channel_expiry_blocks": 4320,
      "min_outbound_liquidity_sat": 2000,
      "auto_buy_channel": true
    }
  }
}
```

### Trading Modes

| Mode | Description |
|------|-------------|
| `atomic` | Atomic HTLC swap — no deposit address, settles directly on Lightning |
| `rest` | REST deposit-based orders |
| `both` | Try atomic first, fall back to REST |

### Risk Controls

| Parameter | Default | Description |
|-----------|---------|-------------|
| `dry_run` | `true` | Simulate without executing real swaps |
| `max_swap_usd` | 200 | Max USD per trade |
| `min_btc_reserve_sats` | 50,000 | Minimum sats to keep in Lightning |
| `stop_loss_btc_sats` | 30,000 | Halt all trading below this threshold |
| `rebalance_threshold_pct` | 5 | Min drift % to trigger a swap |
| `max_concurrent_orders` | 3 | Max open orders at once |

---

## Status API

`http://localhost:4242`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health |
| `/status` | GET | Full state: uptime, balances, recent runs, token costs |
| `/run` | POST | Trigger a task: `{ "task": "rebalance" }` |
| `/chat` | POST | Wallet assistant: `{ "message": "..." }` |
| `/config` | GET/POST | Read/update agent config |
| `/tasks` | GET | All tasks + last run times |
| `/skills` | GET | Enabled skills |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | _(required)_ | Claude API key |
| `DRY_RUN` | `true` | `false` for live trading |
| `KALEIDOSWAP_API_URL` | `https://api.staging.kaleidoswap.com` | KaleidoSwap API |
| `RLN_NODE_URL` | `http://localhost:3001` | RLN node daemon |
| `KALEIDO_BIN` | auto-detect | Path to kaleido CLI |
| `TELEGRAM_BOT_TOKEN` | _(none)_ | Telegram operator channel |
| `CONFIG_PATH` | `./agent.config.json` | Config file path |

---

## Development

```bash
npm run dev:agent          # Agent with file-watching
npm run dev:webapp         # Vite on :5173
npm run dev:all            # Both together

npm test                   # Unit tests (Vitest)
npm run test:integration   # Integration tests (requires MCP servers)
npm run coverage           # v8 coverage

make health                # curl /health
make status                # curl /status
```

---

## Third-Party Disclosures

| Component | License | Purpose |
|-----------|---------|---------|
| [Anthropic SDK](https://github.com/anthropic-ai/sdk-python) | MIT | Claude LLM API |
| [MCP SDK](https://github.com/modelcontextprotocol/sdk) | MIT | Tool protocol |
| [OpenAI SDK](https://github.com/openai/openai-node) | Apache-2.0 | Optional LLM provider |
| [Nanobot](https://nanobot.dev) | Proprietary | Agent runtime + Telegram surface |
| [KaleidoSwap SDK](https://github.com/kaleidoswap/kaleido-sdk) | Apache-2.0 | DEX API client |
| React + Vite + Tailwind | MIT | Dashboard frontend |
| Vitest | MIT | Test runner |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Agent reasoning | Claude (Anthropic SDK) |
| Agent runtime | Nanobot |
| Tool protocol | MCP (Model Context Protocol) |
| Wallet | WDK — Spark L2 + RLN Lightning node |
| DEX | KaleidoSwap |
| Assets | BTC · USDT (RGB) · XAUT (RGB) |
| Swap protocol | Atomic HTLC + REST fallback |
| Channel liquidity | LSPS1 |
| Backend | Node.js 20 · TypeScript |
| Frontend | React 18 · Vite · Tailwind CSS |
| Container | Docker · Nginx |

---

## License

[Apache 2.0](LICENSE)
