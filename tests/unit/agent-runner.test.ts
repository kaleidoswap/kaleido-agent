import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpManager } from '../../src/mcp-manager.js'

// ---------------------------------------------------------------------------
// Mock Anthropic SDK
// ---------------------------------------------------------------------------

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: mockCreate } }
  }),
}))

// ---------------------------------------------------------------------------

import { AgentRunner } from '../../src/agent-runner.js'

function makeConfig(overrides = {}) {
  return {
    model: 'claude-opus-4-6',
    maxTokens: 1024,
    maxToolCallsPerRun: 5,
    systemPrompt: 'You are a test agent.',
    dryRun: true,
    ...overrides,
  }
}

function makeMcp(tools: string[] = [], toolResult = '{"ok":true}') {
  return {
    tools: tools.map((name) => ({
      name,
      description: `Tool ${name}`,
      input_schema: { type: 'object' as const, properties: {} },
    })),
    callTool: vi.fn().mockResolvedValue(toolResult),
  } as unknown as McpManager
}

function endTurnResponse(text = '{"action":"balanced"}') {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
  }
}

function toolUseResponse(toolName: string, toolId = 'tu_1', input = {}) {
  return {
    stop_reason: 'tool_use',
    content: [
      { type: 'tool_use', id: toolId, name: toolName, input },
    ],
  }
}

describe('AgentRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns final_response from end_turn text block', async () => {
    mockCreate.mockResolvedValueOnce(endTurnResponse('{"action":"balanced","dry_run":true}'))
    const runner = new AgentRunner(makeMcp(), makeConfig())
    const result = await runner.run('heartbeat', {})
    expect(result.loop).toBe('heartbeat')
    expect(result.final_response).toBe('{"action":"balanced","dry_run":true}')
    expect(result.tool_calls).toBe(0)
  })

  it('executes tool calls and feeds results back', async () => {
    mockCreate
      .mockResolvedValueOnce(toolUseResponse('wdk_get_node_info', 'tu_1'))
      .mockResolvedValueOnce(endTurnResponse('{"node":"ok"}'))

    const mcp = makeMcp(['wdk_get_node_info'], '{"pubkey":"abc123"}')
    const runner = new AgentRunner(mcp, makeConfig())
    const result = await runner.run('heartbeat', {})

    expect(result.tool_calls).toBe(1)
    expect(mcp.callTool).toHaveBeenCalledWith('wdk_get_node_info', {})
    expect(result.final_response).toBe('{"node":"ok"}')
  })

  it('catches tool errors and continues the loop', async () => {
    mockCreate
      .mockResolvedValueOnce(toolUseResponse('failing_tool', 'tu_1'))
      .mockResolvedValueOnce(endTurnResponse('{"action":"error handled"}'))

    const mcp = makeMcp(['failing_tool'])
    vi.mocked(mcp.callTool).mockRejectedValueOnce(new Error('connection refused'))

    const runner = new AgentRunner(mcp, makeConfig())
    const result = await runner.run('heartbeat', {})

    expect(result.tool_calls).toBe(1)
    // Second create call should have received the error as tool result
    const secondCall = mockCreate.mock.calls[1]
    const toolResultMsg = secondCall[0].messages[secondCall[0].messages.length - 1]
    expect(JSON.stringify(toolResultMsg)).toContain('connection refused')
  })

  it('stops after maxToolCallsPerRun to prevent runaway loops', async () => {
    // Always respond with a tool use — should stop at limit
    mockCreate.mockResolvedValue(toolUseResponse('wdk_get_node_info', 'tu_1'))
    const mcp = makeMcp(['wdk_get_node_info'])
    const runner = new AgentRunner(mcp, makeConfig({ maxToolCallsPerRun: 3 }))
    const result = await runner.run('heartbeat', {})
    expect(result.tool_calls).toBe(3)
  })

  it('stops immediately when there are no tool_use blocks', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [], // no tool use blocks despite stop reason
    })
    const runner = new AgentRunner(makeMcp(), makeConfig())
    const result = await runner.run('heartbeat', {})
    expect(result.tool_calls).toBe(0)
  })

  it('prompt includes current time, dry_run flag, and portfolio params', async () => {
    mockCreate.mockResolvedValueOnce(endTurnResponse('ok'))
    const runner = new AgentRunner(makeMcp(), makeConfig({ dryRun: true }))
    await runner.run('rebalance', { max_swap_usd: 200, targets: { BTC: 70 } })

    const firstCall = mockCreate.mock.calls[0][0]
    const userMessage = firstCall.messages[0].content as string
    expect(userMessage).toContain('dry_run: true')
    expect(userMessage).toContain('max_swap_usd')
    expect(userMessage).toContain('Current time:')
  })

  it('prompt for rebalance contains rebalance-specific instructions', async () => {
    mockCreate.mockResolvedValueOnce(endTurnResponse('ok'))
    const runner = new AgentRunner(makeMcp(), makeConfig())
    await runner.run('rebalance', {})
    const msg = mockCreate.mock.calls[0][0].messages[0].content as string
    expect(msg).toContain('rebalance loop')
    expect(msg).toContain('wdk_get_node_info')
  })

  it('prompt for heartbeat contains heartbeat-specific instructions', async () => {
    mockCreate.mockResolvedValueOnce(endTurnResponse('ok'))
    const runner = new AgentRunner(makeMcp(), makeConfig())
    await runner.run('heartbeat', {})
    const msg = mockCreate.mock.calls[0][0].messages[0].content as string
    expect(msg).toContain('heartbeat check loop')
  })

  it('prompt for daily_summary contains daily_summary-specific instructions', async () => {
    mockCreate.mockResolvedValueOnce(endTurnResponse('ok'))
    const runner = new AgentRunner(makeMcp(), makeConfig())
    await runner.run('daily_summary', {})
    const msg = mockCreate.mock.calls[0][0].messages[0].content as string
    expect(msg).toContain('daily portfolio summary')
  })

  it('result includes duration_ms and timestamp', async () => {
    mockCreate.mockResolvedValueOnce(endTurnResponse('ok'))
    const runner = new AgentRunner(makeMcp(), makeConfig())
    const result = await runner.run('heartbeat', {})
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
