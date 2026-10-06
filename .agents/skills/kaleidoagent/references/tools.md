# KaleidoAgent Tool Reference — `kaleido-mcp` Unified Server

All tools come from a **single MCP server** (`kaleido-mcp`). No separate server processes needed.

---

## Layer 1 — WDK Built-in Wallet Tools (Spark)

Registered via `WALLET_TOOLS` from `@tetherto/wdk-mcp-toolkit`. Chain: `spark`.

| Tool | Args | Returns |
|------|------|---------|
| `getAddress` | `chain: 'spark'` | `{address}` — Spark L2 receive address |
| `getBalance` | `chain: 'spark'` | `{balance, chain}` — BTC sats on Spark |
| `getTokenBalance` | `chain: 'spark', token?` | `{balance, token}` — USDT token on Spark |
| `sendTransaction` | `chain, to, amount, ...` | `{hash, fee}` — on-chain send |
| `transfer` | `chain, to, amount` | `{hash}` — fee-free Spark→Spark transfer |
| `quoteSendTransaction` | `chain, to, amount` | `{fee}` |
| `quoteTransfer` | `chain, to, amount` | `{fee}` |
| `getFeeRates` | `chain: 'spark'` | `{normal, fast}` (sats/vbyte) |
| `sign` | `chain, message` | `{signature}` |
| `verify` | `chain, message, signature` | `{valid}` |

## Layer 1 — WDK Built-in Pricing Tools (Bitfinex)

Registered via `PRICING_TOOLS` from `@tetherto/wdk-mcp-toolkit`.

| Tool | Args | Returns |
|------|------|---------|
| `getCurrentPrice` | `asset, vs_currency?` | `{price, vs_currency}` — live Bitfinex price |
| `getHistoricalPrice` | `asset, timestamp, vs_currency?` | `{price, timestamp}` |

---

## Layer 2 — Custom Spark Tools (`spark_*`)

Extended Spark wallet operations. Account accessed via WDK internals (`wdk.getAccount('spark', 0)`).

| Tool | Args | Returns |
|------|------|---------|
| `spark_create_lightning_invoice` | `amount_sats?, memo?` | `{invoice, id, amount_sats}` — receive LN payment into Spark |
| `spark_pay_lightning_invoice` | `invoice, max_fee_sats?` | `{id, status, max_fee_sats}` — pay BOLT11 from Spark |
| `spark_quote_lightning_payment` | `invoice` | `{estimated_fee_sats, invoice}` |
| `spark_get_deposit_address` | `reusable?` | `{btc_l1_deposit_address, type}` — BTC L1 → Spark bridge |
| `spark_quote_withdraw` | `onchain_address, amount_sats` | fee quote for BTC L1 withdrawal |
| `spark_withdraw` | `onchain_address, amount_sats` | `{id, status, onchain_address, ...}` — cooperative exit to L1 |
| `spark_get_transfers` | `direction?, limit?` | `{count, transfers:[...]}` |
| `spark_mpp_pay` | `invoice, challenge_id?, max_fee_sats?` | `{paid, payment_id, credential}` — pay MPP challenge from Spark |
| `spark_get_token_balance` | `token?` | `{token, balance, network}` — token balance as string integer |

**Key characteristics:** Zero-fee Spark↔Spark transfers. No RGB assets. No channels/peers. BTC bridge via L1 deposit. Lightning invoice interop.

---

## Layer 3 — RLN Tools (`wdk_*`)

RGB-Lightning-Node. Holds BTC on Lightning + RGB assets (USDT, XAUT). Required for atomic swaps and RGB token operations.

| Tool | Args | Returns |
|------|------|---------|
| `wdk_get_node_info` | — | `{pubkey, num_channels, num_usable_channels, local_balance_sat, num_peers}` |
| `wdk_get_balances` | `skip_sync?` | `{btc_onchain:{vanilla_spendable_sats,colored_spendable_sats}, lightning_balance_sat}` |
| `wdk_get_asset_balance` | `asset_id` | `{asset_id, settled, future, spendable, offchain_outbound, offchain_inbound}` |
| `wdk_list_assets` | `schemas?` | `[{asset_id, name, ticker, precision, schema}]` |
| `wdk_get_address` | — | `{address}` — on-chain BTC address for RLN wallet |
| `wdk_create_rgb_invoice` | `asset_id?, amount?, duration_seconds?` | `{invoice, recipient_id, expires_at}` — use `invoice` as receiver_address |
| `wdk_create_ln_invoice` | `amount_msat?, description?, expiry_sec?` | `{invoice, payment_hash, expiry_sec}` |
| `wdk_pay_invoice` | `invoice` | `{payment_hash, status}` |
| `wdk_send_btc` | `address, amount_sat, fee_rate?` | `{sent, address, amount_sat, fee_rate}` |
| `wdk_send_asset` | `asset_id, recipient_id, amount, transport_endpoints?, fee_rate?` | `{sent, asset_id, recipient_id, amount_raw, txid}` |
| `wdk_list_channels` | `usable_only?` | `{channel_count, total_outbound_msat, total_inbound_msat, channels:[...]}` |
| `wdk_connect_peer` | `peer_pubkey_and_addr` | `{success}` — required before LSPS1 channel open |
| `wdk_open_channel` | `peer_pubkey_and_addr, capacity_sat, push_msat?, asset_id?, asset_amount?, is_public?` | `{temporary_channel_id, status}` |
| `wdk_list_payments` | `limit?, inbound_only?, outbound_only?` | `[{payment_hash, amount_msat, inbound, status}]` |
| `wdk_refresh_transfers` | `skip_sync?` | `{refreshed}` — flush pending RGB transfers |
| `wdk_atomic_taker` | `swapstring` | `{success}` — whitelist HTLC on RLN before atomic_execute |
| `wdk_list_swaps` | — | `{maker:[...], taker:[...], total}` |
| `wdk_get_swap` | `payment_hash, taker?` | `{swap:{payment_hash, status, ...}}` |
| `wdk_mpp_pay` | `invoice, challenge_id?` | `{paid, payment_hash, preimage, credential}` — pay MPP challenge from RLN |

---

## Layer 4 — KaleidoSwap DEX Tools (`kaleidoswap_*`)

REST + atomic HTLC swap engine for RGB assets on Lightning.

| Tool | Args | Returns |
|------|------|---------|
| `kaleidoswap_get_assets` | — | `[{ticker, name, precision, asset_id}]` |
| `kaleidoswap_get_pairs` | — | `[{base, quote, routes:[{from_layer,to_layer}]}]` |
| `kaleidoswap_get_quote` | `from_asset_id, to_asset_id, from_layer, to_layer, from_amount` | `{rfq_id, price, from_asset:{amount_raw,...}, to_asset:{amount_raw,...}, fee, expires_at}` |
| `kaleidoswap_get_spreads` | `from_asset_id, to_asset_id, from_amount` | `{quotes:[{route,price,to_amount_display}], best_route, spread_pct}` |
| `kaleidoswap_lsp_quote_asset_channel` | `asset_id, capacity` | `{quote}` — price an RGB asset channel |
| `kaleidoswap_lsp_create_asset_channel` | `quote_id` | `{order}` — buy the quoted asset channel |
| `kaleidoswap_atomic_init` | `rfq_id, from_asset_id, from_amount_raw, to_asset_id, to_amount_raw` | `{swapstring, payment_hash}` — step 1 of atomic swap |
| `kaleidoswap_atomic_execute` | `swapstring, taker_pubkey, payment_hash` | `{status, message}` — step 3: triggers HTLC settlement |
| `kaleidoswap_atomic_status` | `payment_hash` | `{swap:{payment_hash, status}}` — status: `Waiting\|Pending\|Succeeded\|Expired\|Failed` |
| `kaleidoswap_lsp_get_info` | — | `{lsp_pubkey, lsp_connection_url, supported_assets}` |
| `kaleidoswap_lsp_estimate_fees` | `client_pubkey, lsp_balance_sat, client_balance_sat, channel_expiry_blocks, asset_id?, ...` | `{setup_fee, capacity_fee, duration_fee, total_fee}` (sats) |
| `kaleidoswap_lsp_create_order` | `client_pubkey, lsp_balance_sat, client_balance_sat, ...` | `{order_id, order_state, bolt11_invoice, fee_total_sat}` |
| `kaleidoswap_lsp_get_order` | `order_id` | `{order_id, order_state, payment:{bolt11_invoice,...}}` — state: `CREATED\|CHANNEL_OPENING\|COMPLETED\|FAILED` |

**Layers:** `BTC_LN` (Lightning BTC), `RGB_LN` (Lightning RGB), `BTC_CHAIN` (on-chain BTC), `RGB_CHAIN` (on-chain RGB)

**receiver_address_format:** `RGB_INVOICE` for RGB assets, `BOLT11` for Lightning BTC, `BTC_ADDRESS` for on-chain

---

## Layer 5 — MPP / L402 / 402index.io (`mpp_*` / `l402_*` / `search_*`)

### API Discovery

| Tool | Args | Returns |
|------|------|---------|
| `search_paid_apis` | `query?, protocol?, category?, health?, limit?` | `{total_available, services:[{url, name, price_sats, protocol, category, health}]}` |

**`protocol` values:** `L402` (Lightning macaroon), `MPP` (Machine Payment Protocol), `x402` (Base/Solana)

### MPP Flow (3 steps — must complete before `expires_at` ~60s)

| Tool | Args | Returns |
|------|------|---------|
| `mpp_request_challenge` | `url` | `{challenge_id, invoice, amount_sats, expires_at}` — step 1 |
| `mpp_submit_credential` | `url, credential` | `{ok, status, data, receipt}` — step 3 |
| `mpp_parse_challenge_header` | `url, www_authenticate` | parsed challenge object |

**Pay step (step 2):** Use `wdk_mpp_pay(invoice, challenge_id)` → credential, or `spark_mpp_pay(invoice, challenge_id)` → credential when RLN outbound is low.

### Legacy L402

| Tool | Args | Returns |
|------|------|---------|
| `l402_request_challenge` | `resource_url, price_sats?` | `{invoice, macaroon, price_sats}` |
| `l402_fetch_resource` | `resource_url, token` | `{status, data}` |

---

## Layer 6 — Market Data (`get_price`, `get_market_data`, `get_ohlcv`, `get_sentiment`)

CoinGecko prices + Fear & Greed sentiment (alternative.me). Complementary to Bitfinex `getCurrentPrice`.

| Tool | Args | Returns |
|------|------|---------|
| `get_price` | `asset` (BTC\|USDT\|XAUT\|ETH), `vs_currency?` (usd\|eur\|btc\|sats) | `{asset, price, change_24h_pct, market_cap_usd, volume_24h_usd, vs_currency}` |
| `get_market_data` | `assets` (array 1–4) | `[PriceResult]` — batch price fetch |
| `get_ohlcv` | `asset, days?` (1–90, default 1) | `{candle_count, period_change_pct, latest_close, candles:[{time,open,high,low,close}]}` (last 20) |
| `get_sentiment` | — | `{index_value (0–100), classification, timestamp, trading_signal}` |

**`trading_signal` values:** `STRONG_BUY` (<25), `BUY` (<40), `NEUTRAL`, `SELL` (>60), `STRONG_SELL` (>75)

---

## Decision Matrix: Which Payment Method to Use

| Operation | Tool |
|-----------|------|
| RGB asset swap (USDT/XAUT) | `wdk_*` — Required for RGB |
| Atomic HTLC swap (taker role) | `wdk_atomic_taker` |
| Pay KaleidoSwap deposit — primary | `wdk_pay_invoice` (if has outbound) |
| Pay KaleidoSwap deposit — fallback | `spark_pay_lightning_invoice` |
| Receive BTC from swap (RLN) | `wdk_create_ln_invoice` |
| Receive BTC from swap (Spark) | `spark_create_lightning_invoice` |
| Fee-free BTC transfer | `transfer` (WDK built-in, Spark) |
| MPP micropayment — primary | `wdk_mpp_pay` |
| MPP micropayment — fallback | `spark_mpp_pay` |
| BTC bridge to L1 | `spark_withdraw` (cooperative exit) |
| LSP channel purchase | `wdk_connect_peer` + `kaleidoswap_lsp_*` + `wdk_pay_invoice` |
| Live price check | `getCurrentPrice` (Bitfinex) or `get_price` (CoinGecko) |

---

## Asset IDs by Network

| Network | BTC | USDT (RGB) | XAUT (RGB) |
|---------|-----|------------|------------|
| Staging | `BTC` | `rgb:2JEUOrsc-JsWuPGF-3cr9SSv-mqqRmaz-8waf0gl-8vAcOXw` | resolve via `wdk_list_assets` |
| Mainnet | `BTC` | `rgb:i~xXdG4J-JfXE_QX-RRVCDbQ-ggISPWO-P2yxBGT-nQX19SQ` | `rgb:Vf25LAhx-tcikQu3-O3msZ7~-DcNF4YH-8FCe1FC-Brh2rIc` |

**Always resolve RGB asset IDs dynamically** via `wdk_list_assets` — never hardcode except `BTC`.

Spark tokens use different identifiers (`btkn1...`) — configured via `SPARK_USDT_TOKEN` env var.

---

## Combined BTC Calculation

```
total_btc_sat  = rln_lightning_balance_sat + spark_balance_sats   (from getBalance/wdk_get_balances)
BTC_usd        = (total_btc_sat / 1e8) × btc_price
USDT_usd       = usdt.settled + usdt.offchain_inbound              (from wdk_get_asset_balance)
XAUT_usd       = xaut_amount × xaut_price
total_usd      = BTC_usd + USDT_usd + XAUT_usd
drift          = |current_pct - target_pct|
```
