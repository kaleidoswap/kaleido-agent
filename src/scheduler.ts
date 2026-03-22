/**
 * Scheduler — task-driven autonomous loop runner for KaleidoAgent.
 *
 * Loads all enabled tasks from tasks.json and creates one interval timer per task.
 * Tasks with run_on_startup=true also fire once 5 seconds after start().
 *
 * Tasks can be triggered manually via trigger(taskId) from the HTTP API.
 * Concurrent runs of the same task are silently skipped.
 */

import type { AgentRunner } from './agent-runner.js'
import { Logger } from './logger.js'
import { agentState } from './agent-state.js'
import { tasksStore } from './tasks-store.js'

export class Scheduler {
  private runner: Pick<AgentRunner, 'run' | 'setDryRun'>
  private logger: Logger
  private portfolioParams: Record<string, unknown>
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map()
  private startupTimeouts: ReturnType<typeof setTimeout>[] = []
  private running = false
  private activeTasks = new Set<string>()

  constructor(
    runner: Pick<AgentRunner, 'run' | 'setDryRun'>,
    logger: Logger,
    portfolioParams: Record<string, unknown>,
  ) {
    this.runner = runner
    this.logger = logger
    this.portfolioParams = portfolioParams
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    await this.loadTimers()
  }

  async reload(): Promise<void> {
    if (!this.running) return
    for (const t of this.timers.values()) clearInterval(t)
    this.timers.clear()
    for (const t of this.startupTimeouts) clearTimeout(t)
    this.startupTimeouts = []
    await this.loadTimers()
  }

  private async loadTimers(): Promise<void> {

    const tasks = await tasksStore.list()
    const enabled = tasks.filter((t) => t.enabled && t.schedule_sec > 0)

    for (const task of enabled) {
      const intervalMs = task.schedule_sec * 1000
      process.stderr.write(`[scheduler] "${task.name}" (${task.id}): every ${task.schedule_sec}s\n`)

      const timer = setInterval(() => {
        if (this.running) void this.runTask(task.id, task.skill)
      }, intervalMs)
      this.timers.set(task.id, timer)

      if (task.run_on_startup) {
        process.stderr.write(`[scheduler] "${task.name}": running at startup (5s delay)\n`)
        this.startupTimeouts.push(
          setTimeout(() => {
            if (this.running) void this.runTask(task.id, task.skill)
          }, 5_000),
        )
      }
    }

    if (enabled.length === 0) {
      process.stderr.write('[scheduler] No enabled tasks — run tasks manually via HTTP API.\n')
    }
  }

  stop(): void {
    this.running = false
    for (const t of this.timers.values()) clearInterval(t)
    this.timers.clear()
    for (const t of this.startupTimeouts) clearTimeout(t)
    this.startupTimeouts = []
  }

  updatePortfolioParams(params: Record<string, unknown>): void {
    this.portfolioParams = params
  }

  getActiveTasks(): string[] {
    return Array.from(this.activeTasks)
  }

  /** Manual trigger from HTTP API — throws if any task is already running */
  async trigger(taskId: string): Promise<void> {
    if (!this.running) throw new Error('Scheduler is not running')
    if (this.activeTasks.size > 0) {
      const active = Array.from(this.activeTasks).join(', ')
      throw new Error(`Task already running: ${active}`)
    }
    const tasks = await tasksStore.list()
    const task = tasks.find((t) => t.id === taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    await this.runTask(task.id, task.skill)
  }

  private async runTask(taskId: string, skillName: string): Promise<void> {
    if (this.activeTasks.has(taskId)) {
      process.stderr.write(`[scheduler] ⏭ Skipping "${taskId}" — already running\n`)
      return
    }

    this.activeTasks.add(taskId)
    agentState.setLoopActive(taskId, true)
    process.stderr.write(`[scheduler] → starting "${taskId}" (skill: ${skillName})\n`)

    try {
      const result = await this.runner.run(taskId, skillName, this.portfolioParams)
      this.logger.log(result)
      agentState.recordRunResult(result)
      await tasksStore.update(taskId, { last_run_at: result.timestamp })
      process.stderr.write(
        `[scheduler] ✓ "${taskId}" done in ${result.duration_ms}ms (${result.tool_calls} tool calls)\n`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[scheduler] ✗ "${taskId}" failed: ${msg}\n`)
      this.logger.error(taskId, msg)
      agentState.recordLoopError(taskId, msg)
    } finally {
      this.activeTasks.delete(taskId)
      agentState.setLoopActive(taskId, false)
    }
  }
}
