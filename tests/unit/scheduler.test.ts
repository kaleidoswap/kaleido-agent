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

  it('start() fires heartbeat immediately on startup', async () => {
    const runner = makeRunner()
    const scheduler = new Scheduler(runner, {
      rebalanceIntervalSec: 300,
      heartbeatIntervalSec: 300,
      dailySummaryCron: '23:59',
      portfolioParams: {},
    }, makeLogger())

    scheduler.start()
    // Flush microtasks/promises only — don't advance timers
    await Promise.resolve()
    await Promise.resolve()

    expect(runner.run).toHaveBeenCalledWith('heartbeat', {})
    scheduler.stop()
  })

  it('start() schedules rebalance on interval', async () => {
    const runner = makeRunner()
    const scheduler = new Scheduler(runner, {
      rebalanceIntervalSec: 60,
      heartbeatIntervalSec: 9999,
      dailySummaryCron: '23:59',
      portfolioParams: { dry_run: true },
    }, makeLogger())

    scheduler.start()
    await Promise.resolve()
    vi.clearAllMocks()

    await vi.advanceTimersByTimeAsync(60_000)

    const rebalanceCalls = vi.mocked(runner.run).mock.calls.filter(([l]) => l === 'rebalance')
    expect(rebalanceCalls.length).toBeGreaterThanOrEqual(1)
    expect(rebalanceCalls[0][1]).toEqual({ dry_run: true })
    scheduler.stop()
  })

  it('start() schedules heartbeat on interval', async () => {
    const runner = makeRunner()
    const scheduler = new Scheduler(runner, {
      rebalanceIntervalSec: 9999,
      heartbeatIntervalSec: 30,
      dailySummaryCron: '23:59',
      portfolioParams: {},
    }, makeLogger())

    scheduler.start()
    await Promise.resolve()
    vi.clearAllMocks()

    await vi.advanceTimersByTimeAsync(30_000)

    const heartbeatCalls = vi.mocked(runner.run).mock.calls.filter(([l]) => l === 'heartbeat')
    expect(heartbeatCalls.length).toBeGreaterThanOrEqual(1)
    scheduler.stop()
  })

  it('stop() prevents further loop execution', async () => {
    const runner = makeRunner()
    const scheduler = new Scheduler(runner, {
      rebalanceIntervalSec: 10,
      heartbeatIntervalSec: 10,
      dailySummaryCron: '23:59',
      portfolioParams: {},
    }, makeLogger())

    scheduler.start()
    await Promise.resolve()
    scheduler.stop()
    vi.clearAllMocks()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('start() is idempotent — calling twice does not double-schedule', async () => {
    const runner = makeRunner()
    const scheduler = new Scheduler(runner, {
      rebalanceIntervalSec: 60,
      heartbeatIntervalSec: 9999,
      dailySummaryCron: '23:59',
      portfolioParams: {},
    }, makeLogger())

    scheduler.start()
    scheduler.start() // no-op
    await Promise.resolve()
    vi.clearAllMocks()

    await vi.advanceTimersByTimeAsync(60_000)

    const rebalanceCalls = vi.mocked(runner.run).mock.calls.filter(([l]) => l === 'rebalance')
    expect(rebalanceCalls.length).toBe(1)
    scheduler.stop()
  })

  it('logs the result after each successful loop', async () => {
    const runner = makeRunner()
    const logger = makeLogger()
    const scheduler = new Scheduler(runner, {
      rebalanceIntervalSec: 300,
      heartbeatIntervalSec: 300,
      dailySummaryCron: '23:59',
      portfolioParams: {},
    }, logger)

    scheduler.start()
    await Promise.resolve()
    await Promise.resolve()

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
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(logger.error).toHaveBeenCalledWith('heartbeat', 'API timeout')
    scheduler.stop()
  })

  it('daily_summary fires at the configured HH:MM', async () => {
    const runner = makeRunner()
    const scheduler = new Scheduler(runner, {
      rebalanceIntervalSec: 9999,
      heartbeatIntervalSec: 9999,
      dailySummaryCron: '12:00',
      portfolioParams: {},
    }, makeLogger())

    // Set fake time to 11:59
    vi.setSystemTime(new Date('2026-01-01T11:59:00'))
    scheduler.start()
    await Promise.resolve()
    vi.clearAllMocks()

    // Advance 1 minute — clock hits 12:00
    await vi.advanceTimersByTimeAsync(60_000)

    const summaryCalls = vi.mocked(runner.run).mock.calls.filter(([l]) => l === 'daily_summary')
    expect(summaryCalls.length).toBeGreaterThanOrEqual(1)
    scheduler.stop()
  })
})
