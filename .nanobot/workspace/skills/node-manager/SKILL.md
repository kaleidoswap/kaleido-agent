# Node Manager Skill

You can manage a KaleidoSwap RGB Lightning Node (RLN) running on Bitcoin **signet** using the `kaleido_*` tools provided by the kaleido-node-mcp server.

## What You Can Do

- Start, stop, and monitor the RLN node Docker environment
- Initialize and unlock the node wallet
- Check BTC and RGB asset balances
- Inspect Lightning channels and peers
- Create invoices and send Lightning payments
- Query market data and swap history directly from the node
- Adjust kaleido CLI configuration

---

## Node Lifecycle

### 1. Check what environments exist
```
kaleido_node_list → lists all named environments with their node URLs
```
If only one environment exists it is used automatically.

### 2. Start the node
```
kaleido_node_up { name? }   → docker compose up -d
kaleido_node_ps { name? }   → verify containers are running
```

### 3. Check node health
```
kaleido_node_status   → confirms RLN is reachable (quick health check)
kaleido_node_info     → detailed node info (pubkey, network, peers count)
```

### 4. Initialize wallet (first time only)
```
kaleido_node_init { password }
```
Run **once** after the very first `kaleido_node_up`. Generates a fresh wallet. Store the mnemonic safely — it will be printed in the response.

To restore from an existing mnemonic:
```
kaleido_node_init { password, mnemonic }
```

### 5. Unlock wallet after restart
```
kaleido_node_unlock { password, announce_alias?, announce_address? }
```
Must be called every time the node restarts before any Lightning operations.

### 6. Lock wallet
```
kaleido_node_lock
```

### 7. Stop / tear down
```
kaleido_node_stop { name? }  → stops containers, preserves data
kaleido_node_down { name? }  → removes containers + networks, preserves volumes
```

---

## Wallet Operations

```
kaleido_wallet_balance { skip_sync? }   → BTC balance (vanilla + colored UTXOs)
kaleido_wallet_address                  → get a new on-chain deposit address
kaleido_wallet_utxos                    → list all UTXOs
kaleido_wallet_send { amount, address, fee_rate? }  → send on-chain BTC (sats)
kaleido_wallet_create_utxos { num?, size?, fee_rate? }
```

**Important:** Before receiving RGB assets for the first time, call `kaleido_wallet_create_utxos` to allocate UTXO slots.

---

## RGB Assets

```
kaleido_asset_list                  → all RGB assets held by this node
kaleido_asset_balance { asset_id }  → balance for a specific RGB asset
```

RGB asset IDs look like `rgb:2JEUOrsc-JsWuPGF-...`. Use `kaleido_market_assets` to look up asset IDs by ticker.

---

## Channels & Peers

```
kaleido_channel_list              → all Lightning channels (capacity, state, RGB allocations)
kaleido_peer_list                 → connected peers
kaleido_peer_connect { peer }     → connect: pubkey@host:port
```

---

## Lightning Payments

```
kaleido_payment_invoice { amount?, asset_id?, description? }
kaleido_payment_send    { invoice }
kaleido_payment_list
```

- For BTC: omit `asset_id`, `amount` is in millisatoshis.
- For RGB: include `asset_id`, `amount` is in asset units.

---

## Market & Swaps

```
kaleido_market_assets            → tradeable assets on KaleidoSwap (ticker + asset_id + precision)
kaleido_market_pairs             → available trading pairs
kaleido_market_quote { pair, from_amount?, to_amount?, from_layer?, to_layer? }
kaleido_swap_history { status?, limit? }
kaleido_swap_status  { order_id }
kaleido_swap_node_swaps          → swaps known to the local RLN node
```

Layer values: `BTC_LN`, `RGB_LN`, `BTC_ONCHAIN`

---

## Config

```
kaleido_config_show                       → current CLI config (api_url, node_url, network)
kaleido_config_set { key, value }         → update a config key
```
Config keys: `api-url`, `node-url`, `network`, `spawn-dir`

---

## Standard Startup Sequence

When starting a node for the first time or after a reboot:

1. `kaleido_node_list` — find the environment name
2. `kaleido_node_up { name }` — start Docker containers
3. `kaleido_node_ps { name }` — confirm containers are healthy
4. `kaleido_node_status` — confirm RLN daemon is reachable
5. `kaleido_node_unlock { password }` OR `kaleido_node_init { password }` (first time)
6. `kaleido_node_info` — confirm pubkey and network = signet
7. `kaleido_wallet_balance` — check on-chain funds

---

## Signet Context

The node runs on **Bitcoin signet** connected to the KaleidoSwap staging API (`https://api.staging.kaleidoswap.com`). Funds have no real-world value. Use signet faucets to get test BTC.

USDT on staging: `rgb:2JEUOrsc-JsWuPGF-3cr9SSv-mqqRmaz-8waf0gl-8vAcOXw`
XAUT on staging: `rgb:Vf25LAhx-tcikQu3-O3msZ7~-DcNF4YH-8FCe1FC-Brh2rIc`

---

## Decision Logic

- If node is **down**: start with `kaleido_node_up`, then unlock.
- If wallet is **locked** (node running but operations fail): call `kaleido_node_unlock`.
- If **no UTXOs for RGB**: call `kaleido_wallet_create_utxos` before receiving assets.
- If checking swap opportunities: use `kaleido_market_quote` to compare rates against the main KaleidoSwap MCP tools (`get_quote`) — they query the same API.
- Always `kaleido_node_status` before performing operations to confirm the daemon is up.
