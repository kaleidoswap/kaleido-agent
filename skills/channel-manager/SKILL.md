---
name: channel-manager
description: >
  Lightning channel health monitoring and management for RGB Lightning nodes.
  Use when checking channel liquidity, detecting low outbound capacity,
  or purchasing new channels via the KaleidoSwap LSP (LSPS1 protocol).
  Requires wdk-wallet-rln-mcp and kaleidoswap-mcp.
license: Apache-2.0
metadata:
  author: kaleidoswap
  version: "1.1"
  networks: bitcoin-lightning, rgb
---

# Channel Manager Skill

## Live State (injected at runtime)

**Node status:**
!`kaleido --json node status`

**Lightning channels:**
!`kaleido --json channel list`

**BTC wallet balance:**
!`kaleido --json wallet balance`

---

## Available Tool (Skill Mode)

`run_kaleido_command({ command })` — runs `kaleido --json <command>`.

**Channel inspection:**
- `"channel list"` — list channels with outbound/inbound capacity
- `"node status"` — node pubkey, peers, sync status
- `"node info"` — detailed node info
- `"peer connect <pubkey@host:port>"` — connect to a Lightning peer

**LSP (Lightning Service Provider) — channel purchase:**
- `"lsp info"` — show LSP capabilities and supported channel sizes
- `"lsp network-info"` — LSP node pubkey and network details
- `"lsp estimate-fees --capacity-sat <n> [--push-sat <n>]"` — estimate fees for a channel order
- `"lsp order-create --capacity-sat <n> [--push-sat <n>] [--public/--private]"` — create LSP channel order → returns bolt11 invoice + order_id
- `"lsp order-get <order-id>"` — poll LSP order status until COMPLETED/FAILED

**Payments:**
- `"payment send <bolt11>"` — pay invoice (e.g., LSP invoice to open channel)
- `"wallet estimate-fee [--target-blocks <n>]"` — on-chain fee rate estimate

**Swaps:**
- `"swap history --status PENDING"` — open orders
- `"asset fail-transfers"` — mark stuck transfers as failed

---

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
   lsp info          → shows supported channel sizes and options
   lsp network-info  → { pubkey, connection_url }
   peer connect <connection_url>
   ```

2. Check BTC balance covers fee + reserve:
   ```
   wallet balance
   lsp estimate-fees --capacity-sat <lsp_balance_sat> [--push-sat <client_balance_sat>]
   → { fee_total_sat, ... }
   ```
   If BTC balance < fee_total_sat + min_btc_reserve_sats → abort, report insufficient funds.

3. If `dry_run: true` → log "Would buy channel, fee=X sats" and STOP here.

4. Execute LSPS1 flow:
   ```
   lsp order-create --capacity-sat <lsp_balance_sat> [--push-sat <client_balance_sat>]
   → { order_id, bolt11_invoice, order_total_sat }

   payment send <bolt11_invoice>

   lsp order-get <order_id>   ← poll every 5s until status COMPLETED | FAILED
   ```

If `auto_buy_channel: false` → report the issue, suggest manual action.

## Step 4: Manual Channel Purchase (user-initiated)

When user says "buy a channel" or "I need more inbound/outbound":

1. Ask: LSP capacity wanted (default: `lsp_balance_sat`) and client contribution (default: 0)
2. Get LSP info:
   ```
   lsp info
   lsp network-info  → connection_url
   peer connect <connection_url>
   ```
3. Estimate cost:
   ```
   lsp estimate-fees --capacity-sat <n> [--push-sat <m>]
   → { fee_total_sat, ... }
   ```
4. Show: fee in sats, channel size, expiry (~30 days = 4320 blocks)
5. Ask for confirmation: "Buy {lsp_balance_sat} sat channel for {fee_total_sat} sats fee?"
6. On confirm:
   ```
   lsp order-create --capacity-sat <n> [--push-sat <m>]
   → { order_id, bolt11_invoice }

   payment send <bolt11_invoice>

   lsp order-get <order_id>   ← poll every 5s until COMPLETED
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
2. Always call `lsp info` and `peer connect <url>` before creating an order.
3. Always run `lsp estimate-fees` before `lsp order-create` — verify fee vs. available balance.
4. In `dry_run` mode: report only, do not buy channels.
5. If LSP order fails after payment: log and escalate — do NOT retry automatically.
6. One channel purchase per loop cycle maximum.
