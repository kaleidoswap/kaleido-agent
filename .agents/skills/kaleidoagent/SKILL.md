---
name: kaleidoagent
description: Autonomous Bitcoin L2 market-making agent for KaleidoSwap. Executes BTC/RGB-asset swaps on Lightning Network using three MCP servers — KaleidoSwap (swap engine), WDK Wallet (RLN node), L402 Gateway (market data). Use when performing automated trading, swap execution, arbitrage scanning, or portfolio monitoring on Lightning Network.
license: Apache-2.0
compatibility: Requires kaleidoswap-mcp, wdk-wallet-rln-mcp, and mpp-gateway-mcp MCP servers plus an RLN daemon at RLN_NODE_URL.
metadata:
  author: kaleidoswap
  version: "1.1.0"
  networks: bitcoin-lightning, rgb
---

# KaleidoAgent — Bitcoin L2 Market Maker

Autonomous market-making agent for [KaleidoSwap](https://kaleidoswap.com), a decentralized exchange for Bitcoin and RGB assets on the Lightning Network.

## MCP Servers Required

You must have all three MCP servers connected before acting:

| Server | Tools prefix | Purpose |
|--------|-------------|---------|
| `kaleidoswap-mcp` | `kaleidoswap_` | Swap quotes, order placement, status |
| `wdk-wallet-rln-mcp` | `wdk_` | RLN wallet: balances, invoices, payments, channels |
| `mpp-gateway-mcp` | `l402_` | Market data: prices, OHLCV, sentiment |

See [references/tools.md](references/tools.md) for the complete tool reference.

## Four Operating Loops

### 1. Market Making (every 30s)

Goal: capture spread by executing small BTC↔USDT swaps, directionally biased by sentiment.

```
1. wdk_get_node_info          → confirm node online
2. wdk_get_balances           → BTC Lightning balance
3. wdk_get_asset_balance      → USDT balance (asset_id from wdk_list_assets)
4. l402_get_sentiment         → Fear & Greed index + trading_signal
5. kaleidoswap_get_spreads    → current route spreads for BTC/USDT
6. [decide: trade or skip]
7. wdk_create_rgb_invoice     → get receiver address (RGB invoice)
8. kaleidoswap_place_order    → returns deposit_address (BOLT11 invoice)
9. wdk_pay_invoice            → pay deposit_address to fund the swap
10. kaleidoswap_get_order_status → poll until FILLED or FAILED
11. wdk_refresh_transfers     → sync RGB asset balance
```

### 2. Arbitrage Scan (every 60s)

Goal: detect round-trip profit opportunities across BTC/USDT routes.

```
1. kaleidoswap_get_spreads for BTC→USDT (all routes)
2. kaleidoswap_get_spreads for USDT→BTC (all routes)
3. Calculate: if round-trip > 100.3% of input → opportunity found
4. Check balances → execute both legs if sufficient
```

### 3. Heartbeat (every 5min)

Goal: verify node health and flush pending transfers.

```
1. wdk_get_node_info          → uptime check
2. wdk_list_channels (usable_only: true) → liquidity summary
3. wdk_refresh_transfers      → flush pending RGB transfers
```

### 4. Daily Summary (00:00)

Goal: full portfolio snapshot.

```
1. wdk_get_balances + wdk_get_asset_balance (all assets)
2. l402_get_ohlcv (BTC, days: 1)
3. kaleidoswap_get_position   → session trade stats
4. Output JSON summary report
```

## Risk Rules (ALWAYS enforce)

- **dry_run=true** → describe what you *would* do, but do NOT call `kaleidoswap_place_order` or `wdk_pay_invoice`
- **max_swap_btc** → never exceed per-trade limit in BTC
- **max_swap_usdt** → never exceed per-trade limit in USDT
- **min_btc_reserve_sats** → never let Lightning balance drop below this
- **max_concurrent_orders** → check `kaleidoswap_get_open_orders` first; skip if at limit
- **stop_loss_btc_sats** → if total BTC balance falls below this, halt all trading immediately

## Swap Flow (critical path)

The deposit flow for BTC→USDT via Lightning:

```
wdk_create_rgb_invoice              # get USDT receive address
  ↓ invoice string
kaleidoswap_place_order             # create swap, get BOLT11 deposit invoice
  from_asset_id: "BTC"
  to_asset_id: "<USDT rgb:...>"
  from_layer: "BTC_LN"
  to_layer: "RGB_LN"
  receiver_address: <rgb_invoice>
  receiver_address_format: "RGB_INVOICE"
  ↓ deposit_address (BOLT11)
wdk_pay_invoice                     # fund the swap
  invoice: <deposit_address.address>
  ↓
kaleidoswap_get_order_status        # poll until status = FILLED
  ↓
wdk_refresh_transfers               # sync RGB balance
```

## Output Format

Always return a structured JSON object:

```json
{
  "loop": "market_making | arbitrage | heartbeat | daily_summary",
  "timestamp": "<ISO 8601>",
  "action": "placed_order | skipped | alert | report",
  "dry_run": true,
  "reason": "brief explanation",
  "details": {}
}
```

## Safety Rules

1. Never trade if `wdk_get_node_info` fails
2. Always check `kaleidoswap_get_open_orders` before placing a new order
3. On any tool error: log and skip — never retry in a tight loop
4. RGB asset IDs vary by network — always resolve from `wdk_list_assets`, never hardcode
5. `deposit_address.format` will be `BTC_LN` for Lightning swaps — always pass `deposit_address.address` to `wdk_pay_invoice`
