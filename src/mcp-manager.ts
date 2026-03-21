/**
 * MCP Manager — spawns and manages connections to MCP server processes.
 * Collects all tools from every registered server and exposes them
 * as Anthropic SDK tool definitions (ready to pass to messages.create).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import Anthropic from '@anthropic-ai/sdk'
import type { McpToolDef } from './providers/index.js'

export interface McpServerConfig {
  command: string
  args: string[]
  env?: Record<string, string>
}

interface RegisteredServer {
  name: string
  client: Client
  toolNames: Set<string>
}

export class McpManager {
  private servers: RegisteredServer[] = []
  private allTools: Anthropic.Tool[] = []
  private rawToolDefs: McpToolDef[] = []

  async connect(servers: Record<string, McpServerConfig>): Promise<void> {
    for (const [name, cfg] of Object.entries(servers)) {
      const transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
      })

      const client = new Client({ name: `kaleidoagent-${name}`, version: '1.0.0' })
      await client.connect(transport)

      const { tools } = await client.listTools()
      const toolNames = new Set(tools.map((t) => t.name))

      // Convert MCP tool definitions → Anthropic SDK tool format
      for (const t of tools) {
        this.allTools.push({
          name: t.name,
          description: t.description ?? '',
          input_schema: (t.inputSchema as Anthropic.Tool['input_schema']) ?? {
            type: 'object',
            properties: {},
          },
        })
        this.rawToolDefs.push({
          name: t.name,
          description: t.description ?? '',
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
        })
      }

      this.servers.push({ name, client, toolNames })
      process.stderr.write(`[mcp-manager] Connected to "${name}" — ${tools.length} tools\n`)
    }
  }

  get tools(): Anthropic.Tool[] {
    return this.allTools
  }

  get rawTools(): McpToolDef[] {
    return this.rawToolDefs
  }

  async callTool(
    name: string,
    input: Record<string, unknown>
  ): Promise<string> {
    for (const server of this.servers) {
      if (!server.toolNames.has(name)) continue
      const result = await server.client.callTool({ name, arguments: input })
      const content = result.content as Array<{ type: string; text?: string }>
      return content.map((c) => c.text ?? '').join('\n')
    }
    throw new Error(`Tool not found: ${name}`)
  }

  async disconnect(): Promise<void> {
    for (const server of this.servers) {
      await server.client.close()
    }
  }
}
