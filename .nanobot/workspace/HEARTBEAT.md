# KaleidoAgent Heartbeat

Check the following in order. Use `kaleido_control` tools for all status queries.

## Checks (run 2–3x per day)

- [ ] **Agent health** — ping `/health` on :4242. Alert if down.
- [ ] **Loop status** — `/status` — check last_run times for rebalance, heartbeat,
      daily_summary. Alert if any loop hasn't run in >2x its configured interval.
- [ ] **Wallet snapshot** — report combined BTC, USDT, XAUT values from `/status`.
- [ ] **In-flight swaps** — flag any atomic swap stuck in pending for >30 min.
- [ ] **Channel liquidity** — alert if outbound_sat < min_outbound_liquidity_sat from config.

## Thresholds

- Outbound liquidity critical: < 2000 sat
- BTC reserve floor: 50000 sat (stop_loss)
- Max concurrent orders: 3

## When to Reach Out

- Agent process is down
- A loop has not run in >2 intervals
- BTC balance near stop_loss_btc_sats
- A swap is stuck

## When to Stay Quiet (reply HEARTBEAT_OK)

- All loops healthy, last run < 2 intervals ago
- Balances nominal, no stuck swaps
- Nothing actionable found

## dry_run reminder

Do not trigger rebalance, channel purchase, or any wallet action without explicit user confirmation
when dry_run=true (default). Report what would happen instead.
