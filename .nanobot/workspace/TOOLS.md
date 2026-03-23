# Tools

## Control API (kaleidoagent status server)

- URL: `http://127.0.0.1:4242`
- Endpoints: `/health`, `/status`, `/config`, `/run`, `/chat`, `/wallets`
- MCP wrapper: `kaleido_control` (stdio, `dist/control-mcp.js`)

## MCP Servers

| Server | Tools |
|---|---|
| `kaleido` (unified) | `rln_*`, `spark_*`, `kaleidoswap_*`, `mpp_*`, `l402_*`, `search_paid_apis` |
| `kaleido_control` | `agent_*` |

The `kaleido` server is the single unified MCP that exposes all wallet, DEX, and market tools:
- **WDK Spark** — `spark_*` tools (fee-free BTC/token transfers, Lightning invoices, bridge)
- **WDK RLN** — `rln_*` tools (RGB assets, Lightning channels, atomic HTLC swaps)
- **KaleidoSwap DEX** — `kaleidoswap_*` tools (quotes, REST orders, atomic swaps, LSPS1)
- **MPP / L402** — `mpp_*`, `l402_*`, `search_paid_apis` (market data, paid API access)

## External Services

- RLN node: `http://localhost:3001`
- KaleidoSwap API (local): `http://localhost:8000`
- KaleidoSwap API (staging): `https://api.staging.kaleidoswap.com`
- Nanobot gateway: `:18790`

## Asset IDs (staging)

- BTC: `"BTC"` (always)
- USDT: `rgb:2JEUOrsc-JsWuPGF-3cr9SSv-mqqRmaz-8waf0gl-8vAcOXw` (verify live — may rotate)
- XAUT: discover via `kaleidoswap_get_assets` by ticker

## Networks

- RLN + KaleidoSwap: Bitcoin regtest (Bitfinex infra)
- Spark: separate network (mainnet or spark-regtest)
- **Never cross-pay** — invoices from one network are not payable from the other

## exec — Safety Limits

- Commands have a configurable timeout (default 60s)
- Dangerous commands are blocked (rm -rf, format, dd, shutdown, etc.)
- Output is truncated at 10,000 characters

## cron — Scheduled Reminders

- Please refer to cron skill for usage.
