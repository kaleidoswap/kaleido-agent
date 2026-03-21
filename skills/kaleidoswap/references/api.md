# KaleidoSwap API Reference

Base URL: `https://api.kaleidoswap.com` (mainnet) / `https://api.staging.kaleidoswap.com` (staging)
Local maker: `http://localhost:8000`

## Market Endpoints

### GET /api/v1/market/assets
Returns all supported RGB assets. BTC may not appear in this list on some environments
(get BTC precision from the pairs list instead).

```json
Response: [
  { "asset_id": "BTC",       "ticker": "BTC",  "precision": 11, "name": "Bitcoin",     "protocol_ids": {"BTC":"BTC"} },
  { "asset_id": "rgb:2J...", "ticker": "USDT", "precision": 6,  "name": "USD Tether"  },
  { "asset_id": "rgb:Vf...", "ticker": "XAUT", "precision": 9,  "name": "Gold Tether" }
]
```

> BTC precision = 11 → raw unit is **millisatoshis (msat)**
> 1 BTC = 1e11 msat, 1 sat = 1000 msat, 0.001 BTC = 1e8 msat = 100,000 sats

### GET /api/v1/market/pairs
Returns all tradeable pairs with available routes.

```json
Response: [
  {
    "base":  { "ticker": "BTC",  "name": "Bitcoin",     "precision": 11 },
    "quote": { "ticker": "USDT", "name": "USD Tether",  "precision": 6  },
    "routes": [
      { "from_layer": "BTC_LN",  "to_layer": "RGB_LN",  "min_amount": 50000,    "max_amount": 10000000000 },
      { "from_layer": "RGB_LN",  "to_layer": "BTC_LN",  "min_amount": 1000000,  "max_amount": 999999000000 },
      ...
    ]
  }
]
```

## Quote

### POST /api/v1/market/quote
Amounts are **raw units** (msat for BTC, atomic for RGB).

```json
Request: {
  "from_asset": { "asset_id": "BTC",       "layer": "BTC_LN", "amount": 100000000 },
  "to_asset":   { "asset_id": "rgb:2J...", "layer": "RGB_LN" }
}
```

> The MCP tool `kaleidoswap_get_quote` accepts **display units** and converts internally:
> `from_amount: 0.001` (BTC display) → API receives `amount: 100000000` (1e8 msat = 100,000 sats)

```json
Response: {
  "rfq_id": "uuid",
  "expires_at": "2024-01-01T00:01:00Z",
  "from_asset": { "ticker": "BTC",  "layer": "BTC_LN", "amount_raw": 100000000,  "amount_display": 0.001  },
  "to_asset":   { "ticker": "USDT", "layer": "RGB_LN", "amount_raw": 65763000,   "amount_display": 65.763 },
  "price": 65763.0
}
```

## REST Orders

### POST /api/v1/swaps/orders
Create a REST deposit-based swap order.

```json
Request: {
  "rfq_id": "uuid",
  "from_asset": { "asset_id": "BTC",       "layer": "BTC_LN", "amount": 100000000 },
  "to_asset":   { "asset_id": "rgb:2J...", "layer": "RGB_LN" },
  "receiver_address": "<rgb_invoice>",
  "receiver_address_format": "RGB_INVOICE"
}
Response: {
  "order_id": "uuid",
  "deposit_address": { "address": "<bolt11_invoice>" }
}
```

For RGB → BTC (receiver is a BOLT11):
```json
"receiver_address": "<bolt11_invoice>",
"receiver_address_format": "BOLT11"
```

### POST /api/v1/swaps/orders/status
```json
Request:  { "order_id": "uuid" }
Response: {
  "order": {
    "order_id": "uuid",
    "status": "OPEN" | "PENDING_PAYMENT" | "PAID" | "EXECUTING" | "FILLED" | "EXPIRED" | "FAILED",
    "from_amount": 100000000,
    "to_amount": 65763000,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:30Z"
  }
}
```

## Atomic Swap

### POST /api/v1/swaps/init
```json
Request: {
  "rfq_id":       "uuid",
  "from_asset":   "BTC",          // asset_id string (not an object)
  "from_amount":  100000000,      // raw msat
  "to_asset":     "rgb:2J...",   // asset_id string
  "to_amount":    65763000        // raw atomic units
}
Response: {
  "swapstring":    "<encoded_htlc_params>",
  "payment_hash":  "<hex_hash>"
}
```

### POST /api/v1/swaps/execute
```json
Request: {
  "swapstring":    "<encoded_htlc_params>",
  "taker_pubkey":  "<node_pubkey_hex>",
  "payment_hash":  "<hex_hash>"
}
Response: { "status": "Executing" | "Succeeded", "message": "..." }
```

### POST /api/v1/swaps/atomic/status
```json
Request:  { "payment_hash": "<hex_hash>" }
Response: {
  "swap": {
    "status": "Waiting" | "Pending" | "Succeeded" | "Expired" | "Failed"
  }
}
```

Terminal states: `Succeeded`, `Expired`, `Failed`

## LSP / Channel Purchase (LSPS1)

### GET /api/v1/lsps1/get_info
Returns LSP connection details and channel options.
```json
Response: {
  "lsp_connection_url": "pubkey@host:port",
  "options": {
    "min_channel_balance_sat": 100000,
    "max_channel_balance_sat": 10000000,
    "max_channel_expiry_blocks": 20160
  },
  "assets": [
    { "ticker": "BTC", "asset_id": "BTC", "precision": 11, "min_channel_amount": 100000, "max_channel_amount": 10000000 }
  ]
}
```

### POST /api/v1/lsps1/estimate_fees
```json
Request: {
  "client_pubkey":       "<node_pubkey_hex>",
  "lsp_balance_sat":     2000000,
  "client_balance_sat":  0,
  "channel_expiry_blocks": 4320
}
Response: {
  "fee": {
    "setup_fee_sat":    1000,
    "capacity_fee_sat": 20000,
    "fee_total_sat":    25320
  }
}
```

### POST /api/v1/lsps1/create_order
```json
Request: {
  "client_pubkey":       "<node_pubkey_hex>",
  "lsp_balance_sat":     2000000,
  "client_balance_sat":  0,
  "channel_expiry_blocks": 4320
}
Response: {
  "order_id":        "uuid",
  "bolt11_invoice":  "lnbc...",
  "order_total_sat": 25320
}
```

### POST /api/v1/lsps1/get_order
```json
Request:  { "order_id": "uuid" }
Response: {
  "order": {
    "order_id":  "uuid",
    "status":    "PENDING" | "CHANNEL_OPENING" | "COMPLETED" | "FAILED",
    "channel_id": "..."
  }
}
```
