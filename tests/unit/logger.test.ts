import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Logger } from '../../src/logger.js'

describe('Logger', () => {
  let tmpDir: string
  let logFile: string
  let logger: Logger

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kaleidoagent-test-'))
    logFile = join(tmpDir, 'logs', 'test.log')
    logger = new Logger(logFile, 'INFO')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('log() writes a valid JSON INFO entry', () => {
    logger.log({
      loop: 'heartbeat',
      timestamp: '2026-01-01T00:00:00.000Z',
      tool_calls: 3,
      final_response: 'all good',
      duration_ms: 1234,
    })
    const entry = JSON.parse(readFileSync(logFile, 'utf8').trim())
    expect(entry.level).toBe('INFO')
    expect(entry.loop).toBe('heartbeat')
    expect(entry.tool_calls).toBe(3)
    expect(entry.duration_ms).toBe(1234)
    expect(entry.response).toBe('all good')
  })

  it('log() caps final_response at 2000 characters', () => {
    logger.log({
      loop: 'rebalance',
      timestamp: '2026-01-01T00:00:00.000Z',
      tool_calls: 0,
      final_response: 'x'.repeat(5000),
      duration_ms: 0,
    })
    const entry = JSON.parse(readFileSync(logFile, 'utf8').trim())
    expect(entry.response.length).toBe(2000)
  })

  it('error() writes a valid JSON ERROR entry', () => {
    logger.error('rebalance', 'something went wrong')
    const entry = JSON.parse(readFileSync(logFile, 'utf8').trim())
    expect(entry.level).toBe('ERROR')
    expect(entry.loop).toBe('rebalance')
    expect(entry.message).toBe('something went wrong')
  })

  it('info() writes a valid JSON INFO message', () => {
    logger.info('agent started')
    const entry = JSON.parse(readFileSync(logFile, 'utf8').trim())
    expect(entry.level).toBe('INFO')
    expect(entry.message).toBe('agent started')
  })

  it('writes multiple entries on separate lines', () => {
    logger.info('first')
    logger.info('second')
    logger.info('third')
    const lines = readFileSync(logFile, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0]).message).toBe('first')
    expect(JSON.parse(lines[1]).message).toBe('second')
    expect(JSON.parse(lines[2]).message).toBe('third')
  })

  it('all entries include a timestamp', () => {
    logger.info('ts check')
    const entry = JSON.parse(readFileSync(logFile, 'utf8').trim())
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
