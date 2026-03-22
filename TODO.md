# KaleidoAgent — Release TODO

## Critical Path (blocking)

- [x] Add `wdk_connect_peer` tool to `wdk-wallet-rln-mcp` — needed for LSPS1 flow before ordering a channel
- [ ] **Test LSPS1 channel purchase end-to-end**
  - Connect taker to LSP via `wdk_connect_peer <lsp_pubkey>@<host>:<port>`
  - `kaleidoswap_lsp_estimate_fees` → confirm fee (~6320 sats for 100k sat channel)
  - `kaleidoswap_lsp_create_order` → get `bolt11_invoice`
  - `wdk_pay_invoice` → pay invoice
  - Poll `kaleidoswap_lsp_get_order` until `CHANNEL_OPENING` or `COMPLETED`
- [ ] **Fund RGB channels with USDT and XAUT**
  - USDT and XAUT channels exist but `asset_local_amount = 0`
  - Send USDT/XAUT from maker to taker via `wdk_create_rgb_invoice` → `wdk_send_asset`
  - Or execute a BTC→USDT atomic swap first to seed the USDT channel
- [ ] **Test atomic swap end-to-end** (requires funded channels)
  - BTC → USDT: `get_quote` → `atomic_init` → `wdk_atomic_taker` → `get_node_info` → `atomic_execute` → poll `atomic_status`
  - USDT → BTC: reverse direction
  - Verify `wdk_list_swaps` and `wdk_get_swap` reflect the completed swap
- [ ] **Test rebalance loop with `dry_run=false`** (requires atomic swap working)
  - Set `rebalance_interval_sec: 60` for faster iteration
  - Confirm agent computes portfolio drift, picks direction, executes swap
  - Verify balances change after loop completes

## Test Coverage

- [ ] Unit tests for new `kaleidoswap-mcp` tools
  - `kaleidoswap_atomic_init`, `kaleidoswap_atomic_execute`, `kaleidoswap_atomic_status`
  - `kaleidoswap_lsp_estimate_fees` — verify `required_channel_confirmations` default = 0
  - `kaleidoswap_lsp_create_order`, `kaleidoswap_lsp_get_order`
- [ ] Unit tests for new `wdk-wallet-rln-mcp` tools
  - `wdk_connect_peer` — happy path + error
  - `wdk_atomic_taker`, `wdk_list_swaps` (verify `{maker, taker}` shape), `wdk_get_swap`
- [ ] Integration tests for local regtest
  - All 38 MCP tools load
  - Heartbeat loop against `localhost:8000` / `localhost:3001`
  - `kaleidoswap_lsp_estimate_fees` returns valid fee structure
  - Gate on `RLN_NODE_URL=http://localhost:3001`

## Release Prep

- [ ] Commit and push all recent changes
  - `kaleidoswap-mcp`: `estimateLspFees` fix (`required_channel_confirmations` + `funding_confirms_within_blocks`)
  - `wdk-wallet-rln-mcp`: `wdk_connect_peer` tool added (18 tools total)
  - `kaleidoagent`: regtest config (`localhost:8000`, correct asset IDs, `trading_mode: atomic`)
- [ ] Version bumps
  - `kaleidoswap-mcp`: `1.0.0` → `1.1.0` (6 new tools)
  - `wdk-wallet-rln-mcp`: `1.0.0` → `1.1.0` (4 new tools)
  - `kaleidoagent`: `1.0.0` → `1.1.0` (dual trading modes, LSPS1, token tracking)
  - `l402-gateway-mcp`: no changes
- [ ] Tag releases on GitHub (`v1.1.0` on each changed repo)
- [ ] README updates — add **Local Development (Regtest)** section
  - Docker compose startup
  - Env vars: `KALEIDOSWAP_API_URL=http://localhost:8000`, `RLN_NODE_URL=http://localhost:3001`
  - Regtest asset IDs (USDT: `rgb:eElX56I7-...`, XAUT: `rgb:y2giv4DD-...`)
  - Channel seeding steps

## Environment Notes

| Service | URL | Notes |
|---------|-----|-------|
| KaleidoSwap API | `http://localhost:8000` | Local regtest maker |
| Taker RLN node | `http://localhost:3001` (P2P: `9735`) | `039cd219...` — 0 channels, 4.7M sats on-chain |
| Maker RLN node | `http://localhost:3002` (P2P: `9736`) | `033720f7...` — 3 channels |
| Second KS node | `http://localhost:3003` (P2P: `9737`) | |
| Regtest USDT | `rgb:eElX56I7-i1couXO-Yg2xlpG-qYaFPX5-UADWuIn-TuVwZw8` | |
| Regtest XAUT | `rgb:y2giv4DD-Mj~5lIY-AOIaJNM-RbkDvYr-Zg6WHYG-Rwr5o9o` | |
