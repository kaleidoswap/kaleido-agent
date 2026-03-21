---
name: kaleidoswap
description: >
  Trade RGB assets on Bitcoin Lightning using the KaleidoSwap protocol.
  Use when quoting a swap, executing an atomic swap, placing a REST order,
  checking order status, or managing open orders.
  Requires kaleidoswap-mcp and wdk-wallet-mcp.
license: Apache-2.0
metadata:
  author: kaleidoswap
  version: "1.1"
  networks: bitcoin-lightning, rgb
---

# KaleidoSwap Trading Skill

KaleidoSwap is a non-custodial DEX for RGB assets on Bitcoin Lightning Network.
Trades are settled via atomic HTLC swaps or REST deposit-based orders.

## Required MCP Servers

- **kaleidoswap-mcp** — quotes, orders, atomic execution
- **wdk-wallet-mcp** — RLN node: balances, invoices, HTLC signing

## Core Concepts

- **Assets**: RGB tokens identified by `asset_id` (`BTC` or `rgb:...`). Discover via `kaleidoswap_get_assets()` — never hard-code IDs.
- **Pairs & Layers**: Call `kaleidoswap_get_pairs()` to find trading pairs and their `routes` (each route has `from_layer`/`to_layer`). Always use layer values from here.
- **Amounts for `get_quote` tool**: pass **display units** (human-readable):
  - BTC: decimal BTC (e.g. `0.001` = 100,000 sats). Internally msat (precision=11).
  - RGB assets: decimal (e.g. `65.0` USDT with precision=6, `1.0` XAUT with precision=9).
- **Raw amounts for `atomic_init`**: use `amount_raw` from the quote response directly.
- **Show users**: always convert raw → display using `raw / 10^precision`.

## Step 1: Discover Pairs and Layers

```
kaleidoswap_get_pairs()
→ [{
    base:   { ticker, precision },
    quote:  { ticker, precision },
    routes: [{ from_layer, to_layer }]   ← use these layer values
  }]

kaleidoswap_get_assets()
→ [{ ticker, asset_id, precision, name }]  ← resolve asset_id by ticker
```

Example — swap BTC→USDT on Lightning:
- Find pair where `base.ticker="BTC"` and `quote.ticker="USDT"`
- Pick route `{ from_layer: "BTC_LN", to_layer: "RGB_LN" }`
- Resolve `USDT asset_id` from assets list

## Step 2: Get a Quote

```
kaleidoswap_get_quote({
  from_asset_id: "BTC",
  from_layer:    "BTC_LN",
  from_amount:   0.001,           // display BTC (= 100,000 sats = 100M msat internally)
  to_asset_id:   "<USDT_ID>",
  to_layer:      "RGB_LN"
})
→ {
    rfq_id, expires_at,
    from_asset: { ticker, layer, amount_raw, amount_display },
    to_asset:   { ticker, layer, amount_raw, amount_display },
    price
  }
```

Show the user: **amount in → amount out → effective rate**. Ask confirmation before executing.

## Step 3a: Execute — Atomic Swap (preferred)

```
1. kaleidoswap_atomic_init({
     rfq_id,
     from_asset_id,
     from_amount_raw,    // = quote.from_asset.amount_raw
     to_asset_id,
     to_amount_raw       // = quote.to_asset.amount_raw
   })
   → { swapstring, payment_hash }

2. wdk_atomic_taker({ swapstring })
   → {}   (whitelist HTLC on RLN node — MUST happen before execute)

3. wdk_get_node_info()
   → { pubkey }   (needed as taker_pubkey)

4. kaleidoswap_atomic_execute({
     swapstring, taker_pubkey: pubkey, payment_hash
   })
   → { status, message }

5. kaleidoswap_atomic_status({ payment_hash })
   → { swap: { status: "Waiting"|"Pending"|"Succeeded"|"Expired"|"Failed" } }
   Poll every 2s until terminal state.
```

If `Succeeded` → done. If `Expired`/`Failed` → fall back to REST.

## Step 3b: Execute — REST Order (fallback)

**BTC → RGB (e.g. BTC → USDT):**
```
1. wdk_create_rgb_invoice({ asset_id: <USDT_ID> }) → rgb_invoice
2. kaleidoswap_place_order({
     from_asset_id, to_asset_id, from_layer, to_layer, from_amount,
     receiver_address: rgb_invoice, receiver_address_format: "RGB_INVOICE"
   }) → { order_id, deposit_address: { address: bolt11 } }
3. wdk_pay_invoice({ invoice: bolt11 })
4. Poll kaleidoswap_get_order_status({ order_id }) until "FILLED"
```

**RGB → BTC (e.g. USDT → BTC):**
```
1. wdk_create_ln_invoice({ amount_msat }) → bolt11
2. kaleidoswap_place_order({ ..., receiver_address: bolt11, receiver_address_format: "BOLT11" })
   → { order_id, deposit_address: { address: rgb_invoice } }
3. wdk_send_asset({ asset_id, recipient_id: rgb_invoice, amount: display_amount })
4. Poll kaleidoswap_get_order_status({ order_id }) until "FILLED"
```

Order states: `OPEN → PENDING_PAYMENT → PAID → EXECUTING → FILLED | EXPIRED | FAILED`

## Safety Rules

1. **Pairs first** — `kaleidoswap_get_pairs()` gives valid layers and min amounts.
2. **Quote first** — never execute without a fresh `rfq_id`.
3. **Confirm before executing** — show amounts and rate; wait for user approval.
4. **Respect dry_run** — describe action only; do not call execute.
5. **Check balances** — verify sufficient funds before placing.
6. **Respect min amounts** — check pair minimums from `get_pairs()` before quoting.
7. **Handle expiry** — get a fresh quote if `rfq_id` has expired.
