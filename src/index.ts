#!/usr/bin/env node
import dotenv from 'dotenv'
dotenv.config({ override: true })
/**
 * KaleidoAgent — Autonomous Bitcoin L2 Portfolio Rebalancer
 *
 * Nanobot is the core runtime: handles agent execution, scheduling (cron),
 * MCP tools, Telegram, and memory. Node.js provides a thin bridge API
 * for the webapp control panel on :4242.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY     Claude API key
 *
 * Optional env vars:
 *   KALEIDOSWAP_API_URL   KaleidoSwap API (default: signet, or mainnet when KALEIDO_NETWORK=mainnet)
 *   RLN_NODE_URL          RLN daemon URL (default: http://localhost:3001)
 *   DRY_RUN               Set to "false" to enable live trading (default: true)
 *   CONFIG_PATH           Path to agent.config.json (default: ./agent.config.json)
 *   KALEIDO_BIN           Path to kaleido CLI binary (default: kaleido)
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpManager } from './mcp-manager.js'
import { Scheduler } from './scheduler.js'
import { Logger } from './logger.js'
import { agentState } from './agent-state.js'
import { startStatusServer } from './status-server.js'
import { configStore } from './config-store.js'
import { agentConfigStore, type AgentConfigFile } from './agent-config-store.js'
import { tasksStore } from './tasks-store.js'
import { ensureNodeRunning } from './node-bootstrap.js'
import { NanobotManager } from './nanobot-manager.js'
import { NanobotTaskRunner } from './nanobot-task-runner.js'
import { NanobotChatRunner } from './nanobot-chat-runner.js'
import { getProjectRoot, getStateDir, resolveStatePath } from './runtime-paths.js'
import { createWalletBridge, CachedWalletBridge, McpWalletBridge } from './wallet-bridge.js'
import type { WalletFetchMethod } from './wallet-bridge.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = getProjectRoot()
const stateDir = getStateDir()

// ---------------------------------------------------------------------------
// Load config
// ---------------------------------------------------------------------------
const configPath = resolve(
  process.env.CONFIG_PATH ?? resolve(__dirname, '..', 'agent.config.json')
)

const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as AgentConfigFile
agentConfigStore.init(configPath, cfg)

const envPath = resolveStatePath('.env')
configStore.init(envPath, cfg.agent.model)

const agentMode = cfg.agent.mode ?? 'skill'
configStore.agentMode = agentMode

const dryRun = process.env.DRY_RUN
  ? process.env.DRY_RUN !== 'false'
  : cfg.portfolio.dry_run

// Override kaleido-mcp env from process environment
const kaleidoMcp = cfg.mcp.kaleido
if (kaleidoMcp && 'command' in kaleidoMcp) {
  kaleidoMcp.env = {
    ...kaleidoMcp.env,
    ...(process.env.WDK_SEED           ? { WDK_SEED: process.env.WDK_SEED }                        : {}),
    ...(process.env.KALEIDOSWAP_API_URL ? { KALEIDOSWAP_API_URL: process.env.KALEIDOSWAP_API_URL } : {}),
    ...(process.env.RLN_NODE_URL        ? { RLN_NODE_URL: process.env.RLN_NODE_URL }               : {}),
    ...(process.env.SPARK_NETWORK       ? { SPARK_NETWORK: process.env.SPARK_NETWORK }             : {}),
  }
}

if (process.env.KALEIDO_MCP_URL) {
  cfg.mcp.kaleido = {
    url: process.env.KALEIDO_MCP_URL,
    ...(process.env.MCP_AUTH_TOKEN
      ? { headers: { Authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}` } }
      : {}),
  }
}

const portfolioParams = { ...cfg.portfolio, dry_run: dryRun }

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    process.stderr.write('[kaleidoagent] WARNING: No API key set. Set via config UI or env.\n')
  }

  process.stderr.write(
    `[kaleidoagent] Starting — provider: ${configStore.provider} | model: ${configStore.model} | mode: ${agentMode} | dry_run: ${dryRun}\n`
  )

  agentState.init(dryRun, configStore.model, cfg.portfolio.targets, configStore.provider, agentMode)

  const logger = new Logger(
    resolve(stateDir, cfg.notifications.log_file),
    cfg.notifications.log_level
  )

  // Seed default loop tasks (heartbeat, rebalance, daily_summary) on first run
  await tasksStore.seedDefaults({
    heartbeat_interval_sec: cfg.schedule.heartbeat_interval_sec,
    rebalance_interval_sec: cfg.schedule.rebalance_interval_sec,
  })

  const kaleidoEnv = cfg.mcp.kaleido?.env ?? {}
  const rlnNodeUrl = process.env.RLN_NODE_URL ?? kaleidoEnv.RLN_NODE_URL ?? 'http://localhost:3001'
  const kaleidoApiUrl = process.env.KALEIDOSWAP_API_URL ?? kaleidoEnv.KALEIDOSWAP_API_URL

  try {
    await ensureNodeRunning({
      nodeUrl: rlnNodeUrl,
      apiUrl: kaleidoApiUrl,
      envName: process.env.KALEIDO_ENV_NAME,
      kaleidoBin: process.env.KALEIDO_BIN,
    })
  } catch (err) {
    process.stderr.write(
      `[kaleidoagent] WARNING: node bootstrap failed, continuing with degraded wallet features: ${err instanceof Error ? err.message : String(err)}\n`,
    )
  }

  // ---------------------------------------------------------------------------
  // 1. Nanobot — the core runtime
  // ---------------------------------------------------------------------------
  const nanobot = new NanobotManager({
    projectRoot,
    stateDir,
    distDir: resolve(projectRoot, 'dist'),
    agentConfig: cfg,
    provider: configStore.provider,
    model: configStore.model,
    anthropicApiKey: configStore.anthropicApiKey,
    openaiApiKey: configStore.openaiApiKey,
  })

  const taskList = await tasksStore.list()
  const validation = await nanobot.validate(taskList)
  if (!validation.ok) {
    process.stderr.write(`[kaleidoagent] Nanobot validation warnings:\n${validation.errors.map((line) => `  - ${line}`).join('\n')}\n`)
  }

  try {
    await nanobot.startGateway(taskList, portfolioParams)
    process.stderr.write(`[kaleidoagent] Nanobot gateway started on port ${nanobot.gatewayPort}\n`)
  } catch (err) {
    process.stderr.write(`[kaleidoagent] WARNING: failed to start Nanobot gateway: ${err instanceof Error ? err.message : String(err)}\n`)
  }

  // ---------------------------------------------------------------------------
  // 2. MCP — only connect in mcp fallback mode
  // ---------------------------------------------------------------------------
  let mcp: McpManager | undefined
  if (agentMode === 'mcp') {
    mcp = new McpManager()
    await mcp.connect(cfg.mcp)
  } else {
    process.stderr.write(`[kaleidoagent] Skill mode — Nanobot manages MCP connections.\n`)
  }

  // ---------------------------------------------------------------------------
  // 3. Wallet bridge
  // ---------------------------------------------------------------------------
  const walletMethod: WalletFetchMethod = cfg.nanobot?.wallet_fetch_method
    ?? (agentMode === 'mcp' ? 'mcp' : 'cli')

  const rawBridge = createWalletBridge(walletMethod, { mcp, nanobot })
  const walletBridge = new CachedWalletBridge(rawBridge, 30_000)

  // ---------------------------------------------------------------------------
  // 4. Task runner + chat runner (both delegate to Nanobot)
  // ---------------------------------------------------------------------------
  const runner = new NanobotTaskRunner(nanobot, dryRun)
  const chatRunner = new NanobotChatRunner(nanobot, dryRun)

  // ---------------------------------------------------------------------------
  // 5. Scheduler — manual triggers only; cron is handled by Nanobot
  // ---------------------------------------------------------------------------
  const scheduler = new Scheduler(runner, logger, portfolioParams)

  // ---------------------------------------------------------------------------
  // 6. Bridge API server for the webapp
  // ---------------------------------------------------------------------------
  const statusServer = startStatusServer({
    port: 4242,
    chatRunner,
    scheduler,
    mcp,
    nanobot,
    walletBridge,
    portfolioParams,
  })

  // ---------------------------------------------------------------------------
  // 7. Runtime health polling
  // ---------------------------------------------------------------------------
  const updateRuntimeStatus = async () => {
    const runtime = await nanobot.getRuntimeInfo()
    agentState.setRuntimeStatus({
      backend: 'nanobot',
      installed: runtime.installed,
      gateway_running: runtime.running,
      gateway_port: runtime.gateway_port,
      ...(runtime.health_error ? { health_error: runtime.health_error } : {}),
    })
  }
  await updateRuntimeStatus()
  const runtimeTimer = setInterval(() => {
    void updateRuntimeStatus()
  }, 15_000)

  // ---------------------------------------------------------------------------
  // 8. Startup tasks
  // ---------------------------------------------------------------------------
  await scheduler.fireStartupTasks()

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------
  const shutdown = async () => {
    process.stderr.write('\n[kaleidoagent] Shutting down...\n')
    clearInterval(runtimeTimer)
    scheduler.stop()
    agentState.stop()
    statusServer.close()
    await nanobot.stopGateway()
    if (mcp) await mcp.disconnect()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  logger.info(`KaleidoAgent started — mode=${agentMode} dry_run=${dryRun}`)
  process.stderr.write('[kaleidoagent] Running. Press Ctrl+C to stop.\n')
}

main().catch((err) => {
  process.stderr.write(`[kaleidoagent] Fatal: ${err}\n`)
  process.exit(1)
})
