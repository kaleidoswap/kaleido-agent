# KaleidoAgent

> Autonomous Bitcoin L2 agent — Claude AI + WDK + KaleidoSwap

KaleidoAgent is a fully autonomous, non-custodial Bitcoin L2 agent. It manages a Lightning + RGB wallet, executes atomic HTLC swaps on KaleidoSwap DEX, runs DCA and portfolio strategies, handles Lightning channel liquidity, and serves as an interactive wallet assistant — all through Claude AI (or OpenAI) reasoning over the `kaleido` CLI and WDK wallet primitives.

---

## What It Does

KaleidoAgent is a general-purpose Bitcoin L2 agent. Its capabilities span several skill areas:

### Portfolio Management
- Detects allocation drift across **BTC**, **USDT (RGB)**, and **XAUT (RGB)**
- Gets live quotes from KaleidoSwap DEX and executes atomic HTLC swaps to rebalance
- Enforces risk controls: `min_btc_reserve`, `max_swap_usd`, `stop_loss`, open order limits

### Dollar Cost Averaging (DCA)
- Runs periodic fixed-size purchases of a target asset on a configurable schedule
- Optional price-aware logic: skip on pumps, double up on dips (EMA-based)

### Channel Management
- Monitors Lightning node health, outbound liquidity, and peer count
- Flushes stuck RGB transfers; detects and handles stuck pending orders
- Auto-purchases Lightning channels via LSPS1 when liquidity falls critically low

### Cross-L2 Navigation
- Guides and executes asset moves between Bitcoin Lightning, RGB channels, Spark L2, and on-chain BTC
- Advises on multi-step paths where external services are required

### Wallet Assistant (interactive)
- Conversational interface for balance checks, sending/receiving BTC and RGB assets, generating invoices, and executing swaps with confirmation
- Emits structured action blocks the React dashboard can render as UI actions

### MPP / L402 Payments
- Accesses HTTP 402-gated premium data APIs by paying via Lightning micropayments
- Discovers pay-per-call endpoints via 402index.io (`search_paid_apis`)

### Daily Reporting
- At 00:00 UTC: full portfolio snapshot across Spark + Lightning, trade history, market data

All decisions are reasoned by an LLM (Claude or OpenAI). All execution happens through the `kaleido` CLI and WDK wallet primitives. Swaps settle trustlessly on Lightning.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        KaleidoAgent                          │
│                                                              │
│  index.ts (Node.js bootstrap)                                │
│    │                                                         │
│    ├── NanobotManager ──► Nanobot gateway :18790             │
│    │     │  (core runtime: scheduling, LLM, MCP, Telegram)   │
│    │     │                                                    │
│    │     └── MCP servers (managed by Nanobot)                 │
│    │           ├── kaleido-mcp    (WDK Spark + RLN + DEX)    │
│    │           ├── kaleidoswap    (DEX REST API)             │
│    │           ├── mpp_gateway    (MPP / L402 payments)      │
│    │           └── kaleido_control (bridge → :4242 API)      │
│    │                                                          │
│    ├── StatusServer :4242  (bridge API for webapp)           │
│    │     ├── NanobotTaskRunner  (triggers agent tasks)       │
│    │     ├── NanobotChatRunner  (wallet assistant chat)      │
│    │     └── WalletBridge       (live balance cache)         │
│    │                                                          │
│    └── Scheduler  (manual / startup task triggers)           │
│                                                              │
│  React Dashboard :5173  (Vite + Tailwind)                    │
└──────────────────────────────────────────────────────────────┘
```

### Two Agent Modes

| Mode | How It Works | When To Use |
|------|-------------|-------------|
| `skill` _(default)_ | SKILL.md files are loaded as system prompt; agent calls a single `run_kaleido_command` tool that shells out to the `kaleido` CLI | Lightweight — no direct MCP connection from Node.js |
| `mcp` | Node.js connects directly to MCP servers; agent calls 60+ tools from `kaleido-mcp` | Full tool access, useful for debugging or custom setups |

In `skill` mode, Nanobot manages all MCP connections and the agent uses the `kaleido` CLI as its execution primitive.

### Three Autonomous Loops

| Loop | Default Interval | Skill | Purpose |
|------|-----------------|-------|---------|
| `rebalance` | on-demand / cron | `portfolio-manager` | Drift detection → atomic swap execution |
| `heartbeat` | 5 min | `channel-manager` | Node health, RGB flush, LSPS1 channel purchase |
| `daily_summary` | 00:00 UTC | `kaleidoagent` | Portfolio snapshot, trade history, market data |

### Skills

Skills are SKILL.md files loaded at runtime that give the agent its operational logic. They come from two places, merged into the Nanobot workspace on every sync (`npm run sync-skills`, gateway start):

- **`skills/`** — agent-specific skills: the scheduled loops, `!`kaleido command`` bash injections (executed and inlined before reaching the LLM), and dashboard action blocks.
- **[`@kaleidorg/mind`](https://www.npmjs.com/package/@kaleidorg/mind)** — the shared, generic KaleidoSwap skills, installed as a dependency and copied from the package. A local skill with the same name wins. Set `KALEIDO_MIND_SKILLS_DIR` to point at a local checkout instead.

| Skill | Source | Purpose |
|-------|--------|---------|
| `portfolio-manager` | `skills/` | Portfolio drift → atomic swap execution with full risk checks; also runs `dca` tasks |
| `channel-manager` | `skills/` | Node health, RGB flush, LSPS1 and RGB asset channel purchasing |
| `kaleidoagent` | `skills/` | Daily summary: portfolio snapshot, market data, trade history |
| `wallet-assistant` | `skills/` | Interactive wallet queries and operations via chat, with dashboard action blocks |
| `kaleido-trading` | mind | Quotes and atomic swaps on KaleidoSwap |
| `kaleido-node` | mind | Node lifecycle: start, unlock, recover |
| `rgb-lightning-node` | mind | Node info, channels, peers, invoices, swap whitelisting |
| `paid-data` | mind | MPP / L402 payment-gated data access |
| `bitrefill` | mind | Gift cards, top-ups and eSIMs via Bitrefill |

The older names `kaleidoswap`, `mpp` and `node-manager` in an existing config or task are mapped to `kaleido-trading`, `paid-data` and `kaleido-node`.

### MCP Servers (Nanobot-managed)

| Server | Purpose | Key Tools |
|--------|---------|-----------|
| `kaleido` (`kaleido-mcp`) | Unified wallet + DEX interface | `spark_*`, `wdk_*` (RLN), `kaleidoswap_*`, `kaleido_node_*`, `mpp_*` |
| `kaleidoswap` | KaleidoSwap DEX REST API | Order placement, quotes, status |
| `mpp_gateway` | MPP / L402 payment gateway | `mpp_*`, `l402_*`, `search_paid_apis` |
| `kaleido_control` | Bridge to `:4242` control API | Task triggers, config updates from agent |

---

## WDK Integration

KaleidoAgent integrates WDK at two levels:

**Spark L2 wallet** — `spark_get_balance`, `spark_pay_lightning_invoice`, `spark_transfer_token`, fee-free BTC L2 transfers

**RLN node** — `wdk_get_balances`, `wdk_pay_invoice`, `wdk_create_rgb_invoice`, Lightning channels with RGB asset support

The agent uses these tools to:
- Read multi-asset balances: combined BTC sats (RLN + Spark) + USDT RGB + XAUT RGB
- Execute atomic HTLC swaps: whitelist HTLC, provide pubkey, confirm settlement
- Purchase Lightning channels via LSPS1 when outbound liquidity drops critically low

### Atomic Swap Flow

In skill mode the CLI handles the full flow in one command:

```
swap execute BTC/USDT --from-amount <sats> --from-layer BTC_LN --to-layer RGB_LN --yes
swap atomic-status --payment-hash <hash>   ← poll if needed
asset sync                                  ← sync RGB balances
```

Manual steps (5-step HTLC protocol):

```
1. market quote BTC/USDT --from-amount <sats>  → rfq_id + amounts
2. swap atomic init ...                         → swapstring + payment_hash  (maker)
3. swap node whitelist <swapstring>             → whitelist HTLC on RLN      (taker)
4. swap atomic execute ...                      → trigger HTLC settlement    (maker)
5. swap atomic-status --payment-hash <hash>     → poll until Succeeded
```

No intermediary. No custodian. Settles atomically on Lightning.

### Channel Purchase Flow (LSPS1)

When `auto_buy_channel=true` and outbound drops below `min_outbound_liquidity_sat`:

```
1. lsp estimate-fees --capacity-sat <n>   → fee breakdown
2. lsp order-create --capacity-sat <n>    → bolt11_invoice + order_id
3. payment send <bolt11_invoice>          → Lightning payment from RLN
4. lsp order-get <order_id>              → poll → CHANNEL_OPENING → COMPLETED
```

---

## Agent Intelligence

### `portfolio-manager` skill

1. Read live balances from Spark + RLN via `kaleido` CLI
2. Compute combined BTC allocation (RLN Lightning + Spark sats)
3. Get BTC/USDT and XAUT/USDT prices, calculate current % vs. targets
4. If max drift > `rebalance_threshold_pct` (default 5%): determine swap direction
5. Apply risk checks: `min_btc_reserve_sats`, `max_swap_usd`, `stop_loss_btc_sats`, open order count
6. Get live quote → execute atomic swap → confirm settlement → `asset sync`

### `channel-manager` skill

1. Run `node status` — confirm node reachable
2. Run `channel list` — check outbound liquidity per channel
3. Run `asset fail-transfers` — flush stuck RGB transfer states
4. Check `swap node list` for stuck swaps
5. If outbound < `min_outbound_liquidity_sat` and `auto_buy_channel=true`: run LSPS1 channel purchase

The agent reasons about *why* to act (drift magnitude, opportunity cost, risk limits) — not just *how* to execute.

---

## Features

- **Non-custodial** — WDK keys stay local; agent holds no external custody
- **Atomic swaps** — HTLC-based, trustless, no deposit address needed
- **RGB assets** — USDT and XAUT as RGB assets on Lightning
- **LSPS1 liquidity management** — auto-purchases inbound/outbound when needed
- **Multi-asset tracking** — unified balance view across Spark L2 + Lightning (RLN)
- **Risk controls** — `dry_run`, `max_swap_usd`, `min_btc_reserve_sats`, `stop_loss_btc_sats`
- **MPP/L402** — agent can pay for premium market data via Lightning micropayments
- **Skill mode** — SKILL.md files with live bash injection for minimal-overhead operation
- **Telegram operator surface** — Nanobot gateway for remote control/monitoring
- **React dashboard** — live portfolio, task scheduler, connections, wallet assistant chat
- **Multi-provider LLM** — Anthropic (Claude) or OpenAI as reasoning engine
- **Docker** — production-ready containerized deployment

---

## Quick Start

### Prerequisites

- Node.js 20+
- [`kaleido` CLI](https://github.com/kaleidoswap/kaleido-cli) — in `$PATH` or set via `KALEIDO_BIN`
- [Nanobot](https://nanobot.dev) runtime — installed and accessible
- Anthropic or OpenAI API key

### Install & Run

```bash
git clone https://github.com/kaleidoswap/kaleidoagent.git
cd kaleidoagent

# Install dependencies (agent + webapp)
npm run install:all

# Configure
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY (and optionally OPENAI_API_KEY)

# Edit agent.config.json:
#   mcp.kaleido.env.WDK_SEED          ← your wallet seed
#   mcp.kaleido.env.RLN_NODE_URL      ← your RLN node URL
#   mcp.spark.env.WDK_SPARK_SEED      ← optional separate Spark seed
#   portfolio.dry_run = false         ← when ready for live trading

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
    "max_tool_calls_per_run": 30,
    "mode": "skill"
  },
  "mcp": {
    "kaleido": {
      "command": "kaleido-mcp",
      "args": [],
      "env": {
        "WDK_SEED": "",
        "SPARK_NETWORK": "REGTEST",
        "SPARK_USDT_TOKEN": "",
        "RLN_NODE_URL": "http://localhost:3001",
        "KALEIDOSWAP_API_URL": "http://localhost:8000"
      }
    },
    "spark": {
      "command": "wdk-wallet-spark-mcp",
      "args": [],
      "env": {
        "WDK_SPARK_SEED": "",
        "SPARK_NETWORK": "REGTEST",
        "SPARK_USDT_TOKEN": ""
      }
    }
  },
  "portfolio": {
    "targets": { "BTC": 70, "USDT": 20, "XAUT": 10 },
    "rebalance_threshold_pct": 5,
    "max_swap_usd": 200,
    "min_btc_reserve_sats": 50000,
    "max_concurrent_orders": 3,
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
  },
  "schedule": {
    "rebalance_interval_sec": 0,
    "heartbeat_interval_sec": 300,
    "daily_summary_cron": "00:00"
  },
  "skills": {
    "enabled": [
      "paid-data",
      "kaleidoagent", "kaleido-trading",
      "portfolio-manager", "channel-manager", "wallet-assistant"
    ]
  },
  "nanobot": {
    "gateway_port": 18790,
    "wallet_fetch_method": "cli",
    "telegram": { "allow_from": ["*"] }
  }
}
```

`rebalance_interval_sec: 0` disables the interval-based rebalance trigger; Nanobot's cron scheduler or manual `/run` calls drive rebalance execution.

### Agent Mode

| Mode | Description |
|------|-------------|
| `skill` _(default)_ | SKILL.md loaded as system prompt + single `run_kaleido_command` CLI tool |
| `mcp` | Direct MCP connection from Node.js; 60+ tools available inline |

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
| `min_btc_reserve_sats` | 50,000 | Minimum combined BTC sats (RLN + Spark) |
| `stop_loss_btc_sats` | 30,000 | Halt all trading below this BTC threshold |
| `rebalance_threshold_pct` | 5 | Min drift % to trigger a swap |
| `max_concurrent_orders` | 3 | Max open orders at once |

---

## Status API

`http://localhost:4242` (localhost only)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health |
| `/status` | GET | Full state: uptime, balances, recent runs, token costs |
| `/wallets` | GET | Live wallet snapshot (Spark + RLN balances) |
| `/run` | POST | Trigger a task: `{ "task_id": "rebalance" }` |
| `/chat` | POST | Wallet assistant: `{ "messages": [...] }` |
| `/chat/actions/swap` | POST | Execute a confirmed swap action |
| `/config` | GET/POST | Read/update agent config |
| `/tasks` | GET/POST | List or create tasks |
| `/tasks/:id` | PATCH/DELETE | Update or delete a task |
| `/skills` | GET | List skills with enabled status |
| `/skills` | PATCH | Enable/disable a skill |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | _(required*)_ | Claude API key |
| `OPENAI_API_KEY` | _(optional)_ | OpenAI API key (alternative provider) |
| `AGENT_PROVIDER` | `anthropic` | LLM provider: `anthropic` or `openai` |
| `AGENT_MODEL` | `claude-sonnet-4-6` | Model name |
| `DRY_RUN` | `true` | `false` for live trading |
| `WDK_SEED` | _(required)_ | BIP-39 mnemonic for WDK wallet |
| `KALEIDOSWAP_API_URL` | `https://api.signet.kaleidoswap.com` (required when `KALEIDO_NETWORK=mainnet`; no public mainnet default) | KaleidoSwap API |
| `RLN_NODE_URL` | `http://localhost:3001` | RLN node daemon URL |
| `SPARK_NETWORK` | `REGTEST` | Spark network: `REGTEST` or `MAINNET` |
| `SPARK_USDT_TOKEN` | _(optional)_ | RGB asset ID for USDT on Spark |
| `KALEIDO_BIN` | `kaleido` | Path to kaleido CLI binary |
| `KALEIDO_MCP_URL` | _(optional)_ | Remote kaleido-mcp URL (overrides local command) |
| `MCP_AUTH_TOKEN` | _(optional)_ | Bearer token for remote MCP auth |
| `KALEIDO_ENV_NAME` | _(optional)_ | Named kaleido environment profile |
| `TELEGRAM_BOT_TOKEN` | _(optional)_ | Telegram bot token for Nanobot gateway |
| `TELEGRAM_ALLOW_FROM` | `*` | Comma-separated Telegram user IDs |
| `CONFIG_PATH` | `./agent.config.json` | Config file path |

*Either `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is required.

---

## Development

```bash
npm run dev:agent          # Agent with tsx file-watching
npm run dev:webapp         # Vite on :5173
npm run dev:all            # Both together

npm test                   # Unit tests (Vitest)
npm run test:integration   # Integration tests (requires MCP servers)
npm run coverage           # v8 coverage report

npm run sync-skills        # Sync skills/ + @kaleidorg/mind skills to the Nanobot workspace
npm run validate           # Validate Nanobot config
npm run gateway:status     # Check Nanobot gateway status
```

### Daemon (production background process)

```bash
npm run daemon:start       # Start as background daemon
npm run daemon:stop        # Stop daemon
npm run daemon:restart     # Restart daemon
npm run daemon:status      # Show status
npm run daemon:logs        # Tail logs
```

---

## Third-Party Disclosures

| Component | License | Purpose |
|-----------|---------|---------|
| [Anthropic SDK](https://github.com/anthropic-ai/sdk-python) | MIT | Claude LLM API |
| [OpenAI SDK](https://github.com/openai/openai-node) | Apache-2.0 | OpenAI LLM API |
| [MCP SDK](https://github.com/modelcontextprotocol/sdk) | MIT | Tool protocol |
| [Nanobot](https://nanobot.dev) | Proprietary | Agent runtime + scheduling + Telegram |
| [Zod](https://github.com/colinhacks/zod) | MIT | Runtime schema validation |
| React + Vite + Tailwind | MIT | Dashboard frontend |
| Vitest | MIT | Test runner |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Agent reasoning | Claude (Anthropic) or GPT-4o (OpenAI) |
| Agent runtime | Nanobot (scheduling, MCP management, Telegram) |
| Tool protocol | MCP (Model Context Protocol) |
| Agent mode | `skill` (SKILL.md + `kaleido` CLI) or `mcp` (direct MCP) |
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
