import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Scheduler } from '../../src/scheduler.js'
import type { AgentRunner, RunResult } from '../../src/agent-runner.js'
import type { Logger } from '../../src/logger.js'

function makeRunResult(loop: string): RunResult {
  return {
    loop: loop as RunResult['loop'],
    timestamp: new Date().toISOString(),
    tool_calls: 2,
    final_response: '{"action":"balanced"}',
    duration_ms: 100,
    usage: { input_tokens: 100, output_tokens: 50, estimated_cost_usd: 0.001 },
  }
}

function makeRunner() {
  return { run: vi.fn().mockResolvedValue(makeRunResult('heartbeat')) } as unknown as AgentRunner
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

  it('start() does not fire loops automatically', async () => {
    const runner = makeRunner()
    const scheduler = new Scheduler(runner, {
      rebalanceIntervalSec: 300,
      heartbeatIntervalSec: 300,
      dailySummaryCron: '23:59',
      portfolioParams: {},
    }, makeLogger())

    scheduler.start()
    await Promise.resolve()

    expect(runner.run).not.toHaveBeenCalled()
    scheduler.stop()
  })

  it('trigger() runs the requested loop with current portfolio params', async () => {
    const runner = makeRunner()
    const scheduler = new Scheduler(runner, {
      rebalanceIntervalSec: 60,
      heartbeatIntervalSec: 60,
      dailySummaryCron: '23:59',
      portfolioParams: { dry_run: true },
    }, makeLogger())

    scheduler.start()
    await scheduler.trigger('rebalance')

    expect(runner.run).toHaveBeenCalledWith('rebalance', { dry_run: true })
    scheduler.stop()
  })

  it('trigger() rejects when another loop is already running', async () => {
    const runner = makeRunner()
    let release = () => {}
    vi.mocked(runner.run).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(makeRunResult('heartbeat'))
        }),
    )
    const scheduler = new Scheduler(runner, {
      rebalanceIntervalSec: 60,
      heartbeatIntervalSec: 60,
      dailySummaryCron: '23:59',
      portfolioParams: {},
    }, makeLogger())

    scheduler.start()
    const firstRun = scheduler.trigger('heartbeat')

    await expect(scheduler.trigger('rebalance')).rejects.toThrow('Loop already running: heartbeat')
    release()
    await firstRun
    scheduler.stop()
  })

  it('stop() prevents manual execution', async () => {
    const runner = makeRunner()
    const scheduler = new Scheduler(runner, {
      rebalanceIntervalSec: 10,
      heartbeatIntervalSec: 10,
      dailySummaryCron: '23:59',
      portfolioParams: {},
    }, makeLogger())

    scheduler.start()
    scheduler.stop()
    await expect(scheduler.trigger('heartbeat')).rejects.toThrow('Scheduler is not running')
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('start() is idempotent', async () => {
    const runner = makeRunner()
    const scheduler = new Scheduler(runner, {
      rebalanceIntervalSec: 60,
      heartbeatIntervalSec: 60,
      dailySummaryCron: '23:59',
      portfolioParams: {},
    }, makeLogger())

    scheduler.start()
    scheduler.start()
    await scheduler.trigger('rebalance')

    expect(runner.run).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('logs the result after each successful manual loop', async () => {
    const runner = makeRunner()
    const logger = makeLogger()
    const scheduler = new Scheduler(runner, {
      rebalanceIntervalSec: 300,
      heartbeatIntervalSec: 300,
      dailySummaryCron: '23:59',
      portfolioParams: {},
    }, logger)

    scheduler.start()
    await scheduler.trigger('heartbeat')

    expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({ loop: 'heartbeat' }))
    scheduler.stop()
  })

  it('logs error when loop throws', async () => {
    const runner = makeRunner()
    vi.mocked(runner.run).mockRejectedValueOnce(new Error('API timeout'))
    const logger = makeLogger()

    const scheduler = new Scheduler(runner, {
      rebalanceIntervalSec: 300,
      heartbeatIntervalSec: 300,
      dailySummaryCron: '23:59',
      portfolioParams: {},
    }, logger)

    scheduler.start()
    await scheduler.trigger('heartbeat')

    expect(logger.error).toHaveBeenCalledWith('heartbeat', 'API timeout')
    scheduler.stop()
  })

  it('updateConfig() applies new portfolio params to the next manual run', async () => {
    const runner = makeRunner()
    const scheduler = new Scheduler(runner, {
      rebalanceIntervalSec: 60,
      heartbeatIntervalSec: 60,
      dailySummaryCron: '23:59',
      portfolioParams: { dry_run: true },
    }, makeLogger())

    scheduler.start()
    scheduler.updateConfig({ portfolioParams: { dry_run: false, reason: 'manual' } })
    await scheduler.trigger('daily_summary')

    expect(runner.run).toHaveBeenCalledWith('daily_summary', { dry_run: false, reason: 'manual' })
    scheduler.stop()
  })
})
