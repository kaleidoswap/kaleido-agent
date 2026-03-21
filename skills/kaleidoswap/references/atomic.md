# Atomic Swap Flow — Detailed Reference

Atomic swaps on KaleidoSwap use Hash Time-Locked Contracts (HTLCs) on Lightning.
The taker (user's RLN node) and maker (KaleidoSwap server) exchange assets atomically —
if either party fails to complete, both get their funds back.

## Full 5-Step Flow

```
1. GET QUOTE
   kaleidoswap_get_pairs()   → find routes (from_layer / to_layer)
   kaleidoswap_get_assets()  → resolve to_asset_id by ticker

   kaleidoswap_get_quote({
     from_asset_id: "BTC",
     from_layer:    "BTC_LN",
     from_amount:   0.001,            // display BTC (= 100,000 sats = 100M msat internally)
     to_asset_id:   "<USDT_ID>",
     to_layer:      "RGB_LN"
   })
   → {
       rfq_id, expires_at,
       from_asset: { ticker, layer, amount_raw, amount_display },
       to_asset:   { ticker, layer, amount_raw, amount_display },
       price
     }

   ↓ Show user: amount in → amount out → effective rate. Wait for confirmation.

2. INIT SWAP
   kaleidoswap_atomic_init({
     rfq_id,
     from_asset_id,
     from_amount_raw,    // = quote.from_asset.amount_raw  (DO NOT convert — use raw directly)
     to_asset_id,
     to_amount_raw       // = quote.to_asset.amount_raw
   })
   → { swapstring, payment_hash }

   swapstring:    encoded HTLC parameters (preimage hash, timelock, amounts)
   payment_hash:  identifier for this swap — keep it for execute and status calls

3. WHITELIST HTLC on RLN node  ← MUST happen before execute
   wdk_atomic_taker({ swapstring })
   → {}

   This tells the RLN node to accept the incoming HTLC from the maker.
   Without this step, the maker's payment will be rejected.

4. EXECUTE SWAP
   wdk_get_node_info()
   → { pubkey }        ← needed as taker_pubkey

   kaleidoswap_atomic_execute({
     swapstring,
     taker_pubkey: pubkey,
     payment_hash
   })
   → { status, message }

   Signals to the maker that the taker is ready to settle.

5. POLL STATUS
   kaleidoswap_atomic_status({ payment_hash })
   → { swap: { status: "Waiting" | "Pending" | "Succeeded" | "Expired" | "Failed" } }

   Poll every 2s. Terminal states: "Succeeded", "Expired", "Failed"
   On "Succeeded" → done ✅
   On "Expired" / "Failed" → fall back to REST order flow
```

## Timing

| Step | Expected latency |
|------|-----------------|
| Init | < 500ms |
| Whitelist | < 1s |
| Execute | < 2s |
| Settlement | 1–5s |
| Total | 5–15s typical |

## Error Handling

| Error | Recovery |
|-------|----------|
| `rfq_id expired` | Call `kaleidoswap_get_quote` again for a fresh quote |
| `wdk_atomic_taker` fails | Do NOT call execute — get new quote and restart |
| Status → `Expired` | Fall back to REST order flow |
| Status → `Failed` | Fall back to REST order flow |
| Timeout (>120s polling) | Treat as Failed, fall back to REST |

## Atomic vs REST: When to Use Which

| Condition | Use atomic | Use REST |
|-----------|-----------|----------|
| Default (`trading_mode: "atomic"`) | ✅ Always try first | — |
| Atomic fails / Expired | — | ✅ Fallback |
| `trading_mode: "rest"` | — | ✅ |
| `trading_mode: "both"` | ✅ Try first | ✅ Fallback |
| No LN channel to maker | — | ✅ Required |

## Key Parameter Notes

- **`from_amount_raw` / `to_amount_raw`**: Pass `amount_raw` fields directly from the quote
  response. These are already in millisatoshis (BTC) or atomic units (RGB). Never re-convert.
- **`taker_pubkey`**: Get from `wdk_get_node_info().pubkey` — call this between steps 3 and 4.
- **`payment_hash`**: Returned by `atomic_init`, used by `atomic_execute` and `atomic_status`.
  It is NOT an `order_id`.
