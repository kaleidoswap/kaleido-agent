# Risk Rules — Portfolio Manager

These rules are enforced on every rebalancing cycle. They protect the node's
operational liquidity and guard against runaway losses.

## Hard Stops (halt all trading immediately)

| Condition | Action |
|-----------|--------|
| BTC balance ≤ `stop_loss_btc_sats` | Halt all trading. Log reason. Do NOT resume until manually re-enabled. |
| Node offline / `wdk_get_node_info()` fails | Skip cycle. Log warning. Do not attempt trades. |

## Soft Guards (skip this cycle)

| Condition | Action |
|-----------|--------|
| BTC after swap < `min_btc_reserve_sats` | Reduce swap size or skip. Preserve operational liquidity. |
| In-flight swaps ≥ `max_concurrent_orders` | Skip cycle. Poll in-flight swaps (`kaleidoswap_atomic_status`), update state. |
| Swap amount > `max_swap_usd` | Cap at `max_swap_usd`. Still execute, just smaller. |
| Quote fails or returns error | Skip cycle. Log error. |
| `rfq_id` expires before execute | Get new quote. Retry once. |

## Position Sizing

```
swap_usd = min(
  drift_pct × total_portfolio_usd / 100,
  max_swap_usd
)
```

Never swing the portfolio by more than the drift amount — this prevents oscillation.

## Dry Run Mode

When `dry_run: true`:
- Run all analysis steps (balances, prices, drift calculation)
- Compute what trade would be made
- Log the full report with `"action": "swap"` but `"dry_run": true`
- **Do NOT call** `kaleidoswap_atomic_init` or `kaleidoswap_atomic_execute`
- Return as if the swap succeeded for reporting purposes

## Default Safe Values

| Parameter | Recommended Default |
|-----------|-------------------|
| `rebalance_threshold_pct` | 5% |
| `max_swap_usd` | $200 |
| `min_btc_reserve_sats` | 50,000 |
| `stop_loss_btc_sats` | 30,000 |
| `max_concurrent_orders` | 3 |

Operators should tune these based on their node's channel capacity and risk appetite.
A node with 1M sats total should set `min_btc_reserve_sats` higher (e.g., 100,000).
