# KaleidoAgent Tool Reference

## KaleidoSwap MCP (`kaleidoswap_*`)

| Tool | Args | Returns |
|------|------|---------|
| `kaleidoswap_get_assets` | — | `[{ticker, name, precision, asset_id}]` |
| `kaleidoswap_get_pairs` | — | `[{base, quote, routes:[{from_layer,to_layer}]}]` |
| `kaleidoswap_get_quote` | `from_asset_id, to_asset_id, from_layer, to_layer, from_amount` | `{rfq_id, price, from_amount_display, to_amount_display, fee, expires_at}` |
| `kaleidoswap_get_spreads` | `from_asset_id, to_asset_id, from_amount` | `{quotes:[{route,price,to_amount_display}], best_route, spread_pct, arb_opportunity}` |
| `kaleidoswap_place_order` | `from_asset_id, to_asset_id, from_layer, to_layer, from_amount, receiver_address, receiver_address_format` | `{order_id, deposit_address:{address,format}, from_amount_display, to_amount_display}` |
| `kaleidoswap_get_order_status` | `order_id` | `{id, status, from_asset, to_asset, deposit_address, payout_address}` — status: `PENDING\|PROCESSING\|FILLED\|FAILED\|EXPIRED` |
| `kaleidoswap_get_open_orders` | `status_filter?` | `[TrackedOrder]` — from session memory |
| `kaleidoswap_cancel_order` | `order_id` | `{order_id, cancelled, status}` |
| `kaleidoswap_get_position` | — | `{session_summary:{total,filled,pending,failed,fill_rate}, volume_by_asset}` |

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

## L402 Gateway MCP (`l402_*`)

| Tool | Args | Returns |
|------|------|---------|
| `l402_get_price` | `asset` (BTC\|USDT\|XAUT\|ETH), `vs_currency?` | `{asset, price, change_24h_pct, market_cap_usd, volume_24h_usd, last_updated}` |
| `l402_get_market_data` | `assets` (array) | `[PriceResult]` |
| `l402_get_ohlcv` | `asset, days?` | `{candle_count, period_change_pct, latest_close, candles:[{timestamp,open,high,low,close}]}` |
| `l402_get_sentiment` | — | `{index_value (0-100), classification, timestamp, trading_signal}` — signal: `STRONG_BUY_SIGNAL\|BUY_SIGNAL\|NEUTRAL\|SELL_SIGNAL\|STRONG_SELL_SIGNAL` |
| `l402_request_challenge` | `resource_url, price_sats?` | `{invoice, macaroon, resource, price_sats, next_step}` |
| `l402_fetch_resource` | `resource_url, token` | `{status, data}` |

## Asset IDs by Network

| Network | BTC asset_id | USDT asset_id |
|---------|-------------|---------------|
| Staging | `BTC` | `rgb:2JEUOrsc-JsWuPGF-3cr9SSv-mqqRmaz-8waf0gl-8vAcOXw` |
| Local regtest | `BTC` | resolve via `wdk_list_assets` |
| Mainnet | `BTC` | resolve via `wdk_list_assets` |

**Always resolve RGB asset IDs dynamically** — never hardcode except BTC.
