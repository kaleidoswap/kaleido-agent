# Tools — Local Environment

## Control API (kaleidoagent status server)

- URL: `http://127.0.0.1:4242`
- Endpoints: `/health`, `/status`, `/config`, `/run`, `/chat`, `/wallets`
- MCP wrapper: `kaleido_control` (stdio, `dist/control-mcp.js`)

## MCP Servers (HTTP, stateless)

| Server | Port | Tools |
|---|---|---|
| kaleidoswap-mcp | :3010 | kaleidoswap_* (quotes, orders, atomic, LSP) |
| wdk-wallet-mcp | :3011 | rln_*, spark_* |
| mpp-gateway-mcp | :3012 | get_price, get_market_data, mpp_* |

## MCP Servers (stdio)

- `kaleido_control`: `node ./dist/control-mcp.js`
- `kaleido` (unified): `kaleido-mcp` (installed via `npm install -g kaleido-mcp`)

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
