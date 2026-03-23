import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Scheduler } from '../../src/scheduler.js'
import type { AgentRunner, RunResult } from '../../src/agent-runner.js'
import type { Logger } from '../../src/logger.js'

// Mock tasksStore so trigger() can look up tasks
vi.mock('../../src/tasks-store.js', () => ({
  tasksStore: {
    list: vi.fn().mockResolvedValue([
      { id: 'heartbeat', name: 'Heartbeat', skill: 'channel-manager', schedule_sec: 300, enabled: true, run_on_startup: true },
      { id: 'rebalance', name: 'Rebalance', skill: 'portfolio-manager', schedule_sec: 3600, enabled: true, run_on_startup: false },
      { id: 'daily_summary', name: 'Daily Summary', skill: 'kaleidoagent', schedule_sec: 86400, enabled: true, run_on_startup: false },
    ]),
    update: vi.fn().mockResolvedValue(null),
  },
}))

// Mock agent-state to prevent side effects
vi.mock('../../src/agent-state.js', () => ({
  agentState: {
    setLoopActive: vi.fn(),
    recordRunResult: vi.fn(),
    recordLoopError: vi.fn(),
  },
}))

function makeRunResult(loop: string): RunResult {
  return {
    loop,
    timestamp: new Date().toISOString(),
    tool_calls: 2,
    final_response: '{"action":"balanced"}',
    trace: [],
    duration_ms: 100,
    usage: { input_tokens: 100, output_tokens: 50, estimated_cost_usd: 0.001 },
  }
}

function makeRunner() {
  return {
    run: vi.fn().mockResolvedValue(makeRunResult('heartbeat')),
    setDryRun: vi.fn(),
  } as unknown as Pick<AgentRunner, 'run' | 'setDryRun'>
}

function makeLogger() {
  return { log: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as Logger
}

describe('Scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('trigger() runs the requested task via runner.run()', async () => {
    const runner = makeRunner()
    const scheduler = new Scheduler(runner, makeLogger(), { dry_run: true })

    await scheduler.trigger('heartbeat')

    expect(runner.run).toHaveBeenCalledWith('heartbeat', 'channel-manager', { dry_run: true })
  })

  it('trigger() rejects when another task is already running', async () => {
    const runner = makeRunner()
    let release = () => {}
    vi.mocked(runner.run).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(makeRunResult('heartbeat'))
        }),
    )
    const scheduler = new Scheduler(runner, makeLogger(), {})

    const firstRun = scheduler.trigger('heartbeat')
    // Let the first trigger settle past its async tasksStore.list() call
    await Promise.resolve()
    await Promise.resolve()

    await expect(scheduler.trigger('rebalance')).rejects.toThrow('Task already running: heartbeat')
    release()
    await firstRun
  })

  it('trigger() rejects for unknown task IDs', async () => {
    const runner = makeRunner()
    const scheduler = new Scheduler(runner, makeLogger(), {})

    await expect(scheduler.trigger('nonexistent')).rejects.toThrow('Task not found: nonexistent')
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('logs the result after each successful run', async () => {
    const runner = makeRunner()
    const logger = makeLogger()
    const scheduler = new Scheduler(runner, logger, {})

    await scheduler.trigger('heartbeat')

    expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({ loop: 'heartbeat' }))
  })

  it('logs error when task throws', async () => {
    const runner = makeRunner()
    vi.mocked(runner.run).mockRejectedValueOnce(new Error('API timeout'))
    const logger = makeLogger()
    const scheduler = new Scheduler(runner, logger, {})

    await scheduler.trigger('heartbeat')

    expect(logger.error).toHaveBeenCalledWith('heartbeat', 'API timeout')
  })

  it('updatePortfolioParams() applies new params to the next run', async () => {
    const runner = makeRunner()
    const scheduler = new Scheduler(runner, makeLogger(), { dry_run: true })

    scheduler.updatePortfolioParams({ dry_run: false, reason: 'manual' })
    await scheduler.trigger('daily_summary')

    expect(runner.run).toHaveBeenCalledWith('daily_summary', 'kaleidoagent', { dry_run: false, reason: 'manual' })
  })

  it('getActiveTasks() returns running task IDs', async () => {
    const runner = makeRunner()
    let release = () => {}
    vi.mocked(runner.run).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(makeRunResult('heartbeat'))
        }),
    )
    const scheduler = new Scheduler(runner, makeLogger(), {})

    const runPromise = scheduler.trigger('heartbeat')
    // Let the trigger settle past its async tasksStore.list() call
    await Promise.resolve()
    await Promise.resolve()
    expect(scheduler.getActiveTasks()).toEqual(['heartbeat'])

    release()
    await runPromise
    expect(scheduler.getActiveTasks()).toEqual([])
  })
})
