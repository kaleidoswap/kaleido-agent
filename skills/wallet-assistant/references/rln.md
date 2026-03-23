# RLN (RGB Lightning Node) — Reference

The RLN node is accessed through `kaleido-mcp`. It manages:
- BTC in Lightning channels
- RGB assets (USDT, XAUT, etc.) in RGB-enabled LN channels
- On-chain BTC receive addresses

## Key Tool Signatures

### rln_get_node_info()
```json
Response: {
  "pubkey": "03abc...",
  "num_channels": 3,
  "num_usable_channels": 2,
  "local_balance_sat": 150000,
  "num_peers": 3
}
```

### rln_get_balances()
```json
Response: {
  "btc_onchain": {
    "vanilla_spendable_sats": 0,
    "colored_spendable_sats": 0
  },
  "lightning_balance_sat": 150000
}
```

### rln_list_channels()
```json
Response: {
  "channel_count": 2,
  "total_outbound_msat": 150000000,
  "total_inbound_msat": 350000000,
  "channels": [{
    "channel_id": "abc...",
    "peer_pubkey": "03...",
    "capacity_sat": 500000,
    "local_balance_sat": 150000,
    "remote_balance_sat": 350000,
    "is_usable": true,
    "rgb_assets": [{ "asset_id": "rgb:...", "ticker": "USDT", "local_amount": 45000000 }]
  }]
}
```

### rln_create_ln_invoice({ amount_msat?, description?, expiry_sec? })
```json
Request: { "amount_msat": 10000000, "description": "Coffee payment" }
Response: { "invoice": "lnbc...", "payment_hash": "...", "expiry_sec": 3600 }
```
`amount_msat` = amount in millisatoshis (1 sat = 1000 msat)

### rln_pay_invoice({ invoice })
```json
Request: { "invoice": "lnbc..." }
Response: { "payment_hash": "...", "status": "succeeded" }
```

### rln_send_asset({ asset_id, recipient_id, amount, transport_endpoints?, fee_rate? })
```json
Request: { "asset_id": "rgb:...", "recipient_id": "rgb1...", "amount": 10000000 }
Response: { "sent": true, "asset_id": "rgb:...", "recipient_id": "rgb1...", "amount_raw": 10000000, "txid": "abc..." }
```

### rln_create_rgb_invoice({ asset_id?, amount?, duration_seconds? })
```json
Request: { "asset_id": "rgb:...", "amount": 10000000 }
Response: { "invoice": "rgb1...", "recipient_id": "rgb1...", "expires_at": "2024-01-01T00:10:00Z" }
```
Use `invoice` as `recipient_id` in `rln_send_asset`.

## Amount Units

| Asset | Unit | Conversion |
|-------|------|-----------|
| BTC (invoice) | millisatoshis (msat) | 1 sat = 1000 msat |
| BTC (balance) | satoshis (sat) | 1 BTC = 100,000,000 sat |
| USDT | raw units | 1 USDT = 1,000,000 (precision=6) |
| XAUT | raw units | 1 XAUT = 1,000,000,000 (precision=9) |

Always verify precision from `rln_list_assets()` or `kaleidoswap_get_assets()`.
