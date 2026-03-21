/**
 * AgentRunner — drives a single agent turn using the configured AI provider + MCP tools.
 * Provider and model are read from configStore on each run, so live config changes apply.
 */
import { McpManager } from './mcp-manager.js'
import { configStore } from './config-store.js'
import { createProvider } from './providers/index.js'
import type { ToolCallResult } from './providers/index.js'

export type LoopType = 'rebalance' | 'heartbeat' | 'daily_summary'

export interface AgentConfig {
  model: string
  maxTokens: number
  maxToolCallsPerRun: number
  systemPrompt: string
  dryRun: boolean
}

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  estimated_cost_usd: number
}

export interface RunResult {
  loop: LoopType
  timestamp: string
  tool_calls: number
  final_response: string
  duration_ms: number
  usage: TokenUsage
}

// Cost per million tokens by model (USD)
const COST_PER_M: Record<string, { input: number; output: number }> = {
  'claude-opus-4-5':           { input: 15,   output: 75 },
  'claude-sonnet-4-6':         { input: 3,    output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.8,  output: 4 },
  'gpt-4o':                    { input: 2.5,  output: 10 },
  'gpt-4o-mini':               { input: 0.15, output: 0.6 },
  'o3-mini':                   { input: 1.1,  output: 4.4 },
}

export class AgentRunner {
  private mcp: McpManager
  private config: AgentConfig

  constructor(mcp: McpManager, config: AgentConfig) {
    this.mcp = mcp
    this.config = config
  }

  async run(loop: LoopType, portfolioParams: Record<string, unknown>): Promise<RunResult> {
    const start = Date.now()
    let toolCallCount = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0

    // Read live config — provider/model may have changed since constructor
    const model = configStore.model || this.config.model
    const provider = createProvider(configStore.provider)
    const costs = COST_PER_M[model] ?? { input: 0, output: 0 }
    const costFactor = 1 / 1_000_000

    const userPrompt = this.buildPrompt(loop, portfolioParams)
    const messages = provider.initMessages(userPrompt)

    let finalResponse = ''
    let apiCallIndex = 0

    this.log(`\n${'─'.repeat(60)}`)
    this.log(`[${loop.toUpperCase()}] starting — provider: ${configStore.provider} | model: ${model} | dry_run: ${this.config.dryRun}`)
    this.log(`${'─'.repeat(60)}`)

    while (toolCallCount < this.config.maxToolCallsPerRun) {
      apiCallIndex++
      const turn = await provider.runTurn(
        model,
        this.config.maxTokens,
        this.config.systemPrompt,
        this.mcp.rawTools,
        messages
      )

      totalInputTokens += turn.usage.input_tokens
      totalOutputTokens += turn.usage.output_tokens
      const callCost = (turn.usage.input_tokens * costs.input + turn.usage.output_tokens * costs.output) * costFactor
      this.log(
        `  [api#${apiCallIndex}] tokens: in=${turn.usage.input_tokens} out=${turn.usage.output_tokens}` +
        ` | cost: $${callCost.toFixed(4)} | stop: ${turn.stop_reason}`
      )

      if (turn.text) {
        finalResponse = turn.text
        this.log(`  [model] ${turn.text}`)
      }

      if (turn.stop_reason === 'end_turn') break
      if (turn.tool_calls.length === 0) break

      provider.appendAssistant(messages, turn)

      const results: ToolCallResult[] = []
      for (const call of turn.tool_calls) {
        toolCallCount++
        this.log(`  [tool→] ${call.name}(${JSON.stringify(call.input)})`)
        let result: string
        try {
          result = await this.mcp.callTool(call.name, call.input)
          const preview = result.length > 200 ? result.slice(0, 200) + '…' : result
          this.log(`  [tool←] ${preview}`)
        } catch (err) {
          result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
          this.log(`  [tool✗] ${result}`)
        }
        results.push({ id: call.id, result })
      }

      provider.appendToolResults(messages, results)
    }

    const totalCost = (totalInputTokens * costs.input + totalOutputTokens * costs.output) * costFactor
    this.log(`${'─'.repeat(60)}`)
    this.log(
      `[${loop.toUpperCase()}] done in ${Date.now() - start}ms | ` +
      `tools=${toolCallCount} | tokens: in=${totalInputTokens} out=${totalOutputTokens} | ` +
      `total cost: $${totalCost.toFixed(4)}`
    )
    this.log(`${'─'.repeat(60)}\n`)

    return {
      loop,
      timestamp: new Date().toISOString(),
      tool_calls: toolCallCount,
      final_response: finalResponse,
      duration_ms: Date.now() - start,
      usage: {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        estimated_cost_usd: totalCost,
      },
    }
  }

  private log(msg: string): void {
    process.stderr.write(msg + '\n')
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
5. Derive rates via kaleidoswap_get_quote (KaleidoSwap IS the price oracle — no external feed needed):
   - BTC/USDT rate: kaleidoswap_get_quote(from_asset_id="BTC", from_layer="BTC_LN", from_amount=0.001, to_asset_id=<USDT_ID>, to_layer="RGB_LN")
     NOTE: from_amount is BTC display units (0.001 = 100,000 sats)
     → btc_price_usdt = to_asset.amount_display / 0.001
   - XAUT/USDT rate (if XAUT configured): kaleidoswap_get_quote(from_asset_id=<XAUT_ID>, from_layer="RGB_LN", from_amount=1.0, to_asset_id=<USDT_ID>, to_layer="RGB_LN")
     → xaut_price_usdt = to_asset.amount_display / 1.0
6. Calculate USDT value of each holding:
   - BTC_usdt  = (lightning_balance_sat / 1e8) * btc_price_usdt
   - USDT_usdt = (usdt_settled + usdt_offchain_inbound) / 10^usdt_precision
   - XAUT_usdt = (xaut_amount / 10^xaut_precision) * xaut_price_usdt  (skip if not configured)
   - total_usdt = BTC_usdt + USDT_usdt + XAUT_usdt
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
1. Call wdk_get_node_info — confirm the RLN node is online, capture client_pubkey
2. Call wdk_list_channels with usable_only=true — sum total_outbound_msat across all channels
3. Call wdk_refresh_transfers — flush any pending RGB transfers
4. Call kaleidoswap_get_open_orders — check for stuck/expired orders
5. LIQUIDITY GUARD — check if total_outbound_msat/1000 < lsp.min_outbound_liquidity_sat (from Portfolio parameters above):
   YES and lsp.auto_buy_channel=true:
     a. kaleidoswap_lsp_get_info → lsp_connection_url (format: pubkey@host:port)
     b. wdk_connect_peer (lsp_connection_url) — connect to maker node if not already peered
     c. kaleidoswap_lsp_estimate_fees (client_pubkey, lsp_balance_sat, client_balance_sat, channel_expiry_blocks — all from lsp config above)
     d. If dry_run=true: log "Would buy channel, fee=X sats" and STOP here
     e. kaleidoswap_lsp_create_order (client_pubkey, lsp_balance_sat, client_balance_sat, required_channel_confirmations=0, funding_confirms_within_blocks=6, channel_expiry_blocks, announce_channel=false — all from lsp config)
        → order_id, bolt11_invoice, order_total_sat
     f. wdk_pay_invoice (bolt11_invoice) — pay the LSP fee
     g. kaleidoswap_lsp_get_order (order_id) — confirm order_state is CHANNEL_OPENING or COMPLETED
   NO or auto_buy_channel=false: log current liquidity, no action needed
6. Return a structured health report: node status, channel count, outbound_sat, open orders, and channel-buy action if taken`,

      daily_summary: `${baseContext}

Generate the **daily portfolio summary**:
1. Call wdk_get_balances — BTC on-chain + Lightning balance
2. Call wdk_list_assets — all RGB assets
3. Call wdk_get_asset_balance for each asset
4. Derive live rates via kaleidoswap_get_quote (no external oracle needed):
   - BTC/USDT: kaleidoswap_get_quote(from_asset_id="BTC", from_layer="BTC_LN", from_amount=0.001, to_asset_id=<USDT_ID>, to_layer="RGB_LN")
     NOTE: from_amount is BTC display units (0.001 = 100,000 sats)
     → btc_price_usdt = to_asset.amount_display / 0.001
   - XAUT/USDT (if configured): kaleidoswap_get_quote(from_asset_id=<XAUT_ID>, from_layer="RGB_LN", from_amount=1.0, to_asset_id=<USDT_ID>, to_layer="RGB_LN")
     NOTE: from_amount=1.0 = 1 XAUT display unit
5. Call kaleidoswap_get_position — session trade stats (PnL, volume, order count)
6. Calculate total portfolio USDT value and current allocation percentages
7. Return a comprehensive JSON daily report including balances, rates, allocation, and trade history`,
    }

    return prompts[loop]
  }
}
