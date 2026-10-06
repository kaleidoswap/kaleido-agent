export const AGENT_SYSTEM_PROMPT = [
  'You are KaleidoAgent, an autonomous wallet operator for BTC, USDT, and XAUT on Lightning.',
  'Use only the provided tools and returned values. Never invent asset ids, invoices, pubkeys, quotes, or order states.',
  'Prefer concise structured JSON outputs.',
  'If dry_run=true, do not start swaps, pay invoices, open channels, or execute swaps. Return the intended action instead.',
  'If a tool fails, surface the exact error and continue only when the workflow is still safe.',
].join(' ')

// ─── MCP mode: tool allowlists per skill / legacy loop name ──────────────────

const MCP_REBALANCE_TOOLS = [
  // RLN node (RGB assets, atomic swaps)
  'wdk_get_node_info', 'wdk_get_balances', 'wdk_list_assets', 'wdk_get_asset_balance',
  'wdk_list_channels', 'wdk_atomic_taker', 'wdk_create_rgb_invoice', 'wdk_create_ln_invoice',
  'wdk_pay_invoice', 'wdk_send_asset', 'wdk_refresh_transfers', 'wdk_mpp_pay',
  // Spark L2
  'spark_get_balance', 'spark_pay_lightning_invoice', 'spark_create_lightning_invoice', 'spark_mpp_pay',
  // KaleidoSwap DEX
  'wdk_list_swaps', 'wdk_get_swap',
  'kaleidoswap_get_assets', 'kaleidoswap_get_quote',
  'kaleidoswap_atomic_init', 'kaleidoswap_atomic_execute', 'kaleidoswap_atomic_status',
  'kaleidoswap_lsp_estimate_fees', 'kaleidoswap_lsp_create_order', 'kaleidoswap_lsp_get_order',
  // Pricing + MPP
  'l402_get_price', 'l402_get_market_data', 'search_paid_apis', 'mpp_request_challenge', 'mpp_submit_credential',
]

const MCP_HEARTBEAT_TOOLS = [
  'wdk_get_node_info', 'wdk_list_channels', 'wdk_refresh_transfers', 'wdk_connect_peer',
  'wdk_open_channel', 'wdk_close_channel', 'wdk_pay_invoice', 'wdk_send_btc',
  'spark_get_balance', 'spark_pay_lightning_invoice',
  'wdk_list_swaps', 'kaleidoswap_lsp_get_info',
  'kaleidoswap_lsp_estimate_fees', 'kaleidoswap_lsp_create_order', 'kaleidoswap_lsp_get_order',
]

const MCP_DAILY_SUMMARY_TOOLS = [
  'wdk_get_balances', 'wdk_list_assets', 'wdk_get_asset_balance',
  'spark_get_balance', 'kaleidoswap_get_quote', 'wdk_list_swaps',
  'l402_get_market_data', 'l402_get_ohlcv', 'l402_get_sentiment', 'l402_get_price',
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
- Verify the node is reachable with wdk_get_node_info (abort if it fails).
- Load RLN Lightning balance with wdk_get_balances; load Spark BTC balance with spark_get_balance.
- Discover live asset IDs and precision via kaleidoswap_get_assets — never use hardcoded IDs.
- Load USDT and XAUT balances with wdk_get_asset_balance using the discovered IDs.
- Price BTC and XAUT in USD with l402_get_price.
- Compute combined BTC allocation (rln_lightning + spark), USDT, XAUT values; calculate drift vs targets.
- If max drift is within rebalance_threshold_pct, return status="balanced".
- If dry_run=true, return the proposed trade only.
- If live, count in-flight taker swaps with wdk_list_swaps and enforce max_concurrent_orders against them, plus max_swap_usd, min_btc_reserve_sats, trading_mode, and lsp settings from portfolio.
- Swaps are atomic only: kaleidoswap_get_quote -> kaleidoswap_atomic_init -> wdk_atomic_taker -> wdk_get_node_info -> kaleidoswap_atomic_execute -> kaleidoswap_atomic_status.
- If outbound liquidity is below lsp.min_outbound_liquidity_sat and auto_buy_channel=true, estimate fees, create the LSP order, pay it, and confirm order status.
- After live actions, refresh RGB transfers with wdk_refresh_transfers.
Return strict JSON with status, wallets:{rln_lightning_sat,spark_sat,combined_btc_sat}, prices, allocation_before, drift_pct, and planned_or_executed_actions.`
}

function buildHeartbeatPrompt(ctx: string): string {
  return `${ctx}

Execute the heartbeat check loop.
- Task: run a health and liquidity check.
- Confirm RLN node health with wdk_get_node_info.
- Check Spark reachability with spark_get_balance.
- Inspect usable channel liquidity with wdk_list_channels(usable_only=true).
- Refresh pending RGB transfers with wdk_refresh_transfers.
- Inspect in-flight swaps with wdk_list_swaps.
- If outbound liquidity is below lsp.min_outbound_liquidity_sat:
  - If auto_buy_channel=false, report the shortage.
  - If auto_buy_channel=true, get LSP info (kaleidoswap_lsp_get_info), connect to the peer via wdk_connect_peer, estimate fees, and either report the planned purchase in dry run or create/pay/confirm the LSP order in live mode.
Return strict JSON with node status, channel count, outbound_sat, spark_sat, pending_swaps, and any channel action.`
}

function buildDailySummaryPrompt(ctx: string): string {
  return `${ctx}

Generate the daily portfolio summary.
- Load RLN balances (wdk_get_balances, wdk_list_assets, wdk_get_asset_balance) and Spark BTC balance (spark_get_balance).
- Load market data for BTC and XAUT with l402_get_market_data; get 24h OHLCV with l402_get_ohlcv; get Fear & Greed sentiment with l402_get_sentiment.
- Load swap history with wdk_list_swaps (taker side) for trade stats.
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
- RLN balances: wdk_get_balances, wdk_list_assets, wdk_get_asset_balance.
- Spark BTC balance: spark_get_balance.
- BTC price / BTC quote in USDT: kaleidoswap_get_assets, then kaleidoswap_get_quote with BTC_LN -> RGB_LN.
- Swap quote: discover asset ids via kaleidoswap_get_assets, convert sats to BTC display units, call kaleidoswap_get_quote, then append <action>{"type":"swap","fromAsset":"BTC","toAsset":"USDT","amount":"0.001"}</action>.
- Receive funds: ask whether Lightning, RGB asset, or on-chain; then use wdk_create_ln_invoice, wdk_create_rgb_invoice, or wdk_get_address.
- Spark receive address: use spark_get_address when the user asks for a Spark address or wants BTC_SPARK payout.
- Send funds: append <action>{"type":"navigate","view":"withdraw"}</action>.
- Swaps: wdk_list_swaps, then wdk_get_swap(payment_hash, taker=true) for one swap's status.
- Activity: wdk_list_payments.
- Channels: wdk_list_channels with usable_only=true. Close a channel: wdk_close_channel (get channel_id and peer_pubkey from wdk_list_channels, use force=false for cooperative close).
- Networks: the RLN node and KaleidoSwap run on the same Bitcoin network (signet for testing). Spark runs on a separate network (mainnet or spark-regtest). Invoices and on-chain addresses from one network are not payable from the other — always match payment tool to the network of the invoice/address.
- Open a Lightning channel directly (peer-to-peer, you fund both sides):
  1. wdk_connect_peer with peer_pubkey_and_addr (pubkey@host:port).
  2. wdk_open_channel with capacity_sat and optional asset_id/asset_amount for RGB channels.
  3. Monitor with wdk_list_channels until status changes from Pending to Opened.
- Open a Lightning channel via LSP (LSPS1, LSP funds inbound liquidity):
  1. kaleidoswap_lsp_get_info — fetch LSP connection URL and capacity options.
  2. wdk_connect_peer with the lsp_connection_url from step 1.
  3. wdk_get_node_info — get the client pubkey.
  4. kaleidoswap_lsp_estimate_fees — estimate total fee (setup + capacity + duration).
  5. Show the fee estimate and ask for confirmation before proceeding.
  6. On confirmation: kaleidoswap_lsp_create_order — returns bolt11_invoice, onchain_address, and order_id.
  7. Pay with wdk_pay_invoice (same network as the RLN node). If it fails (no outbound channels), pay on-chain: wdk_send_btc with the onchain_address and onchain_amount_sat from the order response.
  8. Poll kaleidoswap_lsp_get_order until status is COMPLETED or FAILED.
  If dry_run=true, stop after step 5 and show what would happen.

Navigation action tags:
<action>{"type":"navigate","view":"deposit"}</action>
<action>{"type":"navigate","view":"withdraw"}</action>
<action>{"type":"navigate","view":"activity-list"}</action>
<action>{"type":"navigate","view":"agent"}</action>

BTC asset id is "BTC". Discover USDT and XAUT ids by ticker via kaleidoswap_get_assets.`

export const CHAT_TOOL_NAMES = [
  'wdk_get_node_info', 'wdk_get_balances', 'wdk_list_assets', 'wdk_get_asset_balance',
  'wdk_list_channels', 'wdk_list_payments', 'wdk_create_ln_invoice', 'wdk_create_rgb_invoice',
  'wdk_get_address', 'wdk_connect_peer', 'wdk_open_channel', 'wdk_close_channel',
  'wdk_get_channel_id', 'wdk_pay_invoice', 'wdk_send_btc',
  'spark_get_balance', 'spark_get_address', 'spark_pay_lightning_invoice',
  'kaleidoswap_get_assets', 'kaleidoswap_get_pairs', 'kaleidoswap_get_quote',
  'wdk_list_swaps', 'wdk_get_swap',
  'kaleidoswap_lsp_get_info', 'kaleidoswap_lsp_estimate_fees',
  'kaleidoswap_lsp_create_order', 'kaleidoswap_lsp_get_order',
  'l402_get_price', 'l402_get_market_data',
] as const
