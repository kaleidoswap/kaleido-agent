# KaleidoSwap Asset Reference

> **Important**: Asset IDs change between staging and mainnet. Always call
> `kaleidoswap_get_assets()` to discover the live IDs — never hard-code them.
> This file is reference only; actual IDs come from the API.

## Asset Properties

Each asset returned by `kaleidoswap_get_assets()` has:

```json
{
  "asset_id": "BTC" | "rgb:...",
  "ticker": "BTC" | "USDT" | "XAUT" | ...,
  "name": "Bitcoin" | "USD Tether" | ...,
  "precision": 11
}
```

> **Note on BTC**: The staging/local API may not return BTC in the assets list
> (only RGB assets are listed). BTC precision and metadata come from the pairs
> list instead — `kaleidoswap_get_pairs()` always includes BTC in base/quote.

## Amount Units

KaleidoSwap uses **millisatoshis (msat)** for BTC internally (`precision=11`):

```
1 BTC      = 100,000,000 sats  = 100,000,000,000 msat  (1e11 raw)
0.001 BTC  =     100,000 sats  =     100,000,000 msat  (1e8 raw)
1 sat      = 1,000 msat  (1e3 raw)
```

RGB assets use their own decimal precision:
```
raw_amount   = Math.round(display_amount × 10^precision)
display_amount = raw_amount / 10^precision
```

## Precision Reference

| Asset | Precision | Raw unit | 1 display unit in raw |
|-------|-----------|----------|-----------------------|
| BTC   | 11        | msat     | 100,000,000,000       |
| USDT  | 6         | μUSDT    | 1,000,000             |
| XAUT  | 9         | nXAUT    | 1,000,000,000         |

**Always read precision from the API** — do not hard-code the table values above.

## Tool Amount Convention

The `kaleidoswap_get_quote` MCP tool accepts **display units** (human-readable):

```
from_amount: 0.001      → 100,000 sats (BTC Lightning)
from_amount: 65.0       → 65 USDT (RGB Lightning)
from_amount: 1.0        → 1 XAUT (RGB Lightning)
```

The `kaleidoswap_atomic_init` MCP tool requires **raw amounts** — always pass
`quote.from_asset.amount_raw` and `quote.to_asset.amount_raw` directly from
the quote response.

## Identifying Assets

When the user says "BTC" via Lightning → `asset_id: "BTC"`, layer: `"BTC_LN"`
When the user says "BTC" on-chain → `asset_id: "BTC"`, layer: `"BTC_L1"`
When the user says "USDT" → find asset where `ticker === "USDT"` from `get_assets()`
When the user says "gold" or "XAUT" → find asset where `ticker === "XAUT"` from `get_assets()`

## Layers

Layers are returned by `kaleidoswap_get_pairs()` inside each route:

```
BTC_LN     — Bitcoin Lightning Network
BTC_L1     — Bitcoin on-chain (Layer 1)
BTC_SPARK  — Bitcoin Spark
RGB_LN     — RGB assets on Lightning
RGB_L1     — RGB assets on-chain
```

Always use layer values from `get_pairs()` — do not guess layer strings.

## Staging Environment

Staging API: `https://api.staging.kaleidoswap.com`

Asset IDs on staging are real RGB IDs (non-BTC assets) and may be rotated
during development. Always call `kaleidoswap_get_assets()` at session start
and cache for 5 minutes.
