---
name: dca
description: >
  Dollar Cost Averaging (DCA) strategy for periodic Bitcoin or RGB asset purchases.
  Use when running a scheduled DCA loop: get the current rate, optionally apply
  price-aware logic (skip on pumps, buy on dips), then execute a fixed-size swap.
  Requires kaleidoswap-mcp and wdk-wallet-mcp.
license: Apache-2.0
metadata:
  author: kaleidoswap
  version: "1.0"
  networks: bitcoin-lightning, rgb
---

# DCA (Dollar Cost Averaging) Skill

You run periodic, fixed-size purchases of a target asset to build a position
over time regardless of price. Buy a fixed USDT amount on a schedule — this
averages your cost basis over market cycles.

## Configuration (read from context or config block)

```json
{
  "enabled": true,
  "target_asset": "BTC",
  "source_asset": "USDT",
  "amount_usdt": 10.0,
  "interval_sec": 86400,
  "price_aware": {
    "enabled": false,
    "skip_if_rate_above_ema_pct": 5,
    "double_if_rate_below_ema_pct": 10
  },
  "dry_run": true
}
```

## Step 1: Check if DCA is Enabled

If `enabled: false` → exit with `"action": "disabled"`.

## Step 2: Get Current Rate

Use `kaleidoswap_get_quote` to get the live BTC/USDT rate:

```
kaleidoswap_get_assets()   → resolve USDT asset_id and precisions

kaleidoswap_get_quote({
  from_asset_id: "BTC", from_layer: "BTC_LN", from_amount: 100000,
  to_asset_id: "<USDT_ID>", to_layer: "RGB_LN"
})
→ rate = (to_amount / 10^usdt_precision) / (100000 / 1e8)
  e.g. 95000.00 USDT/BTC
```

This is the price we'll actually trade at.

## Step 3: Price-Aware Logic (optional)

If `price_aware.enabled: true`, compare current rate to an internally tracked
exponential moving average (EMA) maintained across runs in agent state.

```
if rate > ema × (1 + skip_if_rate_above_ema_pct / 100):
    → skip this cycle: "rate above EMA threshold"

if rate < ema × (1 - double_if_rate_below_ema_pct / 100):
    → double the amount: amount_usdt × 2  (buy the dip)
```

Update EMA after each run: `ema = ema × 0.9 + rate × 0.1`

If `price_aware.enabled: false` → always use configured `amount_usdt`.

## Step 4: Check Available Funds

```
wdk_get_balances()
```

Compute USDT balance. If usdt_balance < `amount_usdt`:
→ exit with `"action": "skipped"`, `"reason": "insufficient USDT"`

## Step 5: Execute the Purchase

1. Convert `amount_usdt` to raw USDT units: `amount_usdt × 10^usdt_precision`
2. `kaleidoswap_get_quote({ from: USDT, to: BTC, amount: raw_usdt })`
3. Execute atomic swap (see kaleidoswap skill)
4. Poll until `status: "completed"` or `"failed"`

If `dry_run: true` → describe the trade and log the report; do NOT execute.

## Step 6: Output Report

```json
{
  "loop": "dca",
  "timestamp": "2024-01-01T00:00:00Z",
  "dry_run": false,
  "action": "buy",
  "reason": "Scheduled DCA purchase",
  "rate_usdt_per_btc": 95000.00,
  "amount_usdt": 10.00,
  "amount_received_sat": 10526,
  "price_aware_applied": false,
  "order_id": "uuid",
  "status": "completed"
}
```

`action` values: `"buy"` | `"skipped"` | `"failed"` | `"disabled"`

## DCA Philosophy

- **Consistency**: Run on schedule regardless of price (unless price_aware is on).
- **Fixed size**: Same USDT amount each cycle — buys more sats when price is low.
- **No timing**: DCA removes the need to predict market direction.
- **Long-term**: Works best over many cycles (weeks / months).

## Safety Rules

1. Never DCA if node has insufficient USDT.
2. Never DCA if BTC balance < `stop_loss_btc_sats` (node is in distress).
3. Cap at `amount_usdt × 3` even if price-aware doubles the amount.
4. In `dry_run: true`: simulate and report, never execute.
5. Log every run — both buys and skips — for auditability.
