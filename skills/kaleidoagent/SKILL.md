---
name: kaleidoagent
description: Autonomous Bitcoin L2 portfolio rebalancer for KaleidoSwap. Maintains target allocations across BTC, USDT (RGB/Spark), and XAUT (RGB) using a single unified MCP server (kaleido-mcp) that provides WDK Spark wallet, RLN node, KaleidoSwap DEX, MPP/L402 payments, and 402index.io discovery in one connection.
license: Apache-2.0
compatibility: Requires kaleido-mcp MCP server with WDK_SEED configured.
metadata:
  author: kaleidoswap
  version: "3.0.0"
  networks: bitcoin-lightning, rgb, spark-l2
---

# KaleidoAgent — Bitcoin L2 Portfolio Rebalancer

## Live State (injected at runtime — daily_summary mode)

**BTC wallet balance:**
!`kaleido --json wallet balance`

**RGB assets held:**
!`kaleido --json asset list`

**Lightning channels:**
!`kaleido --json channel list`

**Recent swap history (last 20):**
!`kaleido --json --agent swap order history --limit 20`

**Market assets & pairs:**
!`kaleido --json market assets`

---

## Available Tool (Skill Mode)

`run_kaleido_command({ command })` — runs `kaleido --json <command>`.

**Balances & state:**
- `"wallet balance"` — BTC on-chain + Lightning balance
- `"asset list"` — RGB assets held (USDT, XAUT, etc.)
- `"channel list"` — Lightning channels with liquidity
- `"node info"` — node pubkey, peers, sync status

**Market data:**
- `"market quote BTC/USDT --from-amount 100000 --from-layer BTC_LN"` — BTC price
- `"market assets"` — all tradeable assets with precision
- `"market pairs"` — available trading pairs
- `"market routes BTC/USDT"` — swap routes for a pair
- `"market analytics"` — order statistics and volume data
- `"market info"` — maker node info (pubkey, version)

**Trade history:**
- `"swap order history --limit 50"` — recent swaps
- `"swap order history --status PENDING"` — open orders
- `"swap node list"` — list node-level atomic swaps
- `"asset transfers <ASSET_ID>"` — asset transfer history
- `"payment list"` — Lightning payment history

**Atomic swap via Kaleidoswap maker:**
- `"swap atomic init BTC/USDT --from-amount <sats> --from-layer BTC_LN --to-layer RGB_LN"` — init atomic swap
- `"swap atomic execute --swapstring <s> --taker-pubkey <pk> --payment-hash <hash> --auto-whitelist"` — execute
- `"swap atomic status <PAYMENT_HASH>"` — check status

**Local node swap primitives:**
- `"swap node init --qty-from <n> --qty-to <n> [--from-asset] [--to-asset]"` — init maker side
- `"swap node whitelist --swapstring <s>"` — accept swap on taker side
- `"node taker pubkey"` — get taker pubkey
- `"swap node execute --swapstring <s> --payment-secret <s> --taker-pubkey <pk>"` — finalize

**Asset management:**
- `"asset sync"` — sync RGB wallet (run after swaps)
- `"asset fail-transfers"` — mark stuck transfers as failed
- `"asset refresh"` — refresh pending transfers

**LSP / channels:**
- `"channel lsp info"` — LSP capabilities and channel options
- `"channel lsp network-info"` — LSP node pubkey/connection
- `"lsp estimate-fees --capacity-sat <n>"` — channel fee estimate
- `"lsp order-create --capacity-sat <n>"` — buy a channel
- `"lsp order-get <order-id>"` — poll order status

**Payments:**
- `"payment send <bolt11>"` — pay LN invoice
- `"payment keysend <pubkey> <msat>"` — keysend payment
- `"payment invoice-status <bolt11>"` — invoice status check
- `"payment decode <invoice>"` — decode a BOLT11 or RGB invoice
- `"wallet estimate-fee [--target-blocks <n>]"` — on-chain fee rate

---

Autonomous portfolio rebalancing agent for [KaleidoSwap](https://kaleidoswap.com). Uses a **single `kaleido-mcp` server** with ~60 tools across six functional layers.

## Single MCP Server: `kaleido-mcp`

All tools come from one connection. No separate server processes needed.

| Tool Prefix | Layer | Purpose |
|-------------|-------|---------|
| `getBalance`, `getAddress`, `sendTransaction`, `transfer`, `sign`, `verify` | WDK built-in | Spark wallet standard ops |
| `getCurrentPrice`, `getHistoricalPrice` | WDK Bitfinex | Live price data |
| `spark_*` | Custom Spark | Lightning invoices, BTC bridge, fee-free transfers |
| `wdk_*` | Custom RLN | RGB assets, Lightning channels, atomic taker |
| `kaleidoswap_*` | KaleidoSwap DEX | RFQ quotes, atomic HTLC swaps, LSPS1 channels |
| `mpp_*` / `l402_*` / `search_paid_apis` | MPP/L402 | Payment-gated API access + 402index.io discovery |
| `get_price`, `get_market_data`, `get_ohlcv`, `get_sentiment` | CoinGecko | Market data + Fear & Greed |

See [references/tools.md](references/tools.md) for the complete tool reference.

## Wallet Architecture

Two WDK wallets, one process:

| Wallet | Tools | Holds | Best For |
|--------|-------|-------|----------|
| **Spark L2** | `getBalance(spark)`, `spark_*` | BTC sats (fee-free L2) | Lightning payments, BTC bridge, zero-fee transfers |
| **RLN** | `wdk_*` | BTC (Lightning) + RGB assets (USDT, XAUT) | Atomic swaps, RGB token operations, channel mgmt |

## Three Operating Loops

### 1. Rebalance (default 1h)

Maintain target portfolio allocation. Swap most over-allocated → most under-allocated asset when drift exceeds threshold.

```
1.  node status                            → confirm node online (abort if unreachable)
2.  wallet balance                         → BTC Lightning balance
3.  asset list                             → discover RGB asset IDs + balances (USDT, XAUT)
4.  market quote BTC/USDT --from-amount 100000   → BTC price in USDT
5.  market quote XAUT/USDT --from-amount 1       → XAUT price in USDT
6.  [calculate combined BTC value, allocation %, drift]
7.  swap history --status PENDING          → skip if at max_concurrent_orders
8.  [choose swap direction]
9.  [execute swap — see Swap Flows: swap execute or swap run]
10. swap atomic-status --payment-hash <h>  → poll until Succeeded or Failed
11. asset sync                             → sync RGB balances after swap
```

**Combined BTC allocation:**
```
total_btc_sat = rln_lightning_balance_sat + spark_balance_sats
BTC_usd       = (total_btc_sat / 1e8) * btc_price
USDT_usd      = usdt.settled + usdt.offchain_inbound
XAUT_usd      = xaut_amount * xaut_price
total_usd     = BTC_usd + USDT_usd + XAUT_usd
drift         = |current_pct - target_pct|
```

### 2. Heartbeat (default 1h)

Node health, liquidity check, RGB flush.

```
1. node status                    → uptime, sync, peers
2. channel list                   → outbound liquidity per channel
3. asset fail-transfers           → flush stuck pending RGB transfers
                                     (or use `asset refresh [--asset-id <id>]` for per-asset refresh)
4. swap history --status PENDING  → check for stuck orders
5. [if low outbound + auto_buy_channel → Channel Purchase Flow using lsp *]
```

### 3. Daily Summary (00:00)

Full portfolio snapshot across both wallets.

```
1. wallet balance                         → BTC on-chain + Lightning
2. asset list                             → RGB balances (USDT, XAUT)
3. channel list                           → total outbound/inbound
4. market quote BTC/USDT --from-amount 100000   → BTC price
5. market analytics                       → order volume/statistics
6. swap history --limit 50                → recent trade history
7. payment list                           → Lightning payment history
8. Output structured JSON report
```

## Risk Rules (ALWAYS enforce)

- **dry_run=true** → describe what you *would* do — do NOT call `kaleidoswap_atomic_execute`, `wdk_pay_invoice`, `wdk_send_asset`, `spark_pay_lightning_invoice`, or `transfer`
- **max_swap_usd** → never exceed per-trade limit
- **min_btc_reserve_sats** → never let **combined** (RLN + Spark) BTC fall below this
- **max_concurrent_orders** → do not start a new swap while that many are still in flight
- **stop_loss_btc_sats** → halt all trading if total BTC falls below this

## Swap Flows

### Atomic HTLC Swap — high-level (preferred in skill mode)

```
swap execute BTC/USDT --from-amount <sats> --from-layer BTC_LN --to-layer RGB_LN --yes
  → handles: quote → order → maker-init → taker-whitelist → execute → status
swap atomic-status --payment-hash <hash>   ← poll if needed
asset sync                                  ← after swap completes
```

### Atomic HTLC Swap — manual steps (for fine-grained control)

```
market quote BTC/USDT --from-amount <sats> --from-layer BTC_LN --to-layer RGB_LN
  → OR: swap run --qty-from <n> --qty-to <n> --to-asset <rgb:...> --yes
  → OR manually:
     maker init --qty-from <n> --qty-to <n> [--from-asset] [--to-asset]
       → {swapstring, payment_hash, payment_secret}
     taker whitelist <swapstring>
     taker pubkey → pubkey
     maker execute --swapstring <s> --payment-secret <s> --taker-pubkey <pk>
     swap atomic-status --payment-hash <hash>   ← poll until Succeeded
asset sync
```

### Channel Purchase Flow (LSPS1)

```
lsp info                                        → supported sizes
lsp network-info                                → {connection_url}
peer connect <connection_url>
lsp estimate-fees --capacity-sat <n> [--push-sat <m>]
  → {fee_total_sat}
lsp order-create --capacity-sat <n> [--push-sat <m>]
  → {order_id, bolt11_invoice}
payment send <bolt11_invoice>
lsp order-get <order_id>                        ← poll until COMPLETED
```

## MPP + 402index.io — Premium Data Sources

### Discover paid APIs first

```
search_paid_apis(query: "bitcoin sentiment", protocol: "L402", health: "healthy")
  → [{url, name, price_sats, protocol, category}, ...]
```

### Access via MPP (pay with RLN)

```
mpp_request_challenge(url) → {invoice, challenge_id, amount_sats}
wdk_mpp_pay(invoice, challenge_id) → {credential}
mpp_submit_credential(url, credential) → {data}
```

### Access via MPP (pay with Spark, when RLN outbound low)

```
mpp_request_challenge(url) → {invoice, challenge_id}
spark_mpp_pay(invoice, challenge_id) → {credential}
mpp_submit_credential(url, credential) → {data}
```

**Rules:** Complete all 3 steps before `expires_at` (~60s). Use `spark_mpp_pay` for micro-amounts where routing is uncertain.

## Output Format

```json
{
  "loop": "rebalance | heartbeat | daily_summary",
  "timestamp": "<ISO 8601>",
  "action": "rebalanced | balanced | skipped | alert | report",
  "dry_run": true,
  "wallets": {
    "rln_lightning_sat": 100000,
    "spark_sat": 50000,
    "combined_btc_sat": 150000
  },
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
2. Never start a new swap while a previous `kaleidoswap_atomic_status` is non-terminal
3. On any tool error: log and skip — never retry in a tight loop
4. RGB asset IDs vary by network — resolve from `wdk_list_assets`, never hardcode except `BTC`
5. Whitelist the HTLC with `wdk_atomic_taker({ swapstring })` BEFORE `kaleidoswap_atomic_execute`
6. Poll `kaleidoswap_atomic_status({ payment_hash })` to a terminal state; never assume success
7. If `WDK_SEED` is not set, Spark tools (getBalance, spark_*) will fail — fall back gracefully to RLN-only
