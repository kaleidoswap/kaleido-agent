/**
 * AgentRunner — drives a single agent turn using the configured AI provider + MCP tools.
 * Provider and model are read from configStore on each run, so live config changes apply.
 */
import { McpManager } from './mcp-manager.js'
import { configStore } from './config-store.js'
import { createProvider } from './providers/index.js'
import type { ToolCallResult } from './providers/index.js'
import { AGENT_SYSTEM_PROMPT, AGENT_TOOL_NAMES, buildLoopPrompt } from './prompts.js'

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

    const userPrompt = buildLoopPrompt(loop, portfolioParams, this.config.dryRun)
    const messages = provider.initMessages(userPrompt)
    const tools = typeof this.mcp.getToolsByNames === 'function'
      ? this.mcp.getToolsByNames(AGENT_TOOL_NAMES[loop])
      : this.mcp.rawTools

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
        AGENT_SYSTEM_PROMPT,
        tools,
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
}
