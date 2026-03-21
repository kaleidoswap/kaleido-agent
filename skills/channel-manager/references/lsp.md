# LSPS1 Channel Purchase — Reference

KaleidoSwap implements the LSPS1 Lightning Service Provider protocol.
This allows you to buy a pre-funded Lightning channel with a single payment.

## How It Works

The LSP (KaleidoSwap) opens a channel TO your node with its own funds (`lsp_balance_sat`).
You optionally contribute `client_balance_sat` to have immediate outbound liquidity.
You pay a one-time fee in BTC via Lightning invoice.

```
You ──pay fee──→ KaleidoSwap LSP
KaleidoSwap LSP ──opens channel──→ Your RLN Node
  - LSP side: lsp_balance_sat (your inbound)
  - Your side: client_balance_sat (your outbound, can be 0)
```

## Full LSPS1 Flow

```
0. GET LSP INFO + CONNECT PEER  ← always do this first
   kaleidoswap_lsp_get_info()
   → { lsp_connection_url: "pubkey@host:port", options: {...} }

   wdk_connect_peer({ address: lsp_connection_url })
   → {}

   wdk_get_node_info()
   → { pubkey }    ← your node's pubkey, required for all LSP calls

1. ESTIMATE FEES
   kaleidoswap_lsp_estimate_fees({
     client_pubkey:         "<your_node_pubkey>",
     lsp_balance_sat:       2000000,
     client_balance_sat:    0,
     channel_expiry_blocks: 4320
   })
   → { fee: { setup_fee_sat: 1000, capacity_fee_sat: 20000, fee_total_sat: 25320 } }

   ↓ Show user: fee amount, channel size, expiry (~30 days)
   ↓ Ask for confirmation before paying

2. CREATE ORDER
   kaleidoswap_lsp_create_order({
     client_pubkey:         "<your_node_pubkey>",
     lsp_balance_sat:       2000000,
     client_balance_sat:    0,
     channel_expiry_blocks: 4320
   })
   → { order_id: "uuid", bolt11_invoice: "lnbc...", order_total_sat: 25320 }

3. PAY THE INVOICE
   wdk_pay_invoice({ invoice: bolt11_invoice })
   → { preimage: "...", fee_msat: 500 }

4. POLL ORDER STATUS
   kaleidoswap_lsp_get_order({ order_id: "uuid" })
   → { order: { order_id, status: "PENDING"|"CHANNEL_OPENING"|"COMPLETED"|"FAILED", channel_id: "..." } }

   Poll every 5s. Channel typically opens within 30–120s.
   Terminal states: "COMPLETED", "FAILED"
```

## Parameters

| Parameter | Description | Typical Value |
|-----------|-------------|---------------|
| `client_pubkey` | Your RLN node's public key (from `wdk_get_node_info`) | hex string |
| `lsp_balance_sat` | Inbound capacity from LSP (sats) | 2,000,000 |
| `client_balance_sat` | Your initial outbound (sats) | 0 (pure inbound) |
| `channel_expiry_blocks` | Channel lifetime in blocks (~10min/block) | 4,320 (~30 days) |
| `fee_total_sat` | One-time fee paid to LSP | ~25,000 sat for 2M channel |

## Cost Reference (approximate, for localhost:8000)

| Channel Size | Setup Fee | Capacity Fee | Total Fee |
|-------------|-----------|--------------|-----------|
| 100,000 sat | 1,000 sat | ~1,000 sat   | ~2,000 sat |
| 500,000 sat | 1,000 sat | ~5,000 sat   | ~6,000 sat |
| 2,000,000 sat | 1,000 sat | ~20,000 sat | ~25,320 sat |

Actual fees come from `kaleidoswap_lsp_estimate_fees()` — always check before paying.

## Error Handling

| Error | Recovery |
|-------|----------|
| Payment fails | Do NOT retry automatically — check balance first |
| Order status `FAILED` after payment | Log with `order_id`, escalate — do not retry |
| Channel does not appear after 10 min | Poll once more, then report issue |
| Fee changed between estimate and create | Re-estimate before paying |
| `wdk_connect_peer` fails | Verify LSP is reachable; retry connection |
