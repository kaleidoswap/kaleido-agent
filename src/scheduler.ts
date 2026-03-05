/**
 * Scheduler — runs the KaleidoAgent loops on their configured intervals.
 *
 * Loops:
 *  - rebalance     : every N seconds (configurable, default 300s)
 *  - heartbeat     : every N seconds (configurable, default 300s)
 *  - daily_summary : once per day at a configurable time (default "00:00")
 */

import { AgentRunner, LoopType } from './agent-runner.js'
import { Logger } from './logger.js'

export interface SchedulerConfig {
  rebalanceIntervalSec: number
  heartbeatIntervalSec: number
  dailySummaryCron: string   // "HH:MM" in local time, e.g. "00:00"
  portfolioParams: Record<string, unknown>
}

export class Scheduler {
  private runner: AgentRunner
  private config: SchedulerConfig
  private logger: Logger
  private timers: ReturnType<typeof setInterval>[] = []
  private running = false

  constructor(runner: AgentRunner, config: SchedulerConfig, logger: Logger) {
    this.runner = runner
    this.config = config
    this.logger = logger
  }

  start(): void {
    if (this.running) return
    this.running = true

    process.stderr.write(
      `[scheduler] Starting loops — rebalance:${this.config.rebalanceIntervalSec}s ` +
      `heartbeat:${this.config.heartbeatIntervalSec}s ` +
      `daily_summary:${this.config.dailySummaryCron}\n`
    )

    // Run heartbeat immediately on startup, then on interval
    this.runLoop('heartbeat').catch(() => {})

    this.timers.push(
      setInterval(
        () => this.runLoop('rebalance').catch(() => {}),
        this.config.rebalanceIntervalSec * 1000
      )
    )

    this.timers.push(
      setInterval(
        () => this.runLoop('heartbeat').catch(() => {}),
        this.config.heartbeatIntervalSec * 1000
      )
    )

    this.scheduleDailySummary()
  }

  stop(): void {
    this.running = false
    for (const t of this.timers) clearInterval(t)
    this.timers = []
  }

  private async runLoop(loop: LoopType): Promise<void> {
    if (!this.running) return
    process.stderr.write(`[scheduler] → starting ${loop} loop\n`)
    try {
      const result = await this.runner.run(loop, this.config.portfolioParams)
      this.logger.log(result)
      process.stderr.write(
        `[scheduler] ✓ ${loop} done in ${result.duration_ms}ms (${result.tool_calls} tool calls)\n`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[scheduler] ✗ ${loop} failed: ${msg}\n`)
      this.logger.error(loop, msg)
    }
  }

  private scheduleDailySummary(): void {
    const [targetHour, targetMin] = this.config.dailySummaryCron
      .split(':')
      .map(Number)

    let lastFiredDate = ''

    const check = () => {
      const now = new Date()
      const dateKey = now.toDateString()
      if (
        now.getHours() === targetHour &&
        now.getMinutes() === targetMin &&
        dateKey !== lastFiredDate
      ) {
        lastFiredDate = dateKey
        this.runLoop('daily_summary').catch(() => {})
      }
    }

    this.timers.push(setInterval(check, 60 * 1000))
  }
}
