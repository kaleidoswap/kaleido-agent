import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ensureNodeRunning, probeNode } from '../../src/node-bootstrap.js'

describe('probeNode', () => {
  it('returns true when /nodeinfo responds with 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
    await expect(probeNode('http://localhost:3001', fetchImpl as typeof fetch)).resolves.toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3001/nodeinfo',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('returns false on fetch failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connection refused'))
    await expect(probeNode('http://localhost:3001', fetchImpl as typeof fetch)).resolves.toBe(false)
  })
})

describe('ensureNodeRunning', () => {
  const execFileImpl = vi.fn()
  const sleep = vi.fn().mockResolvedValue(undefined)
  const logger = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when node is already reachable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })

    await ensureNodeRunning(
      { nodeUrl: 'http://localhost:3001' },
      { fetchImpl: fetchImpl as typeof fetch, execFileImpl, sleep, logger }
    )

    expect(execFileImpl).not.toHaveBeenCalled()
  })

  it('starts the node and waits until it becomes reachable', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true })

    execFileImpl.mockResolvedValue({ stdout: '{"ok":true}', stderr: '' })

    await ensureNodeRunning(
      {
        nodeUrl: 'http://localhost:3001',
        apiUrl: 'https://api.staging.kaleidoswap.com',
        envName: 'signet',
        kaleidoBin: '/tmp/kaleido',
        waitTimeoutMs: 5_000,
        pollIntervalMs: 10,
      },
      { fetchImpl: fetchImpl as typeof fetch, execFileImpl, sleep, logger }
    )

    expect(execFileImpl).toHaveBeenCalledWith(
      '/tmp/kaleido',
      ['--json', '--agent', '--api-url', 'https://api.staging.kaleidoswap.com', 'node', 'up', 'signet'],
      expect.any(Object)
    )
    expect(sleep).toHaveBeenCalled()
  })

  it('throws when the node never becomes reachable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false })
    execFileImpl.mockResolvedValue({ stdout: '', stderr: '' })

    await expect(
      ensureNodeRunning(
        {
          nodeUrl: 'http://localhost:3001',
          kaleidoBin: '/tmp/kaleido',
          waitTimeoutMs: 25,
          pollIntervalMs: 10,
        },
        { fetchImpl: fetchImpl as typeof fetch, execFileImpl, sleep, logger }
      )
    ).rejects.toThrow('Timed out waiting for RLN node')
  })
})
