/**
 * ChatRunner — powers the interactive wallet assistant chat.
 *
 * Runs a single agentic turn using Anthropic + all connected MCP tools
 * (wdk-wallet-mcp, kaleidoswap-mcp), then returns a structured response
 * the rate-extension can render.
 *
 * Unlike the scheduled loops in AgentRunner, this is request/response:
 * the caller provides the full message history and gets back { text, action }.
 */

import { McpManager } from './mcp-manager.js'
import { createProvider } from './providers/index.js'
import { configStore } from './config-store.js'
import type { ToolCallResult } from './providers/index.js'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatAction {
  type: 'swap' | 'navigate' | 'none'
  fromAsset?: string
  toAsset?: string
  amount?: string
  view?: string
}

export interface ToolCallTrace {
  name: string
  input: string   // compact JSON summary
  result: string  // first 200 chars of result
  error: boolean
}

export interface ChatResponse {
  text: string
  action: ChatAction
  tool_calls: ToolCallTrace[]
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const CHAT_SYSTEM_PROMPT = `You are an AI assistant embedded in Rate, a Bitcoin Lightning wallet with RGB asset support (USDT, XAUT on Lightning).

You have live access to the user's wallet via MCP tools. Always use tools to get real data.

## Available tools (use them freely)
- wdk_get_node_info — node status and pubkey
- wdk_get_balances — BTC Lightning balance in sats
- wdk_list_assets — all RGB assets with their IDs and tickers
- wdk_get_asset_balance — balance for a specific RGB asset (requires asset_id)
- wdk_list_channels — Lightning channels and liquidity (usable_only=true for active only)
- wdk_list_payments — recent Lightning payment history
- wdk_create_ln_invoice — create a Lightning invoice { amount_msat }
- wdk_create_rgb_invoice — create an RGB asset invoice { asset_id }
- wdk_get_address — get an on-chain Bitcoin address
- kaleidoswap_get_assets — all tradeable assets on KaleidoSwap (with precisions)
- kaleidoswap_get_pairs — all available trading pairs
- kaleidoswap_get_quote — get a swap quote + live exchange rate
- kaleidoswap_get_open_orders — check active/pending orders
- kaleidoswap_get_position — session trading stats (PnL, volume)

## Price discovery (no external oracle needed)
KaleidoSwap quotes ARE the price feed. To get the BTC/USDT rate:
→ call kaleidoswap_get_assets to get USDT asset_id
→ call kaleidoswap_get_quote(from_asset_id="BTC", from_layer="BTC_LN", from_amount=0.001, to_asset_id=<USDT_ID>, to_layer="RGB_LN")
  NOTE: from_amount is in BTC (display units) — 0.001 BTC = 100,000 sats
→ btc_price_usdt = to_asset.amount_display / 0.001  (e.g. if 65.0 USDT returned, price = $65,000/BTC)

## SWAP MINIMUM AMOUNTS — CHECK BEFORE ANY TOOL CALL

These are hard API limits. Before calling any tool for a swap/quote request, compare the requested amount:

| Pair      | Minimum        |
|-----------|----------------|
| BTC→USDT  | 100,000 sats   |
| BTC→XAUT  | 500,000 sats   |
| XAUT→USDT | 500,000 (raw)  |

If the requested amount is BELOW the minimum, respond IMMEDIATELY without calling any tools:
"The minimum swap for BTC→XAUT is 500,000 sats (≈0.005 BTC). You requested X sats which is below this limit."
(Adjust pair name and minimum accordingly.)

DO NOT say "technical issue", DO NOT call tools, DO NOT suggest trying anyway.

---

## How to handle common requests

**"show my balance" / "what do I have?"**
→ call wdk_get_balances (BTC sats), then wdk_list_assets, then wdk_get_asset_balance for each RGB asset
→ derive BTC/USDT rate via kaleidoswap_get_quote to show USD value
→ summarise concisely

**"what's the BTC price?" / "what's USDT worth?"**
→ call kaleidoswap_get_assets (get USDT ID)
→ call kaleidoswap_get_quote(from_asset_id="BTC", from_layer="BTC_LN", from_amount=0.001, to_asset_id=<USDT_ID>, to_layer="RGB_LN")
→ btc_price = to_asset.amount_display / 0.001

**"swap X sats to USDT/XAUT" / "quote X sats" / "how much XAUT for Y sats?"**
→ FIRST: check the minimum table above. If amount < min, reply with the minimum message (no tools).
→ Convert user's sats to BTC display: btc_display = sats / 100_000_000
  Examples: 500,000 sats → from_amount=0.005 | 1,000,000 sats → from_amount=0.01
→ Call kaleidoswap_get_assets to get the correct to_asset_id (by ticker)
→ call kaleidoswap_get_quote:
  - BTC→USDT: from_asset_id="BTC", from_layer="BTC_LN", from_amount=<btc_display>, to_asset_id=<USDT_ID>, to_layer="RGB_LN"
  - BTC→XAUT: from_asset_id="BTC", from_layer="BTC_LN", from_amount=<btc_display>, to_asset_id=<XAUT_ID>, to_layer="RGB_LN"
  - USDT→BTC: from_asset_id=<USDT_ID>, from_layer="RGB_LN", from_amount=<usdt_display>, to_asset_id="BTC", to_layer="BTC_LN"
→ present the quote (input/output amounts, rate)
→ add action block so the user can open the swap screen

**"receive funds" / "get invoice" / "create invoice"**
→ ask if they want LN sats or RGB asset
→ for LN: wdk_create_ln_invoice; for RGB: wdk_create_rgb_invoice; for on-chain: wdk_get_address

**"send / pay"**
→ navigate to withdraw screen

**"show my orders" / "pending swaps"**
→ call kaleidoswap_get_open_orders

**"show my transaction history" / "recent payments"**
→ call wdk_list_payments

**"show my channels" / "my liquidity"**
→ call wdk_list_channels(usable_only=true)

## Response rules
1. Use tools FIRST, then answer with real data
2. Be concise — 1–3 sentences max. You are in a compact popup UI
3. Format numbers clearly: "0.001 BTC", "100 USDT", "$95,000 / BTC"
4. NEVER execute swaps or sends automatically — always return an action chip
5. If the user's request requires a swap, quote it first, then append:
   <action>{"type":"swap","fromAsset":"BTC","toAsset":"USDT","amount":"0.001"}</action>
6. For navigation:
   <action>{"type":"navigate","view":"deposit"}</action>
   <action>{"type":"navigate","view":"withdraw"}</action>
   <action>{"type":"navigate","view":"activity-list"}</action>
   <action>{"type":"navigate","view":"agent"}</action>
7. Asset layers: BTC Lightning → from_layer="BTC_LN", RGB Lightning → from_layer="RGB_LN" / to_layer="RGB_LN"
8. Asset IDs: BTC is "BTC"; for USDT/XAUT always discover via kaleidoswap_get_assets by ticker
9. ERROR HANDLING (critical): If any tool returns a JSON with "error_code", "error", or "message" field:
   - Report the EXACT error message verbatim to the user — never invent a different explanation
   - Example: {"error_code":"VALIDATION_ERROR","message":"amount must be between 500000 and 1000000000"} → tell user "The minimum swap amount for this pair is 500,000 sats (≈0.005 BTC)"
   - Example: {"error":"connection refused"} → tell user "The node is currently unreachable"
   - NEVER say "there's an issue with the BTC asset ID" if the real error is something else`

// ---------------------------------------------------------------------------
// Action parser (same format as wallet-ai.ts in the extension)
// ---------------------------------------------------------------------------

const ACTION_RE = /<action>([\s\S]*?)<\/action>/

function parseAction(text: string): { cleanText: string; action: ChatAction } {
  const match = text.match(ACTION_RE)
  if (!match) return { cleanText: text.trim(), action: { type: 'none' } }

  const cleanText = text.replace(ACTION_RE, '').trim()
  try {
    const raw = JSON.parse(match[1].trim())
    if (raw.type === 'swap' && raw.fromAsset && raw.toAsset) {
      return {
        cleanText,
        action: {
          type: 'swap',
          fromAsset: String(raw.fromAsset).toUpperCase(),
          toAsset: String(raw.toAsset).toUpperCase(),
          amount: raw.amount ? String(raw.amount) : '',
        },
      }
    }
    if (raw.type === 'navigate' && raw.view) {
      return { cleanText, action: { type: 'navigate', view: String(raw.view) } }
    }
  } catch {
    // malformed action JSON — ignore
  }
  return { cleanText, action: { type: 'none' } }
}

// ---------------------------------------------------------------------------
// ChatRunner
// ---------------------------------------------------------------------------

const MAX_TOOL_CALLS = 10

export class ChatRunner {
  private mcp: McpManager
  private model: string

  constructor(mcp: McpManager, model = 'claude-haiku-4-5-20251001') {
    this.mcp = mcp
    this.model = model
  }

  async chat(history: ChatMessage[]): Promise<ChatResponse> {
    const provider = createProvider(configStore.provider)
    const model = configStore.model || this.model

    const messages = provider.initMessages('')
    // Replace initMessages result with real history
    messages.length = 0
    for (const m of history) {
      messages.push({ role: m.role, content: m.content })
    }

    let toolCallCount = 0
    let finalText = ''
    const toolTrace: ToolCallTrace[] = []

    // Agentic loop
    while (toolCallCount < MAX_TOOL_CALLS) {
      const turn = await provider.runTurn(
        model,
        512,
        CHAT_SYSTEM_PROMPT,
        this.mcp.rawTools,
        messages
      )

      if (turn.text) {
        finalText = turn.text
      }

      if (turn.stop_reason === 'end_turn') break
      if (turn.tool_calls.length === 0) break

      provider.appendAssistant(messages, turn)

      const results: ToolCallResult[] = []
      for (const call of turn.tool_calls) {
        toolCallCount++
        let result: string
        let isError = false
        try {
          result = await this.mcp.callTool(call.name, call.input)
          // Detect API-level errors in the result JSON
          try {
            const parsed = JSON.parse(result)
            if (parsed?.error_code || parsed?.error) isError = true
          } catch { /* not JSON */ }
        } catch (err) {
          result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
          isError = true
        }

        // Record trace entry
        const inputSummary = JSON.stringify(call.input)
        toolTrace.push({
          name: call.name,
          input: inputSummary.length > 120 ? inputSummary.slice(0, 120) + '…' : inputSummary,
          result: result.length > 200 ? result.slice(0, 200) + '…' : result,
          error: isError,
        })

        results.push({ id: call.id, result })
      }

      provider.appendToolResults(messages, results)
    }

    const { cleanText, action } = parseAction(finalText)
    return { text: cleanText || 'Done.', action, tool_calls: toolTrace }
  }
}
