---
name: kaleidoswap
description: >
  Trade RGB assets on Bitcoin Lightning using the KaleidoSwap protocol.
  Use when quoting a swap, executing an atomic HTLC swap, or buying an
  asset channel from the LSP.
  Requires kaleido-mcp.
license: Apache-2.0
metadata:
  author: kaleidoswap
  version: "1.1"
  networks: bitcoin-lightning, rgb
---

# KaleidoSwap Trading Skill

KaleidoSwap is a non-custodial DEX for RGB assets on Bitcoin Lightning Network.
Trades are settled via atomic HTLC swaps quoted over RFQ.

## Required MCP Server

- **kaleido-mcp** — quotes, orders, atomic execution, RLN node: balances, invoices, HTLC signing

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

If `Succeeded` → done. If `Expired`/`Failed` → re-quote and retry; there is no REST order fallback.

## Safety Rules

1. **Pairs first** — `kaleidoswap_get_pairs()` gives valid layers and min amounts.
2. **Quote first** — never execute without a fresh `rfq_id`.
3. **Confirm before executing** — show amounts and rate; wait for user approval.
4. **Respect dry_run** — describe action only; do not call execute.
5. **Check balances** — verify sufficient funds before placing.
6. **Respect min amounts** — check pair minimums from `get_pairs()` before quoting.
7. **Handle expiry** — get a fresh quote if `rfq_id` has expired.
