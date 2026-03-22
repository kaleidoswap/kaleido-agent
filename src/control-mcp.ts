#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const CONTROL_API_URL = process.env.CONTROL_API_URL || 'http://127.0.0.1:4242'

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${CONTROL_API_URL}${path}`, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
  return res.json() as Promise<T>
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${CONTROL_API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`HTTP ${res.status} for ${path}: ${detail}`)
  }
  return res.json() as Promise<T>
}

async function patchJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${CONTROL_API_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`HTTP ${res.status} for ${path}: ${detail}`)
  }
  return res.json() as Promise<T>
}

async function main() {
  const server = new McpServer({
    name: 'kaleidoagent-control',
    version: '1.0.0',
  })

  server.tool(
    'agent_get_status',
    'Get the live KaleidoAgent dashboard/control-plane status, including recent runs and active tasks.',
    {},
    async () => text(JSON.stringify(await getJson('/status'), null, 2)),
  )

  server.tool(
    'agent_get_config',
    'Get the current KaleidoAgent runtime configuration exposed by the dashboard backend.',
    {},
    async () => text(JSON.stringify(await getJson('/config'), null, 2)),
  )

  server.tool(
    'agent_list_tasks',
    'List all dashboard-managed agent tasks.',
    {},
    async () => text(JSON.stringify(await getJson('/tasks'), null, 2)),
  )

  server.tool(
    'agent_run_task',
    'Trigger a dashboard-managed task immediately by task_id.',
    {
      task_id: z.string().describe('Task identifier, e.g. "heartbeat"'),
    },
    async ({ task_id }: { task_id: string }) =>
      text(JSON.stringify(await postJson('/run', { task_id }), null, 2)),
  )

  server.tool(
    'agent_update_task',
    'Enable/disable or reschedule a dashboard-managed task.',
    {
      task_id: z.string(),
      enabled: z.boolean().optional(),
      schedule_sec: z.number().int().positive().optional(),
      description: z.string().optional(),
      run_on_startup: z.boolean().optional(),
    },
    async ({
      task_id,
      enabled,
      schedule_sec,
      description,
      run_on_startup,
    }: {
      task_id: string
      enabled?: boolean
      schedule_sec?: number
      description?: string
      run_on_startup?: boolean
    }) =>
      text(JSON.stringify(await patchJson(`/tasks/${task_id}`, {
        ...(enabled !== undefined ? { enabled } : {}),
        ...(schedule_sec !== undefined ? { schedule_sec } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(run_on_startup !== undefined ? { run_on_startup } : {}),
      }), null, 2)),
  )

  server.tool(
    'agent_list_skills',
    'List all skills known to the dashboard backend and whether they are enabled.',
    {},
    async () => text(JSON.stringify(await getJson('/skills'), null, 2)),
  )

  server.tool(
    'agent_set_skill_enabled',
    'Enable or disable a skill in the dashboard backend.',
    {
      id: z.string().describe('Skill identifier'),
      enabled: z.boolean(),
    },
    async ({ id, enabled }: { id: string; enabled: boolean }) =>
      text(JSON.stringify(await patchJson('/skills', { id, enabled }), null, 2)),
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  process.stderr.write(`[control-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
