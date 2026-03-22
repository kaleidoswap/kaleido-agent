#!/usr/bin/env node
import dotenv from 'dotenv'
dotenv.config({ override: true })
/**
 * KaleidoAgent — Autonomous Bitcoin L2 Portfolio Rebalancer
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY     Claude API key
 *
 * Optional env vars:
 *   KALEIDOSWAP_API_URL   KaleidoSwap API (default: https://api.staging.kaleidoswap.com)
 *   RLN_NODE_URL          RLN daemon URL (default: http://localhost:3001)
 *   DRY_RUN               Set to "false" to enable live trading (default: true)
 *   CONFIG_PATH           Path to agent.config.json (default: ./agent.config.json)
 *   KALEIDO_BIN           Path to kaleido CLI binary (default: kaleido)
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpManager } from './mcp-manager.js'
import { AgentRunner } from './agent-runner.js'
import { Scheduler } from './scheduler.js'
import { Logger } from './logger.js'
import { agentState } from './agent-state.js'
import { startStatusServer } from './status-server.js'
import { ChatRunner } from './chat-runner.js'
import { configStore } from './config-store.js'
import { agentConfigStore, type AgentConfigFile } from './agent-config-store.js'
import { tasksStore } from './tasks-store.js'
import { AGENT_SYSTEM_PROMPT } from './prompts.js'
import { ensureNodeRunning } from './node-bootstrap.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// ---------------------------------------------------------------------------
// Load config
// ---------------------------------------------------------------------------
const configPath = resolve(
  process.env.CONFIG_PATH ?? resolve(__dirname, '..', 'agent.config.json')
)

const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as AgentConfigFile
agentConfigStore.init(configPath, cfg)

const envPath = resolve(process.cwd(), '.env')
configStore.init(envPath, cfg.agent.model)

const agentMode = cfg.agent.mode ?? 'mcp'
configStore.agentMode = agentMode

const dryRun = process.env.DRY_RUN
  ? process.env.DRY_RUN !== 'false'
  : cfg.portfolio.dry_run

// Override kaleido-mcp env from process environment
const kaleidoMcp = cfg.mcp.kaleido
if (kaleidoMcp) {
  kaleidoMcp.env = {
    ...kaleidoMcp.env,
    ...(process.env.WDK_SEED           ? { WDK_SEED: process.env.WDK_SEED }                        : {}),
    ...(process.env.KALEIDOSWAP_API_URL ? { KALEIDOSWAP_API_URL: process.env.KALEIDOSWAP_API_URL } : {}),
    ...(process.env.RLN_NODE_URL        ? { RLN_NODE_URL: process.env.RLN_NODE_URL }               : {}),
    ...(process.env.SPARK_NETWORK       ? { SPARK_NETWORK: process.env.SPARK_NETWORK }             : {}),
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
    resolve(process.cwd(), cfg.notifications.log_file),
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

  await ensureNodeRunning({
    nodeUrl: rlnNodeUrl,
    apiUrl: kaleidoApiUrl,
    envName: process.env.KALEIDO_ENV_NAME,
    kaleidoBin: process.env.KALEIDO_BIN,
  })

  // Connect to MCP only in mcp mode
  const mcp = new McpManager()
  if (agentMode === 'mcp') {
    await mcp.connect(cfg.mcp)
  } else {
    process.stderr.write(`[kaleidoagent] Skill mode — skipping MCP server connection.\n`)
  }

  const runner = new AgentRunner(mcp, {
    model: cfg.agent.model,
    maxTokens: cfg.agent.max_tokens,
    maxToolCallsPerRun: cfg.agent.max_tool_calls_per_run,
    systemPrompt: AGENT_SYSTEM_PROMPT,
    dryRun,
    agentMode,
  })

  // Chat runner always uses MCP (falls back gracefully if not connected)
  const chatRunner = new ChatRunner(mcp, cfg.agent.model)

  const scheduler = new Scheduler(runner, logger, portfolioParams)
  const statusServer = startStatusServer(4242, chatRunner, scheduler, runner, agentMode === 'mcp' ? mcp : undefined)

  process.on('SIGINT', async () => {
    process.stderr.write('\n[kaleidoagent] Shutting down...\n')
    scheduler.stop()
    agentState.stop()
    statusServer.close()
    await mcp.disconnect()
    process.exit(0)
  })
  process.on('SIGTERM', async () => {
    scheduler.stop()
    agentState.stop()
    statusServer.close()
    await mcp.disconnect()
    process.exit(0)
  })

  await scheduler.start()

  logger.info(`KaleidoAgent started — mode=${agentMode} dry_run=${dryRun}`)
  process.stderr.write('[kaleidoagent] Running. Press Ctrl+C to stop.\n')
}

main().catch((err) => {
  process.stderr.write(`[kaleidoagent] Fatal: ${err}\n`)
  process.exit(1)
})
