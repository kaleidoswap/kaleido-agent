import type { LoopType } from './agent-runner.js'

export const AGENT_SYSTEM_PROMPT = [
  'You are KaleidoAgent, an autonomous wallet operator for BTC, USDT, and XAUT on Lightning.',
  'Use only the provided tools and returned values. Never invent asset ids, invoices, pubkeys, quotes, or order states.',
  'Prefer concise structured JSON outputs.',
  'If dry_run=true, do not place orders, pay invoices, open channels, or execute swaps. Return the intended action instead.',
  'If a tool fails, surface the exact error and continue only when the workflow is still safe.',
].join(' ')

export const AGENT_TOOL_NAMES: Record<LoopType, string[]> = {
  rebalance: [
    'wdk_get_node_info',
    'wdk_get_balances',
    'wdk_list_assets',
    'wdk_get_asset_balance',
    'wdk_list_channels',
    'wdk_atomic_taker',
    'wdk_create_rgb_invoice',
    'wdk_create_ln_invoice',
    'wdk_pay_invoice',
    'wdk_send_asset',
    'wdk_refresh_transfers',
    'kaleidoswap_get_quote',
    'kaleidoswap_get_open_orders',
    'kaleidoswap_atomic_init',
    'kaleidoswap_atomic_execute',
    'kaleidoswap_atomic_status',
    'kaleidoswap_place_order',
    'kaleidoswap_get_order_status',
    'kaleidoswap_lsp_estimate_fees',
    'kaleidoswap_lsp_create_order',
    'kaleidoswap_lsp_get_order',
  ],
  heartbeat: [
    'wdk_get_node_info',
    'wdk_list_channels',
    'wdk_refresh_transfers',
    'wdk_connect_peer',
    'wdk_pay_invoice',
    'kaleidoswap_get_open_orders',
    'kaleidoswap_lsp_get_info',
    'kaleidoswap_lsp_estimate_fees',
    'kaleidoswap_lsp_create_order',
    'kaleidoswap_lsp_get_order',
  ],
  daily_summary: [
    'wdk_get_balances',
    'wdk_list_assets',
    'wdk_get_asset_balance',
    'kaleidoswap_get_quote',
    'kaleidoswap_get_position',
  ],
}

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
- Balances: wdk_get_balances, wdk_list_assets, wdk_get_asset_balance.
- BTC price / BTC quote in USDT: kaleidoswap_get_assets, then kaleidoswap_get_quote with BTC_LN -> RGB_LN.
- Swap quote: discover asset ids via kaleidoswap_get_assets, convert sats to BTC display units, call kaleidoswap_get_quote, then append <action>{"type":"swap","fromAsset":"BTC","toAsset":"USDT","amount":"0.001"}</action>.
- Receive funds: ask whether Lightning, RGB asset, or on-chain; then use wdk_create_ln_invoice, wdk_create_rgb_invoice, or wdk_get_address.
- Send funds: append <action>{"type":"navigate","view":"withdraw"}</action>.
- Orders: kaleidoswap_get_open_orders.
- Activity: wdk_list_payments.
- Channels: wdk_list_channels with usable_only=true.

Navigation action tags:
<action>{"type":"navigate","view":"deposit"}</action>
<action>{"type":"navigate","view":"withdraw"}</action>
<action>{"type":"navigate","view":"activity-list"}</action>
<action>{"type":"navigate","view":"agent"}</action>

BTC asset id is "BTC". Discover USDT and XAUT ids by ticker via kaleidoswap_get_assets.`

export const CHAT_TOOL_NAMES = [
  'wdk_get_node_info',
  'wdk_get_balances',
  'wdk_list_assets',
  'wdk_get_asset_balance',
  'wdk_list_channels',
  'wdk_list_payments',
  'wdk_create_ln_invoice',
  'wdk_create_rgb_invoice',
  'wdk_get_address',
  'kaleidoswap_get_assets',
  'kaleidoswap_get_pairs',
  'kaleidoswap_get_quote',
  'kaleidoswap_get_open_orders',
  'kaleidoswap_get_position',
] as const

export function buildLoopPrompt(
  loop: LoopType,
  params: Record<string, unknown>,
  dryRun: boolean
): string {
  const context = [
    `Current time: ${new Date().toISOString()}`,
    `dry_run: ${dryRun}`,
    `Portfolio parameters: ${JSON.stringify(params)}`,
  ].join('\n')

  switch (loop) {
    case 'rebalance':
      return `${context}

Execute the rebalance loop.
- Task: rebalance the portfolio to its configured targets.
- Verify the node is reachable with wdk_get_node_info.
- Load wallet holdings with wdk_get_balances, wdk_list_assets, and wdk_get_asset_balance for configured RGB assets.
- Price BTC in USDT with kaleidoswap_get_quote using 0.001 BTC; price XAUT in USDT with 1 XAUT if XAUT is configured.
- Compute current allocation, drift vs targets, and total portfolio value in USDT terms.
- If max drift is within rebalance_threshold_pct, return status="balanced".
- If dry_run=true, return the proposed trade only.
- If live, enforce max_concurrent_orders, max_swap_usd, min_btc_reserve_sats, trading_mode, and lsp settings from portfolio.
- Atomic path: get_quote -> atomic_init -> wdk_atomic_taker -> wdk_get_node_info -> atomic_execute -> atomic_status.
- REST path: place_order plus the required wallet invoice/payment/send step depending on direction.
- If outbound liquidity is below lsp.min_outbound_liquidity_sat and auto_buy_channel=true, estimate fees, create the LSP order, pay it, and confirm order status.
- After live actions, refresh wallet transfers.
Return strict JSON with status, balances, prices, allocation_before, drift_pct, and planned_or_executed_actions.`

    case 'heartbeat':
      return `${context}

Execute the heartbeat check loop.
- Task: run a health and liquidity check.
- Confirm node health with wdk_get_node_info.
- Inspect usable channel liquidity with wdk_list_channels.
- Refresh transfers and inspect open orders.
- If outbound liquidity is below lsp.min_outbound_liquidity_sat:
  - If auto_buy_channel=false, report the shortage.
  - If auto_buy_channel=true, get LSP info, connect to the peer if needed, estimate fees, and either report the planned purchase in dry run or create/pay/confirm the LSP order in live mode.
Return strict JSON with node status, channel count, outbound_sat, open_orders, and any channel action.`

    case 'daily_summary':
      return `${context}

Generate the daily portfolio summary.
- Load BTC balances, RGB asset balances, and relevant quotes.
- Price BTC in USDT with kaleidoswap_get_quote using 0.001 BTC; price XAUT in USDT with 1 XAUT if configured.
- Load session trading stats with kaleidoswap_get_position.
- Compute total portfolio value and current allocation.
Return strict JSON with balances, prices, allocation, and trade stats.`
  }
}
