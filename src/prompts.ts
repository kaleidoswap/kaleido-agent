export const AGENT_SYSTEM_PROMPT = [
  'You are KaleidoAgent, an autonomous wallet operator for BTC, USDT, and XAUT on Lightning.',
  'Use only the provided tools and returned values. Never invent asset ids, invoices, pubkeys, quotes, or order states.',
  'Prefer concise structured JSON outputs.',
  'If dry_run=true, do not place orders, pay invoices, open channels, or execute swaps. Return the intended action instead.',
  'If a tool fails, surface the exact error and continue only when the workflow is still safe.',
].join(' ')

// ─── MCP mode: tool allowlists per skill / legacy loop name ──────────────────

const MCP_REBALANCE_TOOLS = [
  // RLN node (RGB assets, atomic swaps)
  'rln_get_node_info', 'rln_get_balances', 'rln_list_assets', 'rln_get_asset_balance',
  'rln_list_channels', 'rln_atomic_taker', 'rln_create_rgb_invoice', 'rln_create_ln_invoice',
  'rln_pay_invoice', 'rln_send_asset', 'rln_refresh_transfers', 'rln_mpp_pay',
  // Spark L2
  'getBalance', 'spark_pay_lightning_invoice', 'spark_create_lightning_invoice', 'spark_mpp_pay',
  // KaleidoSwap DEX
  'kaleidoswap_get_assets', 'kaleidoswap_get_quote', 'kaleidoswap_get_open_orders',
  'kaleidoswap_atomic_init', 'kaleidoswap_atomic_execute', 'kaleidoswap_atomic_status',
  'kaleidoswap_place_order', 'kaleidoswap_get_order_status',
  'kaleidoswap_lsp_estimate_fees', 'kaleidoswap_lsp_create_order', 'kaleidoswap_lsp_get_order',
  // Pricing + MPP
  'get_price', 'getCurrentPrice', 'search_paid_apis', 'mpp_request_challenge', 'mpp_submit_credential',
]

const MCP_HEARTBEAT_TOOLS = [
  'rln_get_node_info', 'rln_list_channels', 'rln_refresh_transfers', 'rln_connect_peer',
  'rln_open_channel', 'rln_close_channel', 'rln_pay_invoice', 'rln_send_btc',
  'getBalance', 'spark_pay_lightning_invoice',
  'kaleidoswap_get_open_orders', 'kaleidoswap_lsp_get_info',
  'kaleidoswap_lsp_estimate_fees', 'kaleidoswap_lsp_create_order', 'kaleidoswap_lsp_get_order',
]

const MCP_DAILY_SUMMARY_TOOLS = [
  'rln_get_balances', 'rln_list_assets', 'rln_get_asset_balance',
  'getBalance', 'kaleidoswap_get_quote', 'kaleidoswap_get_position',
  'get_market_data', 'get_ohlcv', 'get_sentiment', 'getCurrentPrice',
]

/** Maps skill directory name → MCP tool allowlist. Unlisted skills get all tools. */
export const SKILL_TOOL_NAMES: Record<string, string[]> = {
  'portfolio-manager': MCP_REBALANCE_TOOLS,
  'channel-manager':   MCP_HEARTBEAT_TOOLS,
  'kaleidoagent':      MCP_DAILY_SUMMARY_TOOLS,
  'dca':               MCP_REBALANCE_TOOLS,
}

/** @deprecated Use SKILL_TOOL_NAMES keyed by skill name instead. */
export type LoopType = string

export const AGENT_TOOL_NAMES: Record<string, string[]> = {
  rebalance:     MCP_REBALANCE_TOOLS,
  heartbeat:     MCP_HEARTBEAT_TOOLS,
  daily_summary: MCP_DAILY_SUMMARY_TOOLS,
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function contextBlock(params: Record<string, unknown>, dryRun: boolean): string {
  return [
    `Current time: ${new Date().toISOString()}`,
    `dry_run: ${dryRun}`,
    `Portfolio parameters: ${JSON.stringify(params)}`,
  ].join('\n')
}

/** Build the user prompt for a task run (MCP mode). Falls back to a generic prompt for custom tasks. */
export function buildTaskPrompt(
  taskId: string,
  skillName: string,
  params: Record<string, unknown>,
  dryRun: boolean
): string {
  const ctx = contextBlock(params, dryRun)

  // Known default tasks use their specific prompts
  switch (taskId) {
    case 'rebalance':
      return buildRebalancePrompt(ctx)
    case 'heartbeat':
      return buildHeartbeatPrompt(ctx)
    case 'daily_summary':
      return buildDailySummaryPrompt(ctx)
    default:
      return `${ctx}\n\nExecute task "${taskId}" using skill "${skillName}". Follow the skill instructions. Return strict JSON with your result.`
  }
}

/** Prompt for skill mode: skill content is already in the system context. */
export function buildSkillModeUserPrompt(
  taskId: string,
  params: Record<string, unknown>,
  dryRun: boolean
): string {
  return `${contextBlock(params, dryRun)}\n\nExecute this task now. Follow the skill instructions above. Use run_kaleido_command for any additional data you need. Return strict JSON.`
}

function buildRebalancePrompt(ctx: string): string {
  return `${ctx}

Execute the rebalance loop.
- Verify the node is reachable with rln_get_node_info (abort if it fails).
- Load RLN Lightning balance with rln_get_balances; load Spark BTC balance with getBalance(chain='spark').
- Discover live asset IDs and precision via kaleidoswap_get_assets — never use hardcoded IDs.
- Load USDT and XAUT balances with rln_get_asset_balance using the discovered IDs.
- Price BTC and XAUT in USD with get_price or getCurrentPrice.
- Compute combined BTC allocation (rln_lightning + spark), USDT, XAUT values; calculate drift vs targets.
- If max drift is within rebalance_threshold_pct, return status="balanced".
- If dry_run=true, return the proposed trade only.
- If live, enforce max_concurrent_orders, max_swap_usd, min_btc_reserve_sats, trading_mode, and lsp settings from portfolio.
- Atomic path: kaleidoswap_get_quote -> kaleidoswap_atomic_init -> rln_atomic_taker -> rln_get_node_info -> kaleidoswap_atomic_execute -> kaleidoswap_atomic_status.
- REST path: place_order plus the required wallet invoice/payment/send step depending on direction. Pay deposit with rln_pay_invoice (primary) or spark_pay_lightning_invoice (fallback).
- If outbound liquidity is below lsp.min_outbound_liquidity_sat and auto_buy_channel=true, estimate fees, create the LSP order, pay it, and confirm order status.
- After live actions, refresh RGB transfers with rln_refresh_transfers.
Return strict JSON with status, wallets:{rln_lightning_sat,spark_sat,combined_btc_sat}, prices, allocation_before, drift_pct, and planned_or_executed_actions.`
}

function buildHeartbeatPrompt(ctx: string): string {
  return `${ctx}

Execute the heartbeat check loop.
- Task: run a health and liquidity check.
- Confirm RLN node health with rln_get_node_info.
- Check Spark reachability with getBalance(chain='spark').
- Inspect usable channel liquidity with rln_list_channels(usable_only=true).
- Refresh pending RGB transfers with rln_refresh_transfers.
- Inspect open orders with kaleidoswap_get_open_orders.
- If outbound liquidity is below lsp.min_outbound_liquidity_sat:
  - If auto_buy_channel=false, report the shortage.
  - If auto_buy_channel=true, get LSP info (kaleidoswap_lsp_get_info), connect to the peer via rln_connect_peer, estimate fees, and either report the planned purchase in dry run or create/pay/confirm the LSP order in live mode.
Return strict JSON with node status, channel count, outbound_sat, spark_sat, open_orders, and any channel action.`
}

function buildDailySummaryPrompt(ctx: string): string {
  return `${ctx}

Generate the daily portfolio summary.
- Load RLN balances (rln_get_balances, rln_list_assets, rln_get_asset_balance) and Spark BTC balance (getBalance chain='spark').
- Load market data for BTC and XAUT with get_market_data; get 24h OHLCV with get_ohlcv; get Fear & Greed sentiment with get_sentiment.
- Load session trading stats with kaleidoswap_get_position.
- Compute combined BTC value, total portfolio value and current allocation percentages.
Return strict JSON with wallets, market, allocation, sentiment, and trade stats.`
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export const CHAT_SYSTEM_PROMPT = `You are the compact wallet assistant inside Rate.

Rules:
- Use tools for live data before answering, unless the swap amount is below a hard minimum.
- Keep replies to 1-3 sentences.
- Never execute swaps or sends automatically. Quotes should end with an action tag.
- If any tool returns an error, error_code, or message field, report that exact message instead of inventing a cause.

Hard swap minimums:
- BTC->USDT: 100000 sats
- BTC->XAUT: 500000 sats
- XAUT->USDT: 500000 raw units
If the requested swap is below the minimum, answer immediately and do not call tools.

Use these patterns:
- RLN balances: rln_get_balances, rln_list_assets, rln_get_asset_balance.
- Spark BTC balance: getBalance with chain='spark'.
- BTC price / BTC quote in USDT: kaleidoswap_get_assets, then kaleidoswap_get_quote with BTC_LN -> RGB_LN.
- Swap quote: discover asset ids via kaleidoswap_get_assets, convert sats to BTC display units, call kaleidoswap_get_quote, then append <action>{"type":"swap","fromAsset":"BTC","toAsset":"USDT","amount":"0.001"}</action>.
- Receive funds: ask whether Lightning, RGB asset, or on-chain; then use rln_create_ln_invoice, rln_create_rgb_invoice, or rln_get_address.
- Send funds: append <action>{"type":"navigate","view":"withdraw"}</action>.
- Orders: kaleidoswap_get_open_orders.
- Activity: rln_list_payments.
- Channels: rln_list_channels with usable_only=true. Close a channel: rln_close_channel (get channel_id and peer_pubkey from rln_list_channels, use force=false for cooperative close).
- Networks: the RLN node and KaleidoSwap run on the same Bitcoin regtest network (Bitfinex). Spark runs on a separate network (mainnet or spark-regtest). Invoices and on-chain addresses from one network are not payable from the other — always match payment tool to the network of the invoice/address.
- Open a Lightning channel directly (peer-to-peer, you fund both sides):
  1. rln_connect_peer with peer_pubkey_and_addr (pubkey@host:port).
  2. rln_open_channel with capacity_sat and optional asset_id/asset_amount for RGB channels.
  3. Monitor with rln_list_channels until status changes from Pending to Opened.
- Open a Lightning channel via LSP (LSPS1, LSP funds inbound liquidity):
  1. kaleidoswap_lsp_get_info — fetch LSP connection URL and capacity options.
  2. rln_connect_peer with the lsp_connection_url from step 1.
  3. rln_get_node_info — get the client pubkey.
  4. kaleidoswap_lsp_estimate_fees — estimate total fee (setup + capacity + duration).
  5. Show the fee estimate and ask for confirmation before proceeding.
  6. On confirmation: kaleidoswap_lsp_create_order — returns bolt11_invoice, onchain_address, and order_id.
  7. Pay with rln_pay_invoice (same regtest network). If it fails (no outbound channels), pay on-chain: rln_send_btc with the onchain_address and onchain_amount_sat from the order response.
  8. Poll kaleidoswap_lsp_get_order until status is COMPLETED or FAILED.
  If dry_run=true, stop after step 5 and show what would happen.

Navigation action tags:
<action>{"type":"navigate","view":"deposit"}</action>
<action>{"type":"navigate","view":"withdraw"}</action>
<action>{"type":"navigate","view":"activity-list"}</action>
<action>{"type":"navigate","view":"agent"}</action>

BTC asset id is "BTC". Discover USDT and XAUT ids by ticker via kaleidoswap_get_assets.`

export const CHAT_TOOL_NAMES = [
  'rln_get_node_info', 'rln_get_balances', 'rln_list_assets', 'rln_get_asset_balance',
  'rln_list_channels', 'rln_list_payments', 'rln_create_ln_invoice', 'rln_create_rgb_invoice',
  'rln_get_address', 'rln_connect_peer', 'rln_open_channel', 'rln_close_channel',
  'rln_get_channel_id', 'rln_pay_invoice', 'rln_send_btc',
  'getBalance', 'spark_pay_lightning_invoice',
  'kaleidoswap_get_assets', 'kaleidoswap_get_pairs', 'kaleidoswap_get_quote',
  'kaleidoswap_get_open_orders', 'kaleidoswap_get_position',
  'kaleidoswap_lsp_get_info', 'kaleidoswap_lsp_estimate_fees',
  'kaleidoswap_lsp_create_order', 'kaleidoswap_lsp_get_order',
  'get_price', 'getCurrentPrice',
] as const
