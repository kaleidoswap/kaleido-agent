/**
 * AgentRunner — drives a single agent turn.
 *
 * Supports two modes:
 *   mcp   — uses McpManager tools (60+ tools from kaleido-mcp server)
 *   skill — uses SkillLoader (SKILL.md with !`kaleido` injections) + a single
 *            run_kaleido_command tool that shells out to the kaleido CLI
 */
import { McpManager } from './mcp-manager.js'
import { execFileAsync } from './utils/exec-file.js'
import { configStore } from './config-store.js'
import { createProvider } from './providers/index.js'
import type { ToolCallResult, McpToolDef } from './providers/index.js'
import {
  AGENT_SYSTEM_PROMPT,
  SKILL_TOOL_NAMES,
  buildTaskPrompt,
  buildSkillModeUserPrompt,
} from './prompts.js'
import { skillLoader } from './skill-loader.js'
import { getKaleidoApiUrl } from './runtime-paths.js'
import type { AgentMode } from './agent-config-store.js'

export type LoopType = string   // kept for backwards compat — now equals task ID

export interface AgentConfig {
  model: string
  maxTokens: number
  maxToolCallsPerRun: number
  systemPrompt: string
  dryRun: boolean
  agentMode: AgentMode
}

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  estimated_cost_usd: number
}

export interface RunResult {
  loop: string
  timestamp: string
  tool_calls: number
  final_response: string
  trace: RunTraceStep[]
  duration_ms: number
  usage: TokenUsage
}

export type RunTraceStep =
  | { type: 'thinking'; text: string }
  | { type: 'tool'; name: string; input: string; result: string; error: boolean }

// Cost per million tokens by model (USD)
const COST_PER_M: Record<string, { input: number; output: number }> = {
  'claude-opus-4-5':           { input: 15,   output: 75 },
  'claude-sonnet-4-6':         { input: 3,    output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.8,  output: 4 },
  'gpt-4o':                    { input: 2.5,  output: 10 },
  'gpt-4o-mini':               { input: 0.15, output: 0.6 },
  'o3-mini':                   { input: 1.1,  output: 4.4 },
}

/** Single tool exposed in skill mode — shells out to kaleido CLI */
const RUN_KALEIDO_TOOL: McpToolDef = {
  name: 'run_kaleido_command',
  description:
    'Execute a kaleido CLI command and return JSON output. ' +
    'Do NOT include "kaleido" or "--json" — they are added automatically. ' +
    'Examples: "wallet balance", "asset list", "channel list", ' +
    '"market quote BTC/USDT --from-amount 100000 --from-layer BTC_LN", ' +
    '"swap history --status PENDING --limit 5", ' +
    '"payment send <invoice>", "payment invoice --amount-msat 1000000", ' +
    '"node status", "node info".',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Kaleido subcommand and arguments (without "kaleido" prefix or "--json" flag)',
      },
    },
    required: ['command'],
  },
}

export class AgentRunner {
  private mcp: McpManager
  private config: AgentConfig

  constructor(mcp: McpManager, config: AgentConfig) {
    this.mcp = mcp
    this.config = config
  }

  setDryRun(dryRun: boolean): void {
    this.config.dryRun = dryRun
  }

  /**
   * Run a task turn. taskId identifies the task (e.g. "heartbeat", "rebalance", or a UUID).
   * skillName is a local or @kaleidorg/mind skill (e.g. "channel-manager").
   */
  async run(
    taskId: string,
    skillName: string,
    portfolioParams: Record<string, unknown>
  ): Promise<RunResult> {
    const mode = configStore.agentMode ?? this.config.agentMode
    if (mode === 'skill') {
      return this.runSkillMode(taskId, skillName, portfolioParams)
    }
    return this.runMcpMode(taskId, skillName, portfolioParams)
  }

  // ─── MCP mode ──────────────────────────────────────────────────────────────

  private async runMcpMode(
    taskId: string,
    skillName: string,
    portfolioParams: Record<string, unknown>
  ): Promise<RunResult> {
    const start = Date.now()
    let toolCallCount = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    const trace: RunTraceStep[] = []

    const model = configStore.model || this.config.model
    const provider = createProvider(configStore.provider)
    const { effectiveCosts, costFactor } = this.resolveCosts(model)

    const userPrompt = buildTaskPrompt(taskId, skillName, portfolioParams, this.config.dryRun)
    const messages = provider.initMessages(userPrompt)

    // Use skill-specific tool allowlist; fall back to all available MCP tools
    const allowedNames = SKILL_TOOL_NAMES[skillName]
    const tools = allowedNames
      ? this.mcp.getToolsByNames(allowedNames)
      : this.mcp.rawTools

    let finalResponse = ''
    let apiCallIndex = 0
    const deadline = Date.now() + 5 * 60 * 1000 // 5-minute wall-clock limit

    this.log(`\n${'─'.repeat(60)}`)
    this.log(`[${taskId.toUpperCase()}] mcp-mode | skill: ${skillName} | model: ${model} | dry_run: ${this.config.dryRun}`)
    this.log(`${'─'.repeat(60)}`)

    while (toolCallCount < this.config.maxToolCallsPerRun) {
      if (Date.now() > deadline) {
        this.log(`  [TIMEOUT] Turn exceeded 5-minute wall-clock limit`)
        break
      }

      apiCallIndex++
      const turn = await provider.runTurn(model, this.config.maxTokens, AGENT_SYSTEM_PROMPT, tools, messages)

      totalInputTokens += turn.usage.input_tokens
      totalOutputTokens += turn.usage.output_tokens
      const callCost = (turn.usage.input_tokens * effectiveCosts.input + turn.usage.output_tokens * effectiveCosts.output) * costFactor
      this.log(`  [api#${apiCallIndex}] tokens: in=${turn.usage.input_tokens} out=${turn.usage.output_tokens} | cost: $${callCost.toFixed(4)} | stop: ${turn.stop_reason}`)

      if (turn.text) {
        finalResponse = turn.text
        this.log(`  [model] ${turn.text.slice(0, 300)}`)
        if (turn.stop_reason !== 'end_turn' && turn.tool_calls.length > 0) {
          trace.push({ type: 'thinking', text: turn.text })
        }
      }

      if (turn.stop_reason === 'end_turn') break
      if (turn.tool_calls.length === 0) break

      provider.appendAssistant(messages, turn)

      const results: ToolCallResult[] = []
      for (const call of turn.tool_calls) {
        toolCallCount++
        this.log(`  [tool→] ${call.name}(${JSON.stringify(call.input)})`)
        let result: string
        let isError = false
        try {
          result = await this.mcp.callTool(call.name, call.input)
          this.log(`  [tool←] ${result.length > 200 ? result.slice(0, 200) + '…' : result}`)
        } catch (err) {
          result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
          this.log(`  [tool✗] ${result}`)
          isError = true
        }
        const inputSummary = JSON.stringify(call.input)
        trace.push({
          type: 'tool',
          name: call.name,
          input: inputSummary.length > 240 ? inputSummary.slice(0, 240) + '…' : inputSummary,
          result: result.length > 400 ? result.slice(0, 400) + '…' : result,
          error: isError,
        })
        results.push({ id: call.id, result })
      }
      provider.appendToolResults(messages, results)
    }

    return this.buildResult(taskId, start, toolCallCount, totalInputTokens, totalOutputTokens, effectiveCosts, costFactor, finalResponse, trace)
  }

  // ─── Skill mode ────────────────────────────────────────────────────────────

  private async runSkillMode(
    taskId: string,
    skillName: string,
    portfolioParams: Record<string, unknown>
  ): Promise<RunResult> {
    const start = Date.now()
    let toolCallCount = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    const trace: RunTraceStep[] = []

    const model = configStore.model || this.config.model
    const provider = createProvider(configStore.provider)
    const { effectiveCosts, costFactor } = this.resolveCosts(model)

    // Load skill with injected live data
    let skillContent: string
    try {
      skillContent = await skillLoader.load(skillName)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.log(`[${taskId.toUpperCase()}] skill-mode | skill load failed: ${msg}`)
      skillContent = `# Skill: ${skillName}\n(Skill file not found — proceed with available context only)`
    }

    const systemPrompt = `${AGENT_SYSTEM_PROMPT}\n\n${skillContent}`
    const userPrompt = buildSkillModeUserPrompt(taskId, portfolioParams, this.config.dryRun)
    const messages = provider.initMessages(userPrompt)
    const tools: McpToolDef[] = [RUN_KALEIDO_TOOL]

    let finalResponse = ''
    let apiCallIndex = 0
    const deadline = Date.now() + 5 * 60 * 1000 // 5-minute wall-clock limit

    this.log(`\n${'─'.repeat(60)}`)
    this.log(`[${taskId.toUpperCase()}] skill-mode | skill: ${skillName} | model: ${model} | dry_run: ${this.config.dryRun}`)
    this.log(`${'─'.repeat(60)}`)

    while (toolCallCount < this.config.maxToolCallsPerRun) {
      if (Date.now() > deadline) {
        this.log(`  [TIMEOUT] Turn exceeded 5-minute wall-clock limit`)
        break
      }

      apiCallIndex++
      const turn = await provider.runTurn(model, this.config.maxTokens, systemPrompt, tools, messages)

      totalInputTokens += turn.usage.input_tokens
      totalOutputTokens += turn.usage.output_tokens
      const callCost = (turn.usage.input_tokens * effectiveCosts.input + turn.usage.output_tokens * effectiveCosts.output) * costFactor
      this.log(`  [api#${apiCallIndex}] tokens: in=${turn.usage.input_tokens} out=${turn.usage.output_tokens} | cost: $${callCost.toFixed(4)} | stop: ${turn.stop_reason}`)

      if (turn.text) {
        finalResponse = turn.text
        this.log(`  [model] ${turn.text.slice(0, 300)}`)
        if (turn.stop_reason !== 'end_turn' && turn.tool_calls.length > 0) {
          trace.push({ type: 'thinking', text: turn.text })
        }
      }

      if (turn.stop_reason === 'end_turn') break
      if (turn.tool_calls.length === 0) break

      provider.appendAssistant(messages, turn)

      const results: ToolCallResult[] = []
      for (const call of turn.tool_calls) {
        toolCallCount++
        if (call.name !== 'run_kaleido_command') {
          trace.push({
            type: 'tool',
            name: call.name,
            input: JSON.stringify(call.input),
            result: JSON.stringify({ error: `Unknown tool in skill mode: ${call.name}` }),
            error: true,
          })
          results.push({ id: call.id, result: JSON.stringify({ error: `Unknown tool in skill mode: ${call.name}` }) })
          continue
        }
        const command = String((call.input as Record<string, unknown>).command ?? '')
        this.log(`  [kaleido→] ${command}`)
        let result: string
        let isError = false
        try {
          result = await this.execKaleidoCommand(command)
          this.log(`  [kaleido←] ${result.length > 200 ? result.slice(0, 200) + '…' : result}`)
        } catch (err) {
          result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
          this.log(`  [kaleido✗] ${result}`)
          isError = true
        }
        trace.push({
          type: 'tool',
          name: call.name,
          input: JSON.stringify(call.input),
          result: result.length > 400 ? result.slice(0, 400) + '…' : result,
          error: isError,
        })
        results.push({ id: call.id, result })
      }
      provider.appendToolResults(messages, results)
    }

    return this.buildResult(taskId, start, toolCallCount, totalInputTokens, totalOutputTokens, effectiveCosts, costFactor, finalResponse, trace)
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async execKaleidoCommand(command: string): Promise<string> {
    const bin = process.env.KALEIDO_BIN || 'kaleido'
    const nodeUrl = process.env.RLN_NODE_URL || 'http://localhost:3001'
    const apiUrl = getKaleidoApiUrl()
    // Split command string into args array — execFileAsync avoids shell injection
    const args = ['--json', ...command.split(/\s+/).filter(Boolean)]
    try {
      const { stdout } = await execFileAsync(bin, args, {
        timeout: 30_000,
        env: { ...process.env, KALEIDO_NODE_URL: nodeUrl, KALEIDO_API_URL: apiUrl },
      })
      return stdout.trim() || '(empty output)'
    } catch (err: unknown) {
      const e = err as { message?: string; stderr?: string }
      return JSON.stringify({ error: e.message ?? String(err), stderr: e.stderr?.trim() })
    }
  }

  private resolveCosts(model: string) {
    const costs = COST_PER_M[model]
    if (!costs) {
      process.stderr.write(`[agent-runner] WARNING: no cost data for model "${model}"\n`)
    }
    return {
      effectiveCosts: costs ?? { input: 0, output: 0 },
      costFactor: 1 / 1_000_000,
    }
  }

  private buildResult(
    taskId: string,
    start: number,
    toolCallCount: number,
    totalInputTokens: number,
    totalOutputTokens: number,
    effectiveCosts: { input: number; output: number },
    costFactor: number,
    finalResponse: string,
    trace: RunTraceStep[],
  ): RunResult {
    const totalCost = (totalInputTokens * effectiveCosts.input + totalOutputTokens * effectiveCosts.output) * costFactor
    const duration = Date.now() - start
    this.log(`${'─'.repeat(60)}`)
    this.log(`[${taskId.toUpperCase()}] done in ${duration}ms | tools=${toolCallCount} | tokens: in=${totalInputTokens} out=${totalOutputTokens} | cost: $${totalCost.toFixed(4)}`)
    this.log(`${'─'.repeat(60)}\n`)
    return {
      loop: taskId,
      timestamp: new Date().toISOString(),
      tool_calls: toolCallCount,
      final_response: finalResponse,
      trace,
      duration_ms: duration,
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
