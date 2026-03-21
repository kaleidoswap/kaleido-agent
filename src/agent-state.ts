/**
 * AgentState — in-memory state store for the status server.
 * Tracks loop stats, recent run history, and cumulative costs.
 */

import type { RunResult, LoopType } from './agent-runner.js'

export interface LoopStats {
  runs: number
  errors: number
  last_run_at: string | null
  last_duration_ms: number | null
  last_tool_calls: number | null
  last_error: string | null
  last_response: string | null
}

export interface RecentRun {
  loop: string
  timestamp: string
  tool_calls: number
  duration_ms: number
  cost_usd: number
  response_preview: string
}

export interface AgentStatusPayload {
  running: boolean
  uptime_sec: number
  dry_run: boolean
  model: string
  provider: string
  portfolio_targets: Record<string, number>
  cumulative_cost_usd: number
  cumulative_input_tokens: number
  cumulative_output_tokens: number
  loops: Record<string, LoopStats>
  recent_runs: RecentRun[]
}

class AgentStateStore {
  private startTime = Date.now()
  private dryRun = true
  private model = ''
  private provider = 'anthropic'
  private portfolioTargets: Record<string, number> = {}
  private cumulativeCostUsd = 0
  private cumulativeInputTokens = 0
  private cumulativeOutputTokens = 0
  private running = false

  private loopStats: Record<string, LoopStats> = {
    rebalance: { runs: 0, errors: 0, last_run_at: null, last_duration_ms: null, last_tool_calls: null, last_error: null, last_response: null },
    heartbeat: { runs: 0, errors: 0, last_run_at: null, last_duration_ms: null, last_tool_calls: null, last_error: null, last_response: null },
    daily_summary: { runs: 0, errors: 0, last_run_at: null, last_duration_ms: null, last_tool_calls: null, last_error: null, last_response: null },
  }

  private recentRuns: RecentRun[] = []

  init(dryRun: boolean, model: string, portfolioTargets: Record<string, number>, provider = 'anthropic'): void {
    this.dryRun = dryRun
    this.model = model
    this.provider = provider
    this.portfolioTargets = portfolioTargets
    this.running = true
    this.startTime = Date.now()
  }

  recordRunResult(result: RunResult): void {
    const stats = this.loopStats[result.loop]
    if (stats) {
      stats.runs++
      stats.last_run_at = result.timestamp
      stats.last_duration_ms = result.duration_ms
      stats.last_tool_calls = result.tool_calls
      stats.last_error = null
      stats.last_response = result.final_response.slice(0, 800)
    }

    this.cumulativeCostUsd += result.usage.estimated_cost_usd
    this.cumulativeInputTokens += result.usage.input_tokens
    this.cumulativeOutputTokens += result.usage.output_tokens

    this.recentRuns.unshift({
      loop: result.loop,
      timestamp: result.timestamp,
      tool_calls: result.tool_calls,
      duration_ms: result.duration_ms,
      cost_usd: result.usage.estimated_cost_usd,
      response_preview: result.final_response.slice(0, 300),
    })

    if (this.recentRuns.length > 20) this.recentRuns.pop()
  }

  recordLoopError(loop: LoopType, message: string): void {
    const stats = this.loopStats[loop]
    if (stats) {
      stats.errors++
      stats.last_error = message
      stats.last_run_at = new Date().toISOString()
    }
  }

  stop(): void {
    this.running = false
  }

  getStatus(): AgentStatusPayload {
    return {
      running: this.running,
      uptime_sec: Math.floor((Date.now() - this.startTime) / 1000),
      dry_run: this.dryRun,
      model: this.model,
      provider: this.provider,
      portfolio_targets: this.portfolioTargets,
      cumulative_cost_usd: this.cumulativeCostUsd,
      cumulative_input_tokens: this.cumulativeInputTokens,
      cumulative_output_tokens: this.cumulativeOutputTokens,
      loops: this.loopStats,
      recent_runs: this.recentRuns,
    }
  }
}

export const agentState = new AgentStateStore()
