# KaleidoAgent Tool Reference

## KaleidoSwap MCP (`kaleidoswap_*`)

| Tool | Args | Returns |
|------|------|---------|
| `kaleidoswap_get_assets` | — | `[{ticker, name, precision, asset_id}]` |
| `kaleidoswap_get_pairs` | — | `[{base, quote, routes:[{from_layer,to_layer}]}]` |
| `kaleidoswap_get_quote` | `from_asset_id, to_asset_id, from_layer, to_layer, from_amount` | `{rfq_id, price, from_asset:{amount_raw,...}, to_asset:{amount_raw,...}, fee, expires_at}` |
| `kaleidoswap_get_spreads` | `from_asset_id, to_asset_id, from_amount` | `{quotes:[{route,price,to_amount_display}], best_route, spread_pct, arb_opportunity}` |
| `kaleidoswap_place_order` | `from_asset_id, to_asset_id, from_layer, to_layer, from_amount, receiver_address, receiver_address_format` | `{order_id, deposit_address:{address,format}, from_amount_display, to_amount_display}` |
| `kaleidoswap_get_order_status` | `order_id` | `{id, status, from_asset, to_asset, deposit_address, payout_address}` — status: `PENDING\|PROCESSING\|FILLED\|FAILED\|EXPIRED` |
| `kaleidoswap_get_open_orders` | `status_filter?` | `[TrackedOrder]` — from session memory |
| `kaleidoswap_cancel_order` | `order_id` | `{order_id, cancelled, status}` |
| `kaleidoswap_get_position` | — | `{session_summary:{total,filled,pending,failed,fill_rate}, volume_by_asset}` |
| `kaleidoswap_atomic_init` | `rfq_id, from_asset_id, from_amount_raw, to_asset_id, to_amount_raw` | `{swapstring, payment_hash}` — step 1 of atomic swap |
| `kaleidoswap_atomic_execute` | `swapstring, taker_pubkey, payment_hash` | `{status, message}` — step 3: triggers HTLC settlement |
| `kaleidoswap_atomic_status` | `payment_hash` | `{swap:{payment_hash, status}}` — status: `Waiting\|Pending\|Succeeded\|Expired\|Failed` |
| `kaleidoswap_lsp_estimate_fees` | `client_pubkey, lsp_balance_sat, client_balance_sat, channel_expiry_blocks, asset_id?, lsp_asset_amount?, rfq_id?` | `{setup_fee, capacity_fee, duration_fee, total_fee}` (sats) |
| `kaleidoswap_lsp_create_order` | `client_pubkey, lsp_balance_sat, client_balance_sat, required_channel_confirmations, funding_confirms_within_blocks, channel_expiry_blocks, announce_channel, asset_id?, ...` | `{order_id, order_state, bolt11_invoice, fee_total_sat, order_total_sat}` |
| `kaleidoswap_lsp_get_order` | `order_id` | `{order_id, order_state, payment:{bolt11_invoice,...}}` — state: `CREATED\|CHANNEL_OPENING\|COMPLETED\|FAILED\|PENDING_RATE_DECISION` |

**Layers:** `BTC_LN` (Lightning BTC), `RGB_LN` (Lightning RGB), `BTC_CHAIN` (on-chain BTC), `RGB_CHAIN` (on-chain RGB)

**receiver_address_format:** `RGB_INVOICE` for RGB assets, `BTC_ADDRESS` for on-chain BTC, `BOLT11` for Lightning BTC

## WDK Wallet MCP (`wdk_*`)

| Tool | Args | Returns |
|------|------|---------|
| `wdk_get_node_info` | — | `{pubkey, num_channels, num_usable_channels, local_balance_sat, num_peers}` |
| `wdk_get_balances` | `skip_sync?` | `{btc_onchain:{vanilla_spendable_sats,colored_spendable_sats}, lightning_balance_sat}` |
| `wdk_get_asset_balance` | `asset_id` | `{asset_id, settled, future, spendable, offchain_outbound, offchain_inbound}` |
| `wdk_list_assets` | `schemas?` | `[{asset_id, name, ticker, precision, schema}]` |
| `wdk_get_address` | — | `{address}` — on-chain BTC address |
| `wdk_create_rgb_invoice` | `asset_id?, amount?, duration_seconds?` | `{invoice, recipient_id, expires_at}` — use `invoice` as `receiver_address` |
| `wdk_create_ln_invoice` | `amount_msat?, description?, expiry_sec?` | `{invoice, payment_hash, expiry_sec}` |
| `wdk_pay_invoice` | `invoice` | `{payment_hash, status}` |
| `wdk_send_btc` | `address, amount_sat, fee_rate?` | `{sent, address, amount_sat, fee_rate}` |
| `wdk_list_channels` | `usable_only?` | `{channel_count, total_outbound_msat, total_inbound_msat, channels:[...]}` |
| `wdk_open_channel` | `peer_pubkey_and_addr, capacity_sat, push_msat?, asset_id?, asset_amount?, is_public?` | `{temporary_channel_id, status}` |
| `wdk_list_payments` | `limit?, inbound_only?, outbound_only?` | `[{payment_hash, amount_msat, inbound, status, created_at}]` |
| `wdk_refresh_transfers` | `skip_sync?` | `{refreshed}` |
| `wdk_connect_peer` | `peer_pubkey_and_addr` | `{success}` — connect to Lightning peer (required before LSPS1) |
| `wdk_atomic_taker` | `swapstring` | `{success}` — step 2: whitelist HTLC on RLN node before execute |
| `wdk_list_swaps` | — | `{maker:[...], taker:[...], total}` — all atomic swaps on node |
| `wdk_get_swap` | `payment_hash, taker?` | `{swap:{payment_hash, status, ...}}` — node-side atomic swap state |
| `wdk_mpp_pay` | `invoice, challenge_id?, macaroon?` | `{paid, payment_hash, preimage, credential}` — pay MPP challenge, return credential JSON for mpp_submit_credential |

## MPP Gateway MCP (`mpp_*` + legacy `l402_*`)

### Market Data (CoinGecko free tier — max 1 call/30s)

| Tool | Args | Returns |
|------|------|---------|
| `l402_get_price` | `asset` (BTC\|USDT\|XAUT\|ETH), `vs_currency?` | `{asset, price, change_24h_pct, market_cap_usd, volume_24h_usd, last_updated}` |
| `l402_get_market_data` | `assets` (array) | `[PriceResult]` |
| `l402_get_ohlcv` | `asset, days?` | `{candle_count, period_change_pct, latest_close, candles:[{timestamp,open,high,low,close}]}` |
| `l402_get_sentiment` | — | `{index_value (0-100), classification, timestamp, trading_signal}` — signal: `STRONG_BUY_SIGNAL\|BUY_SIGNAL\|NEUTRAL\|SELL_SIGNAL\|STRONG_SELL_SIGNAL` |

### Legacy L402 (for older servers)

| Tool | Args | Returns |
|------|------|---------|
| `l402_request_challenge` | `resource_url, price_sats?` | `{invoice, macaroon, resource, price_sats, next_step}` |
| `l402_fetch_resource` | `resource_url, token` | `{status, data}` |

### MPP (Machine Payments Protocol — for modern servers)

| Tool | Args | Returns |
|------|------|---------|
| `mpp_request_challenge` | `url` | `{challenge_id, method, intent, invoice?, macaroon?, amount_sats, expires_at}` — probe URL, get payment challenge |
| `mpp_submit_credential` | `url, credential` | `{ok, status, data, receipt}` — submit credential JSON from wdk_mpp_pay |
| `mpp_parse_challenge_header` | `url, www_authenticate` | challenge object — parse raw 402 header without HTTP request |

**MPP flow:** `mpp_request_challenge` → `wdk_mpp_pay` (in wdk-wallet-mcp) → `mpp_submit_credential`

## Asset IDs by Network

| Network | BTC asset_id | USDT asset_id |
|---------|-------------|---------------|
| Staging | `BTC` | `rgb:2JEUOrsc-JsWuPGF-3cr9SSv-mqqRmaz-8waf0gl-8vAcOXw` |
| Local regtest | `BTC` | resolve via `wdk_list_assets` |
| Mainnet | `BTC` | resolve via `wdk_list_assets` |

**Always resolve RGB asset IDs dynamically** — never hardcode except BTC.
