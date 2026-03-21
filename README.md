# kaleido-agent

Autonomous Bitcoin L2 portfolio rebalancer for [KaleidoSwap](https://kaleidoswap.com).

Uses Claude AI + three MCP servers to maintain target allocations across BTC, USDT (RGB), and XAUT (RGB) on the Lightning Network. Supports **atomic HTLC swaps**, **deposit-based REST orders**, and **automatic Lightning channel purchasing** via LSPS1.

## Architecture

```
kaleido-agent
  ├── kaleidoswap-mcp    — KaleidoSwap API: quotes, orders, atomic swaps, LSP channels
  ├── wdk-wallet-mcp     — RLN node: balances, invoices, payments, atomic taker
  └── mpp-gateway-mcp   — Market data: prices, OHLCV, Fear & Greed sentiment
```

The agent runs three loops on configurable schedules:

| Loop | Default interval | Purpose |
|------|-----------------|---------|
| `rebalance` | 5 min | Check allocation drift → execute swap if above threshold |
| `heartbeat` | 5 min | Node health check, flush pending RGB transfers |
| `daily_summary` | 00:00 | Full portfolio snapshot and trade history |

## Swap Modes

Set `portfolio.trading_mode` in `agent.config.json`:

| Mode | Behavior |
|------|----------|
| `"atomic"` | 5-step HTLC swap — no deposit address, settles directly on Lightning |
| `"rest"` | Deposit-based REST order flow |
| `"both"` | Try atomic first; fall back to REST if outbound liquidity is insufficient |

### Atomic Swap Flow

```
kaleidoswap_get_quote         → rfq_id + raw amounts
kaleidoswap_atomic_init       → swapstring + payment_hash
wdk_atomic_taker              → whitelist HTLC on RLN node
wdk_get_node_info             → taker_pubkey
kaleidoswap_atomic_execute    → HTLC settlement triggered
kaleidoswap_atomic_status     → poll → Succeeded
```

### Channel Purchase Flow (LSPS1)

When outbound liquidity drops below `lsp.min_outbound_liquidity_sat` and `lsp.auto_buy_channel=true`:

```
wdk_get_node_info              → client_pubkey
kaleidoswap_lsp_estimate_fees  → fee breakdown in sats
kaleidoswap_lsp_create_order   → bolt11_invoice + order_id
wdk_pay_invoice                → Lightning payment
kaleidoswap_lsp_get_order      → poll → CHANNEL_OPENING | COMPLETED
```

## Requirements

- Node.js 20+
- [RGB Lightning Node](https://github.com/RGB-Tools/rgb-lightning-node) running at `RLN_NODE_URL`
- Built MCP servers: `kaleidoswap-mcp`, `wdk-wallet-mcp`, `mpp-gateway-mcp`
- Anthropic API key

## Installation

```bash
npm install
npm run build

# Build the MCP servers too
cd ../kaleidoswap-mcp && npm install && npm run build
cd ../wdk-wallet-mcp && npm install && npm run build
cd ../mpp-gateway-mcp && npm install && npm run build
```

## Configuration

Edit `agent.config.json`:

```json
{
  "agent": {
    "model": "claude-opus-4-6",
    "max_tokens": 4096,
    "max_tool_calls_per_run": 20
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
      "lsp_balance_sat": 100000,
      "client_balance_sat": 0,
      "channel_expiry_blocks": 4320,
      "min_outbound_liquidity_sat": 20000,
      "auto_buy_channel": false
    }
  }
}
```

## Running

```bash
# Dry run (default — describes swaps but does not execute)
ANTHROPIC_API_KEY=sk-ant-... node dist/index.js

# Live trading
ANTHROPIC_API_KEY=sk-ant-... DRY_RUN=false node dist/index.js
```

### Quick Commands

```bash
# Install both agent + webapp deps
make install

# Run both services together (agent on :4242, webapp on :5173)
make dev

# Build both projects
make build

# Unit tests
make test
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | _(required)_ | Claude API key |
| `DRY_RUN` | `true` | Set to `false` to enable live trading |
| `KALEIDOSWAP_API_URL` | `https://api.staging.kaleidoswap.com` | KaleidoSwap API URL |
| `RLN_NODE_URL` | `http://localhost:3001` | RLN daemon URL |
| `L402_GATEWAY_URL` | _(none)_ | L402 proxy URL (optional) |
| `CONFIG_PATH` | `./agent.config.json` | Path to config file |

## Risk Controls

The agent enforces these limits on every run:

- `dry_run=true` — never executes real swaps unless explicitly disabled
- `max_swap_usd` — per-trade USD cap
- `min_btc_reserve_sats` — minimum Lightning balance to maintain
- `max_concurrent_orders` — checks open orders before placing new ones
- `stop_loss_btc_sats` — halts all trading if BTC balance falls below threshold

## License

Apache-2.0
