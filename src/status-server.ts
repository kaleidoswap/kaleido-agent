/**
 * StatusServer — thin bridge API between the webapp and Nanobot core.
 * Listens on 127.0.0.1:4242 (localhost only).
 *
 * Reads Nanobot workspace state, proxies commands to NanobotTaskRunner,
 * and serves wallet data via WalletBridge (cli/agent/mcp).
 *
 * Endpoints:
 *   GET  /health  → { ok: true }
 *   GET  /status  → AgentStatusPayload (JSON)
 *   GET  /wallets → WalletSnapshot (via WalletBridge)
 *   GET  /config  → agent + portfolio config
 *   POST /config  → update config + sync nanobot
 *   POST /run     → { task_id } → trigger task manually
 *   POST /chat    → { messages } → ChatResponse
 *   POST /chat/actions/swap → execute confirmed swap
 *   GET  /skills  → list skills
 *   PATCH /skills → enable/disable skill
 *   GET  /tasks   → list tasks
 *   POST /tasks   → create task
 *   PATCH /tasks/:id → update task
 *   DELETE /tasks/:id → delete task
 */

import http from 'node:http'
import { z } from 'zod'
import { agentState } from './agent-state.js'
import { configStore } from './config-store.js'
import { agentConfigStore } from './agent-config-store.js'
import { executeConfirmedSwap, type SwapActionInput } from './chat-actions.js'
import { tasksStore, type AgentTask } from './tasks-store.js'
import type { ChatMessage, ChatRunner } from './chat-runner.js'
import type { Scheduler } from './scheduler.js'
import type { McpManager } from './mcp-manager.js'
import type { NanobotManager } from './nanobot-manager.js'
import type { WalletBridge } from './wallet-bridge.js'
import { listSkillSources, type SkillOrigin } from './skill-sources.js'

// ─── Skills helpers ──────────────────────────────────────────────────────────

interface SkillInfo {
  id: string
  name: string
  enabled: boolean
  source: SkillOrigin
}

function formatSkillName(id: string): string {
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

async function listSkills(): Promise<SkillInfo[]> {
  const enabledSkills = agentConfigStore.getEnabledSkills()
  return listSkillSources().map((source) => ({
    id: source.name,
    name: formatSkillName(source.name),
    enabled: enabledSkills.includes(source.name),
    source: source.origin,
  }))
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
// Config patch validation
// ---------------------------------------------------------------------------

const configPatchSchema = z.object({
  provider: z.enum(['anthropic', 'openai']).optional(),
  model: z.string().max(100).optional(),
  agent_mode: z.enum(['mcp', 'skill']).optional(),
  anthropic_api_key: z.string().max(500).optional(),
  openai_api_key: z.string().max(500).optional(),
  portfolio: z.object({
    targets: z.record(z.string(), z.number().min(0).max(100)).optional(),
    rebalance_threshold_pct: z.number().min(0).max(100).optional(),
    max_swap_usd: z.number().min(0).optional(),
    min_btc_reserve_sats: z.number().int().min(0).optional(),
    max_concurrent_orders: z.number().int().min(1).max(10).optional(),
    stop_loss_btc_sats: z.number().int().min(0).optional(),
    dry_run: z.boolean().optional(),
    trading_mode: z.enum(['atomic', 'rest', 'both']).optional(),
    lsp: z.object({
      lsp_balance_sat: z.number().int().min(0).optional(),
      client_balance_sat: z.number().int().min(0).optional(),
      channel_expiry_blocks: z.number().int().min(0).optional(),
      min_outbound_liquidity_sat: z.number().int().min(0).optional(),
      auto_buy_channel: z.boolean().optional(),
    }).optional(),
  }).optional(),
  schedule: z.object({
    rebalance_interval_sec: z.number().int().min(0).optional(),
    heartbeat_interval_sec: z.number().int().min(0).optional(),
    daily_summary_cron: z.string().max(20).optional(),
  }).optional(),
})

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

interface StatusServerOptions {
  port?: number
  chatRunner?: Pick<ChatRunner, 'chat'> & { setDryRun?: (dryRun: boolean) => void }
  scheduler?: Scheduler
  mcp?: McpManager
  nanobot?: NanobotManager
  walletBridge?: WalletBridge
  portfolioParams?: Record<string, unknown>
}

export function startStatusServer(opts: StatusServerOptions): http.Server
/** @deprecated — use options object form */
export function startStatusServer(
  port: number,
  chatRunner?: Pick<ChatRunner, 'chat'> & { setDryRun?: (dryRun: boolean) => void },
  scheduler?: Scheduler,
  runner?: unknown,
  mcp?: McpManager,
  nanobot?: NanobotManager,
  walletBridge?: WalletBridge,
  portfolioParams?: Record<string, unknown>,
): http.Server
export function startStatusServer(
  portOrOpts: number | StatusServerOptions,
  chatRunnerArg?: Pick<ChatRunner, 'chat'> & { setDryRun?: (dryRun: boolean) => void },
  schedulerArg?: Scheduler,
  _runnerArg?: unknown,
  mcpArg?: McpManager,
  nanobotArg?: NanobotManager,
  walletBridgeArg?: WalletBridge,
  portfolioParamsArg?: Record<string, unknown>,
): http.Server {
  // Normalize both call signatures
  const o: StatusServerOptions = typeof portOrOpts === 'object'
    ? portOrOpts
    : {
        port: portOrOpts,
        chatRunner: chatRunnerArg,
        scheduler: schedulerArg,
        mcp: mcpArg,
        nanobot: nanobotArg,
        walletBridge: walletBridgeArg,
        portfolioParams: portfolioParamsArg,
      }

  const port = o.port ?? 4242
  const chatRunner = o.chatRunner
  const scheduler = o.scheduler
  const mcp = o.mcp
  const nanobot = o.nanobot
  const walletBridge = o.walletBridge
  let portfolioParams = o.portfolioParams

  const syncNanobot = async () => {
    if (!nanobot) return
    const tasks = await tasksStore.list()
    await nanobot.sync(tasks, portfolioParams)
  }

  const server = http.createServer(async (req, res) => {
    // CORS — restrict to webapp origin (configurable via WEBAPP_ORIGIN env var)
    const allowedOrigin = process.env.WEBAPP_ORIGIN || 'http://localhost:5173'
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
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

    // GET /wallets — live wallet balances via WalletBridge
    if (req.url === '/wallets' && req.method === 'GET') {
      if (!walletBridge) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Wallet bridge not configured' }))
        return
      }
      try {
        const snapshot = await walletBridge.refresh()
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
        const raw = JSON.parse(body)
        const parsed = configPatchSchema.safeParse(raw)
        if (!parsed.success) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Validation failed', issues: parsed.error.issues }))
          return
        }
        const patch = parsed.data

        configStore.update({
          provider: patch.provider,
          model: patch.model,
          anthropic_api_key: patch.anthropic_api_key,
          openai_api_key: patch.openai_api_key,
        })
        nanobot?.updateRuntime(
          configStore.provider,
          configStore.model,
          configStore.anthropicApiKey,
          configStore.openaiApiKey,
        )

        const configFile = agentConfigStore.update({
          agent: patch.agent_mode ? { mode: patch.agent_mode } : undefined,
          portfolio: patch.portfolio as Parameters<typeof agentConfigStore.update>[0]['portfolio'],
          schedule: patch.schedule,
        })

        // Sync live mode into configStore so AgentRunner picks it up without restart
        if (patch.agent_mode) configStore.agentMode = patch.agent_mode

        agentState.updateRuntimeConfig(configStore.provider, configStore.model, configFile.agent.mode)
        agentState.setDryRun(configFile.portfolio.dry_run)
        if (typeof chatRunner?.setDryRun === 'function') {
          chatRunner.setDryRun(configFile.portfolio.dry_run)
        }

        portfolioParams = {
          ...configFile.portfolio,
          dry_run: configFile.portfolio.dry_run,
        }
        scheduler?.updatePortfolioParams(portfolioParams)
        await syncNanobot()

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
        res.end(JSON.stringify({ error: 'Swap execution requires MCP mode. Use the chat assistant to request swaps in skill mode.' }))
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
        const statusCode = result.ok ? 200 : result.final_status === 'DRY_RUN' ? 409 : 202
        res.writeHead(statusCode, { 'Content-Type': 'application/json' })
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
        await syncNanobot()
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
        await syncNanobot()
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
        await syncNanobot()
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
        if (deleted) await syncNanobot()
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

  const host = process.env.AGENT_HOST || '127.0.0.1'

  server.listen(port, host, () => {
    process.stderr.write(`[status-server] Listening on http://${host}:${port}\n`)
    // Kick off initial wallet fetch shortly after boot, then refresh every 30s
    if (walletBridge) {
      setTimeout(() => walletBridge.refresh().catch(() => {}), 5_000)
      setInterval(() => walletBridge.refresh().catch(() => {}), 30_000)
    }
  })

  server.on('error', (err) => {
    process.stderr.write(`[status-server] Error: ${err.message}\n`)
  })

  return server
}
