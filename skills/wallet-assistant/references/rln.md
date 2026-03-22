# RLN (RGB Lightning Node) — Reference

The RLN node is accessed through `wdk-wallet-rln-mcp`. It manages:
- BTC in Lightning channels
- RGB assets (USDT, XAUT, etc.) in RGB-enabled LN channels
- On-chain BTC receive addresses

## Key Tool Signatures

### wdk_node_info()
```json
Response: {
  "node_id": "03abc...",
  "alias": "my-rln-node",
  "status": "online",
  "peers": 3,
  "block_height": 850000
}
```

### wdk_get_balances()
```json
Response: {
  "btc": {
    "offchain_outbound": 150000,   // sats available to send
    "offchain_inbound": 50000,     // sats available to receive
    "onchain": 0                    // onchain confirmed sats
  },
  "rgb": [
    {
      "asset_id": "rgb:...",
      "ticker": "USDT",
      "balance": 45000000,         // raw units (45 USDT with precision=6)
      "precision": 6
    }
  ]
}
```

### wdk_list_channels()
```json
Response: [{
  "channel_id": "abc...",
  "peer_id": "03...",
  "peer_alias": "KaleidoSwap",
  "capacity_sat": 500000,
  "local_balance_sat": 150000,     // usable outbound
  "remote_balance_sat": 350000,    // usable inbound
  "active": true,
  "rgb_assets": [{ "asset_id": "rgb:...", "ticker": "USDT", "local_amount": 45000000 }]
}]
```

### wdk_create_invoice({ amount_msat, description, expiry_secs? })
```json
Request: { "amount_msat": 10000000, "description": "Coffee payment" }
Response: { "invoice": "lnbc...", "expires_at": "2024-01-01T00:10:00Z" }
```
`amount_msat` = amount in millisatoshis (1 sat = 1000 msat)

### wdk_pay_invoice({ invoice })
```json
Request: { "invoice": "lnbc..." }
Response: { "preimage": "abc...", "fee_msat": 1500 }
```

### wdk_send_asset({ invoice, asset_id, amount })
```json
Request: { "invoice": "rgb1...", "asset_id": "rgb:...", "amount": 10000000 }
Response: { "txid": "abc...", "status": "sent" }
```

### wdk_open_channel({ peer_id, amount_sat, push_msat? })
```json
Request: { "peer_id": "03abc...", "amount_sat": 200000 }
Response: { "channel_id": "...", "txid": "...", "status": "pending" }
```

## Amount Units

| Asset | Unit | Conversion |
|-------|------|-----------|
| BTC (invoice) | millisatoshis (msat) | 1 sat = 1000 msat |
| BTC (balance) | satoshis (sat) | 1 BTC = 100,000,000 sat |
| USDT | raw units | 1 USDT = 1,000,000 (precision=6) |
| XAUT | raw units | 1 XAUT = 1,000,000,000 (precision=9) |

Always verify precision from `wdk_list_assets()` or `kaleidoswap_get_assets()`.
