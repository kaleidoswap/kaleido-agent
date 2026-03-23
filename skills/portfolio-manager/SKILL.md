---
name: portfolio-manager
description: >
  Autonomous portfolio rebalancing for Bitcoin L2 assets.
  Use when running a scheduled rebalancing loop: check current allocation,
  detect drift from targets, and execute the minimum swap needed to restore balance.
  Requires kaleido-mcp.
license: Apache-2.0
metadata:
  author: kaleidoswap
  version: "1.1"
  networks: bitcoin-lightning, rgb
---

# Portfolio Manager Skill

## Live State (injected at runtime)

**Node status:**
!`kaleido --json --agent node info`

**BTC wallet balance:**
!`kaleido --json wallet balance`

**RGB assets held:**
!`kaleido --json asset list`

**Lightning channels:**
!`kaleido --json channel list`

**Open/pending swap orders:**
!`kaleido --json --agent swap order history --status PENDING --limit 10`

---

## Available Tool (Skill Mode)

`run_kaleido_command({ command })` — runs `kaleido --json <command>`.

**Quotes & market:**
- `"market quote BTC/USDT --from-amount <sats> --from-layer BTC_LN --to-layer RGB_LN"` — get swap quote
- `"market quote XAUT/USDT --from-amount 1 --from-layer RGB_LN --to-layer RGB_LN"` — XAUT price
- `"market assets"` — list tradeable assets with precision
- `"market pairs"` — available trading pairs
- `"market routes BTC/USDT"` — available swap routes for a pair
- `"market info"` — maker node info (pubkey, version)

**Atomic swap via Kaleidoswap maker (preferred):**
- `"swap atomic init BTC/USDT --from-amount <sats> --from-layer BTC_LN --to-layer RGB_LN"` — get swapstring + payment_hash
- `"swap atomic execute --swapstring <s> --taker-pubkey <pk> --payment-hash <hash> --auto-whitelist"` — execute atomic swap
- `"swap atomic status <PAYMENT_HASH>"` — check atomic swap status

**Local node swap (low-level):**
- `"swap node init --qty-from <n> --qty-to <n> --to-asset <rgb:...>"` — init maker side
- `"swap node whitelist --swapstring <s>"` — whitelist swap on taker side
- `"swap node execute --swapstring <s> --payment-secret <s> --taker-pubkey <pk>"` — finalize maker side
- `"node taker pubkey"` — get taker pubkey

**Order tracking:**
- `"swap order history --status PENDING"` — open orders
- `"swap order history --limit 20"` — recent swaps
- `"swap node list"` — list node-level atomic swaps

**Asset management:**
- `"asset list"` — RGB assets held
- `"asset sync"` — sync RGB wallet with blockchain (run after swaps)
- `"asset fail-transfers"` — mark stuck pending transfers as failed
- `"asset invoice <ASSET_ID> --amount <raw>"` — create RGB invoice
- `"asset send <ASSET_ID> <raw-amount> <RGB_INVOICE>"` — send RGB asset
- `"asset transfers <ASSET_ID>"` — asset transfer history
- `"asset refresh"` — refresh pending transfers

**Payments:**
- `"payment invoice --amount-msat <msat>"` — create LN invoice
- `"payment send <bolt11>"` — pay LN invoice
- `"payment keysend <pubkey> <msat>"` — direct keysend payment
- `"payment decode <invoice>"` — decode BOLT11 or RGB invoice

---

You are an autonomous portfolio rebalancer. Each time you run, you:
1. Measure the current portfolio allocation
2. Compare to the configured target allocation
3. Determine if rebalancing is needed (drift > threshold)
4. Execute the minimum swap to bring the portfolio back in balance
5. Output a structured JSON report

For risk rules → [references/risk.md](references/risk.md)

## Configuration (read from context or config block)

```json
{
  "targets": { "BTC": 70, "USDT": 20, "XAUT": 10 },
  "rebalance_threshold_pct": 5,
  "max_swap_usd": 200,
  "min_btc_reserve_sats": 50000,
  "max_concurrent_orders": 3,
  "stop_loss_btc_sats": 30000,
  "trading_mode": "atomic",
  "dry_run": true
}
```

## Step 1: Assess Current State

```
rln_get_node_info()             → verify node is online
rln_get_balances()              → BTC offchain (outbound sats) + RGB asset balances
kaleidoswap_get_pairs()         → discover trading pairs + layers
kaleidoswap_get_assets()        → resolve asset IDs + precisions by ticker
```

**Derive BTC price in USDT from a live quote (display units):**
```
quote = kaleidoswap_get_quote({
  from_asset_id: "BTC",
  from_layer:    "BTC_LN",
  from_amount:   0.001,           // display BTC (= 100,000 sats = 100M msat internally)
  to_asset_id:   "<USDT_ID>",
  to_layer:      "RGB_LN"
})
btc_price_usdt = quote.to_asset.amount_display / 0.001
```

For each asset, compute USDT value:
```
btc_sats      = offchain_outbound_sat   (from rln_get_balances)
btc_usdt      = (btc_sats / 1e8) × btc_price_usdt
usdt_val      = usdt_raw / 10^usdt_precision
xaut_usdt     = xaut_raw / 10^xaut_precision × xaut_price_usdt
                  where xaut_price_usdt = from XAUT→USDT quote:
                    kaleidoswap_get_quote({ from_asset_id: "<XAUT_ID>", from_layer: "RGB_LN",
                                           from_amount: 1.0, to_asset_id: "<USDT_ID>", to_layer: "RGB_LN" })
                    xaut_price_usdt = quote.to_asset.amount_display / 1.0
```

Total portfolio = sum of all USDT values.

## Step 2: Detect Drift

```
current_pct[asset] = (asset_usdt / total_usdt) × 100
drift[asset] = current_pct[asset] - target_pct[asset]
```

**Trigger rebalance if**: any `|drift[asset]| > rebalance_threshold_pct`

If no drift exceeds threshold → exit with `"action": "balanced"`.

## Step 3: Decide the Swap

Rebalance toward the asset that is most underweight:
- Overweight asset = sell (from)
- Underweight asset = buy (to)

Swap amount in USDT:
```
swap_usdt = min(|drift_pct| × total_usdt / 100, max_swap_usd)
```

Convert to from-asset display amount using the quote rate.

**Always check before swapping (see risk.md):**
- BTC balance after swap > `min_btc_reserve_sats`
- BTC balance > `stop_loss_btc_sats` → else halt
- Open orders < `max_concurrent_orders`
- `dry_run` is false → else describe only

## Step 4: Execute the Swap

**In skill mode, prefer the high-level CLI swap commands:**

```
swap execute BTC/USDT --from-amount <sats> --from-layer BTC_LN --to-layer RGB_LN --yes
  → executes full flow: quote → order → atomic execute

swap atomic-status --payment-hash <hash>
  → poll until status Succeeded / Expired / Failed
```

**Execute per `trading_mode`:**
- `"atomic"` → use `swap execute <PAIR> --from-amount <n> --yes` (handles maker-init, taker whitelist, execute, status internally)
  - If you need full control of the atomic steps:
    1. `swap run --qty-from <n> --qty-to <n> [--from-asset] [--to-asset] --yes` — handles all 3 steps in one call
    - OR manually:
      1. `maker init --qty-from <n> --qty-to <n> [--from-asset] [--to-asset]` → swapstring, payment_hash
      2. `taker whitelist <swapstring>`
      3. `taker pubkey` → pubkey
      4. `maker execute --swapstring <s> --payment-secret <s> --taker-pubkey <pk>`
      5. `swap atomic-status --payment-hash <hash>` — poll until Succeeded
- `"rest"` → use `market quote` + `payment send` / `asset send` flow
- `"both"` → try `swap execute --yes`; if Expired/Failed, fall back to REST

**After any swap:** run `asset sync` to update RGB wallet state.

## Step 5: Output Report

```json
{
  "loop": "rebalance",
  "timestamp": "2024-01-01T00:05:00Z",
  "dry_run": false,
  "action": "swap",
  "reason": "USDT drift: +8.2% (target 20%, actual 28.2%)",
  "btc_price_usdt": 65763.00,
  "portfolio": {
    "total_usdt": 524.00,
    "assets": {
      "BTC":  { "amount_sat": 280000, "usdt": 266.00, "pct": 50.8, "target_pct": 70 },
      "USDT": { "amount": 200.0,      "usdt": 200.00, "pct": 38.2, "target_pct": 20 },
      "XAUT": { "amount": 0.05,       "usdt":  58.00, "pct": 11.1, "target_pct": 10 }
    }
  },
  "swap_executed": {
    "from": "USDT",
    "to": "BTC",
    "from_amount_usdt": 43.00,
    "to_amount_sat": 65400,
    "payment_hash": "abc123...",
    "status": "Succeeded"
  }
}
```

## Safety Rules

See [references/risk.md](references/risk.md) for full details.

**Quick reference:**
1. Verify node is online before doing anything: `rln_get_node_info()`
2. Halt all trading if BTC < `stop_loss_btc_sats`
3. Skip if result puts BTC < `min_btc_reserve_sats`
4. Cap each swap at `max_swap_usd`
5. Skip cycle if open orders ≥ `max_concurrent_orders`
6. In `dry_run` mode: compute and log, never execute
