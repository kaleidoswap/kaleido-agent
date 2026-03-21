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
import { CHAT_SYSTEM_PROMPT, CHAT_TOOL_NAMES } from './prompts.js'

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
    const tools = typeof this.mcp.getToolsByNames === 'function'
      ? this.mcp.getToolsByNames(CHAT_TOOL_NAMES)
      : this.mcp.rawTools
    const recentHistory = history.slice(-8)

    const messages = provider.initMessages('')
    // Replace initMessages result with real history
    messages.length = 0
    for (const m of recentHistory) {
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
        tools,
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
