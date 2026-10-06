/**
 * Integration test — runs the real heartbeat loop against live services.
 *
 * Requires:
 *   ANTHROPIC_API_KEY   Claude API key
 *   RLN_NODE_URL        Running RLN node (default: http://localhost:3001)
 *   KALEIDOSWAP_API_URL KaleidoSwap API (default: https://api.signet.kaleidoswap.com)
 *
 * Skip gracefully if ANTHROPIC_API_KEY is not set.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpManager } from '../../src/mcp-manager.js'
import { AgentRunner } from '../../src/agent-runner.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY
const RLN_NODE_URL = process.env.RLN_NODE_URL ?? 'http://localhost:3001'
const KALEIDOSWAP_API_URL =
  process.env.KALEIDOSWAP_API_URL ?? 'https://api.signet.kaleidoswap.com'

describe.skipIf(!HAS_API_KEY)('Integration: heartbeat loop', () => {
  let mcp: McpManager

  beforeAll(async () => {
    mcp = new McpManager()
    await mcp.connect({
      kaleidoswap: {
        command: 'node',
        args: [resolve(ROOT, '../kaleidoswap-mcp/dist/index.js')],
        env: { KALEIDOSWAP_API_URL },
      },
      wdk_wallet: {
        command: 'node',
        args: [resolve(ROOT, '../wdk-wallet-rln-mcp/dist/index.js')],
        env: { RLN_NODE_URL },
      },
      l402_gateway: {
        command: 'node',
        args: [resolve(ROOT, '../mpp-gateway-mcp/dist/index.js')],
        env: {},
      },
    })
  }, 30_000)

  afterAll(async () => {
    await mcp.disconnect()
  })

  it('discovers tools from all 3 MCP servers', () => {
    const names = mcp.tools.map((t) => t.name)
    // kaleidoswap-mcp tools
    expect(names).toContain('kaleidoswap_get_assets')
    expect(names).toContain('kaleidoswap_atomic_init')
    expect(names).toContain('kaleidoswap_lsp_estimate_fees')
    // wdk-wallet-rln-mcp tools
    expect(names).toContain('wdk_get_node_info')
    expect(names).toContain('wdk_atomic_taker')
    // mpp-gateway-mcp tools
    expect(names).toContain('l402_get_price')
    expect(names).toContain('mpp_request_challenge')
    // Total: 15 kaleidoswap + 18 wdk + 9 mpp = 42
    expect(mcp.tools.length).toBe(42)
  })

  it('kaleidoswap_get_assets returns BTC and at least one asset', async () => {
    const result = await mcp.callTool('kaleidoswap_get_assets', {})
    const assets = JSON.parse(result)
    expect(Array.isArray(assets)).toBe(true)
    expect(assets.length).toBeGreaterThan(0)
    const btc = assets.find((a: { ticker: string }) => a.ticker === 'BTC')
    expect(btc).toBeDefined()
    expect(btc.precision).toBe(11)
  })

  it('wdk_get_node_info returns a pubkey', async () => {
    const result = await mcp.callTool('wdk_get_node_info', {})
    const info = JSON.parse(result)
    expect(typeof info.pubkey).toBe('string')
    expect(info.pubkey.length).toBeGreaterThan(0)
  })

  it('l402_get_price returns a BTC price', async () => {
    const result = await mcp.callTool('l402_get_price', { asset: 'BTC' })
    const data = JSON.parse(result)
    expect(data.price).toBeGreaterThan(0)
  })

  it('heartbeat loop runs end-to-end and returns structured JSON', async () => {
    const systemPrompt = readFileSync(
      resolve(ROOT, 'skills/kaleidoagent/SKILL.md'),
      'utf8'
    )
    const runner = new AgentRunner(mcp, {
      model: 'claude-haiku-4-5-20251001', // cheapest model for integration test
      maxTokens: 1024,
      maxToolCallsPerRun: 10,
      systemPrompt,
      dryRun: true,
    })

    const result = await runner.run('heartbeat', {
      dry_run: true,
      targets: { BTC: 70, USDT: 20, XAUT: 10 },
      rebalance_threshold_pct: 5,
      max_swap_usd: 200,
      min_btc_reserve_sats: 50000,
    })

    expect(result.loop).toBe('heartbeat')
    expect(result.tool_calls).toBeGreaterThan(0)
    expect(result.final_response.length).toBeGreaterThan(0)
    expect(result.duration_ms).toBeGreaterThan(0)

    // Response should be parseable JSON
    expect(() => JSON.parse(result.final_response)).not.toThrow()
    const report = JSON.parse(result.final_response)
    expect(report.loop ?? report.action ?? report.status).toBeDefined()
  }, 120_000)
})

describe('Integration: MCP tool smoke tests (no API key needed)', () => {
  let mcp: McpManager

  beforeAll(async () => {
    mcp = new McpManager()
    await mcp.connect({
      kaleidoswap: {
        command: 'node',
        args: [resolve(ROOT, '../kaleidoswap-mcp/dist/index.js')],
        env: { KALEIDOSWAP_API_URL },
      },
      wdk_wallet: {
        command: 'node',
        args: [resolve(ROOT, '../wdk-wallet-rln-mcp/dist/index.js')],
        env: { RLN_NODE_URL },
      },
      l402_gateway: {
        command: 'node',
        args: [resolve(ROOT, '../mpp-gateway-mcp/dist/index.js')],
        env: {},
      },
    })
  }, 30_000)

  afterAll(async () => {
    await mcp.disconnect()
  })

  it('all 42 tools are registered', () => {
    expect(mcp.tools.length).toBe(42)
  })

  it('kaleidoswap_get_pairs returns trading pairs', async () => {
    const result = await mcp.callTool('kaleidoswap_get_pairs', {})
    const pairs = JSON.parse(result)
    expect(Array.isArray(pairs)).toBe(true)
    expect(pairs.length).toBeGreaterThan(0)
  })

  it('wdk_list_channels returns channel list', async () => {
    const result = await mcp.callTool('wdk_list_channels', {})
    const data = JSON.parse(result)
    expect(typeof data.channel_count).toBe('number')
    expect(typeof data.total_outbound_msat).toBe('number')
  })

  it('l402_get_sentiment returns fear & greed index', async () => {
    const result = await mcp.callTool('l402_get_sentiment', {})
    const data = JSON.parse(result)
    expect(data.index_value).toBeGreaterThanOrEqual(0)
    expect(data.index_value).toBeLessThanOrEqual(100)
  })

  it('wdk_list_swaps returns maker/taker swap lists', async () => {
    const result = await mcp.callTool('wdk_list_swaps', {})
    const data = JSON.parse(result)
    expect(Array.isArray(data.maker)).toBe(true)
    expect(Array.isArray(data.taker)).toBe(true)
    expect(typeof data.total).toBe('number')
  })
})
