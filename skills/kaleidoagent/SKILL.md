---
name: kaleidoagent
description: Autonomous Bitcoin L2 portfolio rebalancer for KaleidoSwap. Maintains target allocations across BTC, USDT (RGB), and XAUT (RGB) by executing swaps on Lightning Network as a taker. Uses three MCP servers — KaleidoSwap (swap engine), WDK Wallet (RLN node), L402 Gateway (market data).
license: Apache-2.0
compatibility: Requires kaleidoswap-mcp, wdk-wallet-mcp, and l402-gateway-mcp MCP servers plus an RLN daemon at RLN_NODE_URL.
metadata:
  author: tetherto
  version: "1.0.0-beta.1"
  networks: bitcoin-lightning, rgb
---

# KaleidoAgent — Bitcoin L2 Portfolio Rebalancer

Autonomous portfolio rebalancing agent for [KaleidoSwap](https://kaleidoswap.com), a decentralized exchange for Bitcoin and RGB assets on the Lightning Network. Acts as a **taker**: requests quotes, places orders, and pays the deposit to execute swaps.

## MCP Servers Required

You must have all three MCP servers connected before acting:

| Server | Tools prefix | Purpose |
|--------|-------------|---------|
| `kaleidoswap-mcp` | `kaleidoswap_` | Swap quotes, order placement, status |
| `wdk-wallet-mcp` | `wdk_` | RLN wallet: balances, invoices, payments, channels |
| `l402-gateway-mcp` | `l402_` | Market data: prices, OHLCV, sentiment |

See [references/tools.md](references/tools.md) for the complete tool reference.

## Three Operating Loops

### 1. Rebalance (configurable interval, default 5min)

Goal: maintain target portfolio allocation. Swap from over-allocated to under-allocated assets when drift exceeds threshold.

```
1. wdk_get_node_info          → confirm node online (abort if unreachable)
2. wdk_get_balances           → BTC Lightning balance (lightning_balance_sat)
3. wdk_list_assets            → discover RGB asset IDs by ticker
4. wdk_get_asset_balance      → USDT balance, XAUT balance
5. l402_get_price             → BTC and XAUT prices in USD
6. [calculate USD values and allocation percentages]
7. [compare vs targets; skip if max drift ≤ threshold]
8. kaleidoswap_get_open_orders → skip if at max_concurrent_orders
9. [choose swap: most over-allocated → most under-allocated]
10. [execute swap — see Swap Flows below]
11. kaleidoswap_get_order_status → poll until FILLED or FAILED
12. wdk_refresh_transfers     → sync RGB asset balance
```

**Allocation formula:**
```
BTC_usd  = (lightning_balance_sat / 1e8) * btc_price
USDT_usd = usdt.settled + usdt.offchain_inbound
XAUT_usd = xaut_amount * xaut_price   (skip if not configured)
total_usd = BTC_usd + USDT_usd + XAUT_usd
drift = |current_pct - target_pct| for each asset
```

### 2. Heartbeat (every 5min)

Goal: verify node health and flush pending transfers.

```
1. wdk_get_node_info          → uptime check
2. wdk_list_channels (usable_only: true) → liquidity summary
3. wdk_refresh_transfers      → flush pending RGB transfers
4. kaleidoswap_get_open_orders → check for stuck orders
```

### 3. Daily Summary (00:00)

Goal: full portfolio snapshot.

```
1. wdk_get_balances + wdk_get_asset_balance (all assets)
2. l402_get_price (BTC, USDT, XAUT)
3. l402_get_ohlcv (BTC, days: 1)
4. kaleidoswap_get_position   → session trade stats
5. Output JSON summary report with allocation percentages
```

## Risk Rules (ALWAYS enforce)

- **dry_run=true** → describe what you *would* do, but do NOT call `kaleidoswap_place_order`, `wdk_pay_invoice`, or `wdk_send_asset`
- **max_swap_usd** → never exceed this per-trade USD limit
- **min_btc_reserve_sats** → never let Lightning balance drop below this
- **max_concurrent_orders** → check `kaleidoswap_get_open_orders` first; skip if at limit
- **stop_loss_btc_sats** → if total BTC balance falls below this, halt all trading immediately

## Trading Mode Selection

The `portfolio.trading_mode` parameter controls which swap mechanism is used:

| Mode | Behavior |
|------|----------|
| `"atomic"` | Always use 5-step atomic HTLC swap (no deposit address) |
| `"rest"` | Always use deposit-based REST orders (current legacy flow) |
| `"both"` | Try atomic first; if channel outbound < `min_outbound_liquidity_sat`, fall back to REST |

Before any atomic swap, check `wdk_list_channels` → `total_outbound_msat`. If outbound is too low and `auto_buy_channel=true`, run the Channel Purchase Flow first.

## Swap Flows

### Atomic Swap Flow (5 steps)

Settles directly over Lightning HTLCs — no deposit address, no waiting.

```
kaleidoswap_get_quote
  from_asset_id, to_asset_id, from_layer, to_layer, from_amount
  ↓ {rfq_id, from_asset.amount_raw, to_asset.amount_raw}

kaleidoswap_atomic_init
  rfq_id, from_asset_id, from_amount_raw, to_asset_id, to_amount_raw
  ↓ {swapstring, payment_hash}

wdk_atomic_taker                    # MUST be before execute
  swapstring: <swapstring>
  ↓ HTLC whitelisted on RLN node

wdk_get_node_info                   # get taker pubkey
  ↓ {pubkey: <taker_pubkey>}

kaleidoswap_atomic_execute
  swapstring, taker_pubkey, payment_hash
  ↓ HTLC settlement triggered

kaleidoswap_atomic_status           # poll until terminal
  payment_hash: <payment_hash>
  ↓ status: Waiting → Pending → Succeeded | Failed | Expired
```

### REST Order Flow (deposit-based, legacy)

#### BTC → USDT (Lightning BTC in, RGB USDT out)

```
wdk_create_rgb_invoice              # get USDT receive address
  asset_id: <USDT rgb:...>
  ↓ invoice string

kaleidoswap_place_order
  from_asset_id: "BTC"
  to_asset_id: <USDT rgb:...>
  from_layer: "BTC_LN"
  to_layer: "RGB_LN"
  receiver_address: <rgb_invoice>
  receiver_address_format: "RGB_INVOICE"
  ↓ deposit_address (BOLT11, format=BTC_LN)

wdk_pay_invoice                     # fund the swap
  invoice: <deposit_address.address>

kaleidoswap_get_order_status        # poll until FILLED
wdk_refresh_transfers               # sync RGB balance
```

#### USDT → BTC (RGB USDT in, Lightning BTC out)

```
wdk_create_ln_invoice               # get BTC receive invoice
  amount_msat: <swap_amount_sats * 1000>
  ↓ ln_invoice string

kaleidoswap_place_order
  from_asset_id: <USDT rgb:...>
  to_asset_id: "BTC"
  from_layer: "RGB_LN"
  to_layer: "BTC_LN"
  receiver_address: <ln_invoice>
  receiver_address_format: "BOLT11"
  ↓ deposit_address (RGB_INVOICE, format=RGB_LN)

wdk_send_asset                      # fund the swap with USDT
  asset_id: <USDT rgb:...>
  recipient_id: <deposit_address.address>
  amount: <usdt_amount>

kaleidoswap_get_order_status        # poll until FILLED
wdk_refresh_transfers               # sync balances
```

### Channel Purchase Flow (LSPS1 via Lightning)

Use when `wdk_list_channels` shows insufficient outbound liquidity and `auto_buy_channel=true`.

```
wdk_get_node_info
  ↓ {pubkey: <client_pubkey>, ...}

wdk_connect_peer                    # ensure connected to LSP before ordering
  peer_pubkey_and_addr: "<lsp_pubkey>@<host>:<port>"

kaleidoswap_lsp_estimate_fees
  client_pubkey, lsp_balance_sat, client_balance_sat, channel_expiry_blocks
  ↓ {total_fee, setup_fee, capacity_fee, duration_fee}  (all in sats)

kaleidoswap_lsp_create_order
  client_pubkey, lsp_balance_sat, client_balance_sat,
  required_channel_confirmations, funding_confirms_within_blocks,
  channel_expiry_blocks, announce_channel
  ↓ {order_id, bolt11_invoice, order_total_sat}

wdk_pay_invoice                     # pay Lightning invoice for channel
  invoice: <bolt11_invoice>

kaleidoswap_lsp_get_order           # poll until channel opens
  order_id: <order_id>
  ↓ order_state: CREATED → CHANNEL_OPENING → COMPLETED | FAILED
```

## Output Format

Always return a structured JSON object:

```json
{
  "loop": "rebalance | heartbeat | daily_summary",
  "timestamp": "<ISO 8601>",
  "action": "rebalanced | balanced | skipped | alert | report",
  "dry_run": true,
  "portfolio": {
    "before": { "BTC": 65, "USDT": 25, "XAUT": 10 },
    "after":  { "BTC": 70, "USDT": 20, "XAUT": 10 },
    "total_usd": 1234.56
  },
  "reason": "brief explanation",
  "details": {}
}
```

## Safety Rules

1. Never trade if `wdk_get_node_info` fails
2. Always check `kaleidoswap_get_open_orders` before placing a new order
3. On any tool error: log and skip — never retry in a tight loop
4. RGB asset IDs vary by network — always resolve from `wdk_list_assets`, never hardcode
5. For BTC→USDT: `deposit_address.format` = `BTC_LN` → pass `deposit_address.address` to `wdk_pay_invoice`
6. For USDT→BTC: `deposit_address.format` = `RGB_LN` → pass `deposit_address.address` to `wdk_send_asset` as `recipient_id`
