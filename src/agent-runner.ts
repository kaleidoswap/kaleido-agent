/**
 * AgentRunner — drives a single agent turn using Claude + MCP tools.
 * Implements the standard agentic loop: send message → collect tool calls
 * → execute tools → send results → repeat until stop_reason = "end_turn".
 */

import Anthropic from '@anthropic-ai/sdk'
import { McpManager } from './mcp-manager.js'

export type LoopType = 'rebalance' | 'heartbeat' | 'daily_summary'

export interface AgentConfig {
  model: string
  maxTokens: number
  maxToolCallsPerRun: number
  systemPrompt: string
  dryRun: boolean
}

export interface RunResult {
  loop: LoopType
  timestamp: string
  tool_calls: number
  final_response: string
  duration_ms: number
}

export class AgentRunner {
  private anthropic: Anthropic
  private mcp: McpManager
  private config: AgentConfig

  constructor(mcp: McpManager, config: AgentConfig) {
    this.anthropic = new Anthropic()
    this.mcp = mcp
    this.config = config
  }

  async run(loop: LoopType, portfolioParams: Record<string, unknown>): Promise<RunResult> {
    const start = Date.now()
    let toolCallCount = 0

    const userPrompt = this.buildPrompt(loop, portfolioParams)
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: userPrompt },
    ]

    let finalResponse = ''

    // Agentic loop
    while (toolCallCount < this.config.maxToolCallsPerRun) {
      const response = await this.anthropic.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: this.config.systemPrompt,
        tools: this.mcp.tools,
        messages,
      })

      // Collect any text responses
      const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text')
      if (textBlocks.length > 0) {
        finalResponse = textBlocks.map((b) => b.text).join('\n')
      }

      if (response.stop_reason === 'end_turn') break

      // Process tool use blocks
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      )
      if (toolUseBlocks.length === 0) break

      // Add assistant message with all blocks
      messages.push({ role: 'assistant', content: response.content })

      // Execute each tool call and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of toolUseBlocks) {
        toolCallCount++
        process.stderr.write(`[agent] tool_use: ${block.name} (${JSON.stringify(block.input)})\n`)

        let result: string
        try {
          result = await this.mcp.callTool(block.name, block.input as Record<string, unknown>)
        } catch (err) {
          result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        })
      }

      messages.push({ role: 'user', content: toolResults })
    }

    return {
      loop,
      timestamp: new Date().toISOString(),
      tool_calls: toolCallCount,
      final_response: finalResponse,
      duration_ms: Date.now() - start,
    }
  }

  private buildPrompt(loop: LoopType, params: Record<string, unknown>): string {
    const baseContext = `
Current time: ${new Date().toISOString()}
Portfolio parameters: ${JSON.stringify(params, null, 2)}
dry_run: ${this.config.dryRun}
`.trim()

    const prompts: Record<LoopType, string> = {
      rebalance: `${baseContext}

Execute the **portfolio rebalance loop**:

1. Call wdk_get_node_info — abort if node is unreachable
2. Call wdk_get_balances — get BTC Lightning balance (lightning_balance_sat)
3. Call wdk_list_assets — discover RGB asset IDs (resolve USDT and XAUT by ticker)
4. Call wdk_get_asset_balance for each RGB asset (USDT, XAUT if configured)
5. Call l402_get_price for BTC and XAUT (if XAUT asset_id is non-empty)
6. Calculate USD value of each holding:
   - BTC_usd  = (lightning_balance_sat / 1e8) * btc_price
   - USDT_usd = usdt_settled + usdt_offchain_inbound
   - XAUT_usd = xaut_amount * xaut_price  (skip if not configured)
   - total_usd = BTC_usd + USDT_usd + XAUT_usd
7. Calculate current allocation percentages vs targets from portfolio.targets
8. If max drift across assets <= rebalance_threshold_pct: skip and report "balanced"
9. If dry_run=true: describe what swap you would execute but do NOT place orders
10. If dry_run=false AND drift > threshold:
    a. Check kaleidoswap_get_open_orders — skip if at max_concurrent_orders
    b. Identify most over-allocated asset and most under-allocated asset
    c. Calculate swap amount in USD (capped at max_swap_usd; respect min_btc_reserve_sats)
    d. Select swap method based on portfolio.trading_mode:
       - "atomic"  → use Atomic Swap Flow (5 steps below)
       - "rest"    → use REST Order Flow (deposit-based)
       - "both"    → try atomic first; if channel outbound < min_outbound_liquidity_sat, fall back to REST
    e. CHANNEL LIQUIDITY CHECK (for "atomic" and "both" modes):
       - Call wdk_list_channels to get total_outbound_msat
       - If total_outbound_msat / 1000 < portfolio.lsp.min_outbound_liquidity_sat:
         * If portfolio.lsp.auto_buy_channel=true: run Channel Purchase Flow (below)
         * If portfolio.lsp.auto_buy_channel=false: log warning, fall back to REST if mode="both", else skip
    f. ATOMIC SWAP FLOW (trading_mode="atomic" or "both"):
       - kaleidoswap_get_quote (from_asset_id, to_asset_id, from_layer, to_layer, from_amount)
         → rfq_id, from_asset.amount_raw, to_asset.amount_raw
       - kaleidoswap_atomic_init (rfq_id, from_asset_id, from_amount_raw, to_asset_id, to_amount_raw)
         → swapstring, payment_hash
       - wdk_atomic_taker (swapstring)
         → HTLC whitelisted on node
       - wdk_get_node_info → taker_pubkey (node pubkey)
       - kaleidoswap_atomic_execute (swapstring, taker_pubkey, payment_hash)
       - kaleidoswap_atomic_status (payment_hash) — poll until Succeeded, Failed, or Expired
    g. REST ORDER FLOW (trading_mode="rest" or fallback):
       For BTC→USDT:
       - wdk_create_rgb_invoice (asset_id=USDT asset_id)
       - kaleidoswap_place_order (from=BTC/BTC_LN, to=USDT/RGB_LN, receiver_address=invoice)
       - wdk_pay_invoice (invoice=deposit_address.address)
       For USDT→BTC:
       - wdk_create_ln_invoice (amount_msat = swap_amount_sats * 1000)
       - kaleidoswap_place_order (from=USDT/RGB_LN, to=BTC/BTC_LN, receiver_address=ln_invoice, receiver_address_format=BOLT11)
       - wdk_send_asset (asset_id=USDT, recipient_id=deposit_address.address, amount=swap_usdt)
       - kaleidoswap_get_order_status — poll until FILLED or FAILED
    h. wdk_refresh_transfers — sync balances after any swap
    i. CHANNEL PURCHASE FLOW (only when auto_buy_channel=true and liquidity low):
       - wdk_get_node_info → client_pubkey
       - kaleidoswap_lsp_estimate_fees (client_pubkey, lsp_balance_sat, client_balance_sat, channel_expiry_blocks)
       - kaleidoswap_lsp_create_order (all lsp config params) → order_id, bolt11_invoice, order_total_sat
       - wdk_pay_invoice (invoice=bolt11_invoice)
       - kaleidoswap_lsp_get_order (order_id) — poll until CHANNEL_OPENING or COMPLETED
11. Return a JSON summary with allocation before/after and any orders placed`,

      heartbeat: `${baseContext}

Execute the **heartbeat check loop**:
1. Call wdk_get_node_info — confirm the RLN node is online
2. Call wdk_list_channels with usable_only=true — summarize active liquidity
3. Call wdk_refresh_transfers — flush any pending RGB transfers
4. Call kaleidoswap_get_open_orders — check for stuck/expired orders
5. Return a JSON health report with node status, channel count, liquidity summary, and any alerts`,

      daily_summary: `${baseContext}

Generate the **daily portfolio summary**:
1. Call wdk_get_balances — BTC on-chain + Lightning balance
2. Call wdk_list_assets — all RGB assets
3. Call wdk_get_asset_balance for each asset
4. Call l402_get_price for BTC, USDT, XAUT
5. Call l402_get_ohlcv for BTC (days=1)
6. Call kaleidoswap_get_position — session trade stats
7. Calculate total portfolio USD value and current allocation percentages
8. Return a comprehensive JSON daily report including balances, prices, allocation, and trade history`,
    }

    return prompts[loop]
  }
}
