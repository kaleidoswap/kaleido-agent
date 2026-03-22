/**
 * StatusServer — lightweight HTTP server exposing agent state and chat.
 * Listens on 127.0.0.1:4242 (localhost only).
 *
 * Endpoints:
 *   GET  /health  → { ok: true }
 *   GET  /status  → AgentStatusPayload (JSON)
 *   POST /run     → { loop: LoopType } → { ok: true }
 *   POST /chat    → { messages: ChatMessage[] } → ChatResponse
 */

import http from 'node:http'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { agentState, type WalletSnapshot, type RgbAssetBalance } from './agent-state.js'
import { configStore } from './config-store.js'
import { agentConfigStore } from './agent-config-store.js'
import { executeConfirmedSwap, type SwapActionInput } from './chat-actions.js'
import { tasksStore, type AgentTask } from './tasks-store.js'
import type { ChatRunner, ChatMessage } from './chat-runner.js'
import type { AgentRunner } from './agent-runner.js'
import type { Scheduler } from './scheduler.js'
import type { McpManager } from './mcp-manager.js'

// ─── Skills helpers ──────────────────────────────────────────────────────────

const SKILLS_DIR = join(process.cwd(), 'skills')

interface SkillInfo {
  id: string
  name: string
  enabled: boolean
}

function formatSkillName(id: string): string {
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

async function listSkills(): Promise<SkillInfo[]> {
  const enabledSkills = agentConfigStore.getEnabledSkills()
  try {
    const entries = await readdir(SKILLS_DIR, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => ({
        id: e.name,
        name: formatSkillName(e.name),
        enabled: enabledSkills.includes(e.name),
      }))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Body reader helper
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 1024 * 1024 // 1 MB

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalSize = 0
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length
      if (totalSize > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('Request body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wallet snapshot refresh — calls MCP tools directly, no agent turn needed
// ---------------------------------------------------------------------------

async function refreshWalletSnapshot(mcp: McpManager): Promise<WalletSnapshot> {
  const snapshot: WalletSnapshot = { fetched_at: new Date().toISOString(), rln: null, spark: null }
  try {
    const [balancesRaw, channelsRaw, sparkRaw, assetsRaw] = await Promise.allSettled([
      mcp.callTool('wdk_get_balances', { skip_sync: true }),
      mcp.callTool('wdk_list_channels', {}),
      mcp.callTool('spark_get_balance', {}),
      mcp.callTool('wdk_list_assets', {}),
    ])

    if (balancesRaw.status === 'fulfilled') {
      const b = JSON.parse(balancesRaw.value) as {
        btc_onchain?: { vanilla_spendable_sats?: number; colored_spendable_sats?: number }
        lightning_balance_sat?: number
      }
      const onchain = (b.btc_onchain?.vanilla_spendable_sats ?? 0) + (b.btc_onchain?.colored_spendable_sats ?? 0)
      const channels = channelsRaw.status === 'fulfilled'
        ? JSON.parse(channelsRaw.value) as {
            channel_count?: number
            total_outbound_msat?: number
            total_inbound_msat?: number
          }
        : null

      // Fetch RGB asset balances in parallel
      let assets: RgbAssetBalance[] = []
      if (assetsRaw.status === 'fulfilled') {
        const assetList = JSON.parse(assetsRaw.value) as Array<{
          asset_id?: string
          ticker?: string
          precision?: number
        }>
        const balanceResults = await Promise.allSettled(
          assetList
            .filter((a) => a.asset_id)
            .map(async (a) => {
              const raw = await mcp.callTool('wdk_get_asset_balance', { asset_id: a.asset_id })
              const bal = JSON.parse(raw) as {
                spendable?: number
                offchain_outbound?: number
                offchain_inbound?: number
              }
              return {
                asset_id: a.asset_id!,
                ticker: a.ticker ?? a.asset_id!,
                precision: a.precision ?? 0,
                spendable: bal.spendable ?? 0,
                offchain_outbound: bal.offchain_outbound ?? 0,
                offchain_inbound: bal.offchain_inbound ?? 0,
              } satisfies RgbAssetBalance
            }),
        )
        assets = balanceResults
          .filter((r): r is PromiseFulfilledResult<RgbAssetBalance> => r.status === 'fulfilled')
          .map((r) => r.value)
      }

      snapshot.rln = {
        btc_onchain_sats: onchain,
        lightning_balance_sat: b.lightning_balance_sat ?? 0,
        channel_count: channels?.channel_count ?? 0,
        total_outbound_sat: Math.round((channels?.total_outbound_msat ?? 0) / 1000),
        total_inbound_sat: Math.round((channels?.total_inbound_msat ?? 0) / 1000),
        assets,
      }
    }

    if (sparkRaw.status === 'fulfilled') {
      const s = JSON.parse(sparkRaw.value) as { balance_sats?: number }
      snapshot.spark = { balance_sats: s.balance_sats ?? 0 }
    }
  } catch (err) {
    snapshot.error = String(err)
  }
  agentState.setWalletSnapshot(snapshot)
  return snapshot
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function startStatusServer(
  port = 4242,
  chatRunner?: ChatRunner,
  scheduler?: Scheduler,
  runner?: AgentRunner,
  mcp?: McpManager,
): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS — allow the Chrome extension origin
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // GET /health
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    // GET /status
    if (req.url === '/status' && req.method === 'GET') {
      const tasks = await tasksStore.list()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        ...agentState.getStatus(),
        tasks,
      }))
      return
    }

    // GET /wallets — live wallet balances (MCP mode only)
    if (req.url === '/wallets' && req.method === 'GET') {
      if (!mcp) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'MCP not available in skill mode' }))
        return
      }
      try {
        const snapshot = await refreshWalletSnapshot(mcp)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(snapshot))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    // GET /config
    if (req.url === '/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        ...configStore.getPublicConfig(),
        ...agentConfigStore.getPublicConfig(),
      }))
      return
    }

    // POST /config
    if (req.url === '/config' && req.method === 'POST') {
      try {
        const body = await readBody(req)
        const patch = JSON.parse(body) as {
          provider?: 'anthropic' | 'openai'
          model?: string
          agent_mode?: 'mcp' | 'skill'
          anthropic_api_key?: string
          openai_api_key?: string
          portfolio?: Parameters<typeof agentConfigStore.update>[0]['portfolio']
          schedule?: {
            rebalance_interval_sec?: number
            heartbeat_interval_sec?: number
            daily_summary_cron?: string
          }
        }

        configStore.update({
          provider: patch.provider,
          model: patch.model,
          anthropic_api_key: patch.anthropic_api_key,
          openai_api_key: patch.openai_api_key,
        })

        const configFile = agentConfigStore.update({
          agent: patch.agent_mode ? { mode: patch.agent_mode } : undefined,
          portfolio: patch.portfolio,
          schedule: patch.schedule,
        })

        // Sync live mode into configStore so AgentRunner picks it up without restart
        if (patch.agent_mode) configStore.agentMode = patch.agent_mode

        agentState.updateRuntimeConfig(configStore.provider, configStore.model, configFile.agent.mode)
        agentState.setDryRun(configFile.portfolio.dry_run)
        runner?.setDryRun(configFile.portfolio.dry_run)

        scheduler?.updatePortfolioParams({
          ...configFile.portfolio,
          dry_run: configFile.portfolio.dry_run,
        })

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          config: {
            ...configStore.getPublicConfig(),
            ...agentConfigStore.getPublicConfig(),
          },
        }))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: msg }))
      }
      return
    }

    // POST /run
    if (req.url === '/run' && req.method === 'POST') {
      if (!scheduler) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Scheduler not ready yet.' }))
        return
      }

      try {
        const body = await readBody(req)
        const parsed = JSON.parse(body) as { task_id?: unknown; loop?: unknown }
        // Accept task_id (new) or loop (backwards-compat alias)
        const taskId = (parsed.task_id ?? parsed.loop) as string | undefined
        if (!taskId || typeof taskId !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'task_id (or loop) required' }))
          return
        }

        await scheduler.trigger(taskId)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, active_loops: scheduler.getActiveTasks() }))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const status = msg.startsWith('Task already running:') ? 409 : msg.includes('not found') ? 404 : 500
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: msg }))
      }
      return
    }

    // POST /chat/actions/swap
    if (req.url === '/chat/actions/swap' && req.method === 'POST') {
      if (!mcp) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'MCP not available in skill mode' }))
        return
      }

      try {
        const body = await readBody(req)
        const { action } = JSON.parse(body) as { action?: SwapActionInput }
        if (!action || action.type !== 'swap') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'swap action required' }))
          return
        }

        const result = await executeConfirmedSwap(mcp, action, agentState.getStatus().dry_run)
        const status = result.ok ? 200 : result.final_status === 'DRY_RUN' ? 409 : 202
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`[status-server] /chat/actions/swap error: ${msg}\n`)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: msg }))
      }
      return
    }

    // POST /chat
    if (req.url === '/chat' && req.method === 'POST') {
      if (!chatRunner) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Chat runner not ready yet.' }))
        return
      }

      try {
        const body = await readBody(req)
        const { messages } = JSON.parse(body) as { messages: ChatMessage[] }

        if (!Array.isArray(messages) || messages.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'messages array required' }))
          return
        }

        const result = await chatRunner.chat(messages)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`[status-server] /chat error: ${msg}\n`)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: msg }))
      }
      return
    }

    // GET /skills
    if (req.url === '/skills' && req.method === 'GET') {
      try {
        const skills = await listSkills()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ skills }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    // PATCH /skills
    if (req.url === '/skills' && req.method === 'PATCH') {
      try {
        const body = await readBody(req)
        const { id, enabled } = JSON.parse(body) as { id?: string; enabled?: boolean }
        if (typeof id !== 'string' || typeof enabled !== 'boolean') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'id (string) and enabled (boolean) required' }))
          return
        }
        agentConfigStore.setSkillEnabled(id, enabled)
        const skills = await listSkills()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, skills }))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    // GET /tasks
    if (req.url === '/tasks' && req.method === 'GET') {
      try {
        const tasks = await tasksStore.list()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ tasks }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    // POST /tasks
    if (req.url === '/tasks' && req.method === 'POST') {
      try {
        const body = await readBody(req)
        const data = JSON.parse(body) as Partial<AgentTask>
        if (!data.name || !data.skill) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'name and skill required' }))
          return
        }
        const task = await tasksStore.create({
          name: data.name,
          description: data.description ?? '',
          skill: data.skill,
          schedule_sec: data.schedule_sec ?? 86400,
          allocated_btc_sat: data.allocated_btc_sat ?? 0,
          allocated_usdt: data.allocated_usdt ?? 0,
          allocated_xaut: data.allocated_xaut ?? 0,
          enabled: data.enabled ?? true,
          run_on_startup: data.run_on_startup ?? false,
        })
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, task }))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    // PATCH /tasks/:id
    if (req.url?.startsWith('/tasks/') && req.method === 'PATCH') {
      const id = req.url.slice('/tasks/'.length)
      try {
        const body = await readBody(req)
        const patch = JSON.parse(body) as Partial<AgentTask>
        const task = await tasksStore.update(id, patch)
        if (!task) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Task not found' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, task }))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    // DELETE /tasks/:id
    if (req.url?.startsWith('/tasks/') && req.method === 'DELETE') {
      const id = req.url.slice('/tasks/'.length)
      try {
        const deleted = await tasksStore.delete(id)
        res.writeHead(deleted ? 200 : 404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: deleted }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
      return
    }

    res.writeHead(404)
    res.end('Not Found')
  })

  server.listen(port, '127.0.0.1', () => {
    process.stderr.write(`[status-server] Listening on http://127.0.0.1:${port}\n`)
    // Kick off an initial wallet fetch shortly after boot, then refresh every 30s
    if (mcp) {
      setTimeout(() => refreshWalletSnapshot(mcp).catch(() => {}), 5_000)
      setInterval(() => refreshWalletSnapshot(mcp).catch(() => {}), 30_000)
    }
  })

  server.on('error', (err) => {
    process.stderr.write(`[status-server] Error: ${err.message}\n`)
  })

  return server
}
