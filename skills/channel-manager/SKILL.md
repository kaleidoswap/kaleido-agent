---
name: channel-manager
description: >
  Lightning channel health monitoring and management for RGB Lightning nodes.
  Use when checking channel liquidity, detecting low outbound capacity,
  or purchasing new channels via the KaleidoSwap LSP (LSPS1 protocol).
  Requires wdk-wallet-mcp and kaleidoswap-mcp.
license: Apache-2.0
metadata:
  author: kaleidoswap
  version: "1.1"
  networks: bitcoin-lightning, rgb
---

# Channel Manager Skill

You monitor the health of Lightning channels on an RLN node and take action
when liquidity falls below configured thresholds. You can also help users
purchase new channels via the KaleidoSwap LSP.

For LSPS1 channel purchase flow → [references/lsp.md](references/lsp.md)

## Configuration

```json
{
  "min_outbound_liquidity_sat": 200000,
  "auto_buy_channel": true,
  "lsp_balance_sat": 2000000,
  "client_balance_sat": 0,
  "channel_expiry_blocks": 4320
}
```

## Step 1: Audit Current Channels

```
wdk_list_channels()
```

For each channel, compute:
```
usable_outbound_pct = local_balance_sat / capacity_sat × 100
```

Classify channels:
- 🟢 **Healthy**: outbound ≥ 30% of capacity
- 🟡 **Low**: outbound 10–30% of capacity
- 🔴 **Critical**: outbound < 10% of capacity or < `min_outbound_liquidity_sat`

## Step 2: Report Channel Health

Always output a channel summary:

```
⚡ Channel Health Report
━━━━━━━━━━━━━━━━━━━━━━
Channels: 3 total (2 healthy, 1 critical)
Total Capacity:  8,000,000 sats
Usable Outbound:   200,000 sats (2.5%)
Usable Inbound:  7,400,000 sats

Critical channels:
  🔴 KaleidoSwap: 50,000 sat outbound / 3,000,000 capacity (1.7%)
```

## Step 3: Automated Liquidity Action

If **any channel is critical** AND `auto_buy_channel: true`:

1. Get LSP info and connect to peer:
   ```
   kaleidoswap_lsp_get_info()
   → { lsp_connection_url: "pubkey@host:port", options: {...} }

   wdk_connect_peer({ address: lsp_connection_url })
   ```

2. Get the node pubkey (needed for LSP calls):
   ```
   wdk_get_node_info() → { pubkey }
   ```

3. Check BTC balance covers fee + reserve:
   ```
   wdk_get_balances()
   kaleidoswap_lsp_estimate_fees({
     client_pubkey: pubkey,
     lsp_balance_sat, client_balance_sat, channel_expiry_blocks
   })
   → { fee: { fee_total_sat } }
   ```
   If BTC balance < fee_total_sat + min_btc_reserve_sats → abort, report insufficient funds.

4. If `dry_run: true` → log "Would buy channel, fee=X sats" and STOP here.

5. Execute LSPS1 flow (see [references/lsp.md](references/lsp.md)):
   ```
   kaleidoswap_lsp_create_order({
     client_pubkey, lsp_balance_sat, client_balance_sat, channel_expiry_blocks
   })
   → { order_id, bolt11_invoice, order_total_sat }

   wdk_pay_invoice({ invoice: bolt11_invoice })

   Poll kaleidoswap_lsp_get_order({ order_id }) every 5s
   until status: "COMPLETED" | "FAILED"
   ```

If `auto_buy_channel: false` → report the issue, suggest manual action.

## Step 4: Manual Channel Purchase (user-initiated)

When user says "buy a channel" or "I need more inbound/outbound":

1. Ask: LSP capacity wanted (default: `lsp_balance_sat`) and client contribution (default: 0)
2. Get LSP info and connect:
   ```
   kaleidoswap_lsp_get_info() → lsp_connection_url
   wdk_connect_peer({ address: lsp_connection_url })
   wdk_get_node_info() → pubkey
   ```
3. Estimate cost:
   ```
   kaleidoswap_lsp_estimate_fees({
     client_pubkey: pubkey, lsp_balance_sat, client_balance_sat, channel_expiry_blocks
   })
   ```
4. Show: fee in sats, channel size, expiry (~30 days = 4320 blocks)
5. Ask for confirmation: "Buy {lsp_balance_sat} sat channel for {fee_total_sat} sats fee?"
6. On confirm:
   ```
   kaleidoswap_lsp_create_order({ client_pubkey, lsp_balance_sat, client_balance_sat, channel_expiry_blocks })
   → { order_id, bolt11_invoice, order_total_sat }

   wdk_pay_invoice({ invoice: bolt11_invoice })

   Poll kaleidoswap_lsp_get_order({ order_id }) every 5s until "COMPLETED"
   ```

## Step 5: Output Report

```json
{
  "loop": "channel_manager",
  "timestamp": "2024-01-01T00:05:00Z",
  "action": "buy_channel" | "report_only" | "healthy",
  "channels": {
    "total": 3,
    "healthy": 2,
    "low": 0,
    "critical": 1,
    "total_capacity_sat": 8000000,
    "usable_outbound_sat": 200000,
    "usable_inbound_sat": 7400000
  },
  "lsp_order": {
    "order_id": "uuid",
    "lsp_balance_sat": 2000000,
    "fee_sat": 25320,
    "status": "COMPLETED"
  }
}
```

## Safety Rules

1. Never buy a channel if it would leave BTC < `min_btc_reserve_sats`.
2. Always call `kaleidoswap_lsp_get_info()` and `wdk_connect_peer()` before creating an order.
3. Always get `client_pubkey` from `wdk_get_node_info()` — pass it to estimate_fees and create_order.
4. Verify fee estimate before paying the LSP invoice.
5. In `dry_run` mode: report only, do not buy channels.
6. If LSP order fails after payment: log and escalate — do NOT retry automatically.
7. One channel purchase per loop cycle maximum.
