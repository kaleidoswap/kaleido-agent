import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any imports that use these modules
// ---------------------------------------------------------------------------

const mockClose = vi.fn().mockResolvedValue(undefined)
const mockConnect = vi.fn().mockResolvedValue(undefined)
const mockCallTool = vi.fn().mockResolvedValue({
  content: [{ type: 'text', text: '{"result":"ok"}' }],
})

// Default listTools response — can be overridden per-test
const makeListTools = (names: string[]) =>
  vi.fn().mockResolvedValue({
    tools: names.map((name) => ({
      name,
      description: `Tool ${name}`,
      inputSchema: { type: 'object', properties: {} },
    })),
  })

let listToolsMock = makeListTools(['tool_a'])

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function () {
    return {
      connect: mockConnect,
      close: mockClose,
      listTools: () => listToolsMock(),
      callTool: mockCallTool,
    }
  }),
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(function () { return {} }),
}))

// ---------------------------------------------------------------------------

import { McpManager } from '../../src/mcp-manager.js'

describe('McpManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listToolsMock = makeListTools(['tool_a'])
  })

  it('connect() registers tools and exposes them via .tools', async () => {
    const manager = new McpManager()
    await manager.connect({ server_a: { command: 'node', args: ['a.js'] } })
    expect(manager.tools).toHaveLength(1)
    expect(manager.tools[0].name).toBe('tool_a')
    expect(manager.tools[0].description).toBe('Tool tool_a')
  })

  it('tools aggregates from multiple servers', async () => {
    listToolsMock = makeListTools(['tool_a'])
    const manager = new McpManager()

    // Override Client mock to return different tools for each call
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const toolsA = makeListTools(['tool_a'])
    const toolsBC = makeListTools(['tool_b', 'tool_c'])
    vi.mocked(Client)
      .mockImplementationOnce(function () {
        return {
          connect: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
          listTools: toolsA,
          callTool: mockCallTool,
        }
      })
      .mockImplementationOnce(function () {
        return {
          connect: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
          listTools: toolsBC,
          callTool: mockCallTool,
        }
      })

    await manager.connect({
      server_a: { command: 'node', args: ['a.js'] },
      server_b: { command: 'node', args: ['b.js'] },
    })

    expect(manager.tools).toHaveLength(3)
    expect(manager.tools.map((t) => t.name)).toEqual(['tool_a', 'tool_b', 'tool_c'])
  })

  it('callTool() routes to the server that owns the tool', async () => {
    const manager = new McpManager()
    await manager.connect({ server_a: { command: 'node', args: ['a.js'] } })
    const result = await manager.callTool('tool_a', { key: 'val' })
    expect(result).toBe('{"result":"ok"}')
    expect(mockCallTool).toHaveBeenCalledWith({ name: 'tool_a', arguments: { key: 'val' } })
  })

  it('callTool() throws for unknown tool', async () => {
    const manager = new McpManager()
    await manager.connect({ server_a: { command: 'node', args: ['a.js'] } })
    await expect(manager.callTool('nonexistent', {})).rejects.toThrow('Tool not found: nonexistent')
  })

  it('callTool() joins multiple text content blocks', async () => {
    mockCallTool.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'part1' },
        { type: 'text', text: 'part2' },
      ],
    })
    const manager = new McpManager()
    await manager.connect({ server_a: { command: 'node', args: ['a.js'] } })
    const result = await manager.callTool('tool_a', {})
    expect(result).toBe('part1\npart2')
  })

  it('disconnect() closes all client connections', async () => {
    const manager = new McpManager()
    await manager.connect({
      server_a: { command: 'node', args: ['a.js'] },
    })
    await manager.disconnect()
    expect(mockClose).toHaveBeenCalledTimes(1)
  })
})
