/**
 * Scheduler — manual task trigger for KaleidoAgent.
 *
 * Scheduling is now handled by Nanobot's built-in cron system (see nanobot-cron-sync.ts).
 * This class only handles:
 *   - Manual triggers via trigger(taskId) from the HTTP API
 *   - Tracking active/running tasks
 *   - Startup tasks (run_on_startup=true) via fireStartupTasks()
 */

import type { AgentRunner } from './agent-runner.js'
import { Logger } from './logger.js'
import { agentState } from './agent-state.js'
import { tasksStore } from './tasks-store.js'

export class Scheduler {
  private runner: Pick<AgentRunner, 'run' | 'setDryRun'>
  private logger: Logger
  private portfolioParams: Record<string, unknown>
  private activeTasks = new Set<string>()
  private startupTimeouts: ReturnType<typeof setTimeout>[] = []

  constructor(
    runner: Pick<AgentRunner, 'run' | 'setDryRun'>,
    logger: Logger,
    portfolioParams: Record<string, unknown>,
  ) {
    this.runner = runner
    this.logger = logger
    this.portfolioParams = portfolioParams
  }

  /** Fire run_on_startup tasks after a short delay. */
  async fireStartupTasks(): Promise<void> {
    const tasks = await tasksStore.list()
    const startup = tasks.filter((t) => t.enabled && t.run_on_startup)

    for (const task of startup) {
      process.stderr.write(`[scheduler] "${task.name}": running at startup (5s delay)\n`)
      this.startupTimeouts.push(
        setTimeout(() => {
          void this.runTask(task.id, task.skill)
        }, 5_000),
      )
    }

    if (startup.length === 0) {
      process.stderr.write('[scheduler] No startup tasks.\n')
    }
  }

  stop(): void {
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
      process.stderr.write(`[scheduler] Skipping "${taskId}" — already running\n`)
      return
    }

    this.activeTasks.add(taskId)
    agentState.setLoopActive(taskId, true)
    process.stderr.write(`[scheduler] Starting "${taskId}" (skill: ${skillName})\n`)

    try {
      const result = await this.runner.run(taskId, skillName, this.portfolioParams)
      this.logger.log(result)
      agentState.recordRunResult(result)
      await tasksStore.update(taskId, { last_run_at: result.timestamp })
      process.stderr.write(
        `[scheduler] "${taskId}" done in ${result.duration_ms}ms (${result.tool_calls} tool calls)\n`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[scheduler] "${taskId}" failed: ${msg}\n`)
      this.logger.error(taskId, msg)
      agentState.recordLoopError(taskId, msg)
    } finally {
      this.activeTasks.delete(taskId)
      agentState.setLoopActive(taskId, false)
    }
  }
}
