# Node Manager Skill

Manage a KaleidoSwap RGB Lightning Node (RLN) via the `kaleido` CLI and the unified `kaleido-mcp` tools.

## What You Can Do

- Start, stop, and monitor the RLN node Docker environment (CLI)
- Initialize and unlock the node wallet (CLI)
- Check BTC and RGB asset balances (MCP: `wdk_get_balances`, `wdk_get_asset_balance`)
- Inspect Lightning channels and peers (MCP: `wdk_list_channels`)
- Create invoices and send Lightning payments (MCP: `wdk_create_ln_invoice`, `wdk_pay_invoice`)
- Query market data (MCP: `kaleidoswap_get_assets`, `kaleidoswap_get_pairs`)

---

## Node Lifecycle (kaleido CLI)

### 1. Check what environments exist
```bash
kaleido --json --agent node list
```
If only one environment exists it is used automatically.

### 2. Start the node
```bash
kaleido --agent node up <NAME>
kaleido --agent node ps <NAME>    # verify containers are running
```

### 3. Check node health
```bash
kaleido --json --agent node info  # confirms RLN is reachable (pubkey, network, peers)
```

### 4. Initialize wallet (first time only)
```bash
kaleido --agent node init         # generates a fresh wallet — store the mnemonic safely
```

### 5. Unlock wallet after restart
```bash
kaleido --agent node unlock <PASSWORD>
```
Must be called every time the node restarts before any Lightning operations.

### 6. Stop / tear down
```bash
kaleido --agent node stop <NAME>   # stops containers, preserves data
kaleido --agent node down <NAME>   # removes containers + networks, preserves volumes
```

---

## Wallet Operations

**Via MCP tools:**
- `wdk_get_balances` — BTC balance (vanilla + colored UTXOs, Lightning)
- `wdk_get_address` — new on-chain deposit address

**Via CLI (for operations not in MCP):**
```bash
kaleido --json --agent wallet balance --skip-sync   # BTC balance
kaleido --json --agent wallet address               # deposit address
kaleido --json --agent wallet utxos --skip-sync     # list UTXOs
kaleido --json --agent wallet send <AMOUNT> <ADDRESS> --fee-rate 1
kaleido --json --agent wallet create-utxos          # allocate UTXO slots for RGB
```

**Important:** Before receiving RGB assets for the first time, create UTXO slots:
```bash
kaleido --agent wallet create-utxos
```

---

## RGB Assets

**Via MCP tools:**
- `wdk_list_assets` — all RGB assets held by this node
- `wdk_get_asset_balance { asset_id }` — balance for a specific RGB asset

**Via CLI:**
```bash
kaleido --json --agent asset list
kaleido --json --agent asset balance <ASSET_ID>
```

RGB asset IDs look like `rgb:2JEUOrsc-JsWuPGF-...`. Use `kaleidoswap_get_assets` or `kaleido market assets` to look up asset IDs by ticker.

---

## Channels & Peers

**Via MCP tools:**
- `wdk_list_channels` — all Lightning channels
- `wdk_connect_peer { peer_addr }` — connect to peer

**Via CLI:**
```bash
kaleido --json --agent channel list
kaleido --json --agent peer list
kaleido --agent peer connect <PUBKEY@HOST:PORT>
```

---

## Lightning Payments

**Via MCP tools:**
- `wdk_create_ln_invoice { amount_msat?, expiry? }` — BTC Lightning invoice
- `wdk_create_rgb_invoice { asset_id, amount }` — RGB asset invoice
- `wdk_pay_invoice { invoice }` — pay a Lightning invoice
- `wdk_list_payments` — list payments

**Via CLI:**
```bash
kaleido --json --agent payment invoice --amount-msat <N>
kaleido --json --agent payment send <INVOICE>
kaleido --json --agent payment list
kaleido --json --agent payment status <PAYMENT_HASH>
```

- For BTC: amount is in millisatoshis.
- For RGB: include `--asset-id` and `--asset-amount`.

---

## Market & Swaps

**Via MCP tools:**
- `kaleidoswap_get_assets` — tradeable assets (ticker + asset_id + precision)
- `kaleidoswap_get_pairs` — available trading pairs
- `kaleidoswap_get_quote { from_asset_id, to_asset_id, from_layer, to_layer, from_amount }` — quote

**Via CLI:**
```bash
kaleido --json --agent market assets
kaleido --json --agent market pairs
kaleido --json --agent market quote BTC/USDT --from-amount 100000 --from-layer BTC_LN --to-layer RGB_LN
kaleido --json --agent swap node list           # swaps known to local node
kaleido --json --agent swap atomic status <PAYMENT_HASH>
```

Layer values: `BTC_LN`, `RGB_LN`, `BTC_ONCHAIN`

---

## Standard Startup Sequence

When starting a node for the first time or after a reboot:

1. `kaleido --agent node list` — find the environment name
2. `kaleido --agent node up <NAME>` — start Docker containers
3. `kaleido --agent node ps <NAME>` — confirm containers are healthy
4. `kaleido --json --agent node info` — confirm RLN daemon is reachable
5. `kaleido --agent node unlock <PASSWORD>` OR `kaleido --agent node init` (first time)
6. `wdk_get_balances` or `kaleido --json --agent wallet balance` — check funds
7. `wdk_get_node_info` — confirm pubkey and network

---

## Decision Logic

- If node is **down**: start with `kaleido --agent node up`, then unlock.
- If wallet is **locked** (node running but operations fail): call `kaleido --agent node unlock`.
- If **no UTXOs for RGB**: call `kaleido --agent wallet create-utxos` before receiving assets.
- For swap quotes: use `kaleidoswap_get_quote` (MCP) or `kaleido market quote` (CLI) — same API.
- Always check node health before performing operations.
