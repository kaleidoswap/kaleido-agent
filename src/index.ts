#!/usr/bin/env node
import dotenv from 'dotenv'
dotenv.config({ override: true })
/**
 * KaleidoAgent — Autonomous Bitcoin L2 Portfolio Rebalancer
 *
 * Uses Claude AI + two MCP servers to autonomously rebalance a portfolio
 * of BTC, USDT (RGB), and XAUT (RGB) on the Lightning Network via KaleidoSwap.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY     Claude API key
 *
 * Optional env vars:
 *   KALEIDOSWAP_API_URL   KaleidoSwap API (default: https://api.staging.kaleidoswap.com)
 *   RLN_NODE_URL          RLN daemon URL (default: http://localhost:3001)
 *   DRY_RUN               Set to "false" to enable live trading (default: true)
 *   CONFIG_PATH           Path to agent.config.json (default: ./agent.config.json)
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

// Init config store with env path and initial model
const envPath = resolve(process.cwd(), '.env')
configStore.init(envPath, cfg.agent.model)

// Env overrides
const dryRun = process.env.DRY_RUN !== 'false'

// Override MCP server env from process environment
if (process.env.KALEIDOSWAP_API_URL) {
  cfg.mcp.kaleidoswap.env = {
    ...cfg.mcp.kaleidoswap.env,
    KALEIDOSWAP_API_URL: process.env.KALEIDOSWAP_API_URL,
  }
}
if (process.env.RLN_NODE_URL) {
  cfg.mcp.wdk_wallet.env = {
    ...cfg.mcp.wdk_wallet.env,
    RLN_NODE_URL: process.env.RLN_NODE_URL,
  }
}

// Merge portfolio params + assets into agent context
const portfolioParams = {
  ...cfg.portfolio,
  dry_run: dryRun,
  assets: cfg.assets,
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    process.stderr.write('[kaleidoagent] WARNING: No API key set (ANTHROPIC_API_KEY or OPENAI_API_KEY). Set via config UI or env.\n')
  }

  process.stderr.write(
    `[kaleidoagent] Starting — provider: ${configStore.provider} | model: ${configStore.model} | dry_run: ${dryRun}\n`
  )

  // Init state store — server starts after MCP connects so chat is ready immediately
  agentState.init(dryRun, configStore.model, cfg.portfolio.targets, configStore.provider)

  const logger = new Logger(
    resolve(process.cwd(), cfg.notifications.log_file),
    cfg.notifications.log_level
  )

  const rlnNodeUrl = process.env.RLN_NODE_URL ?? cfg.mcp.wdk_wallet.env?.RLN_NODE_URL ?? 'http://localhost:3001'
  const kaleidoApiUrl = process.env.KALEIDO_API_URL
    ?? cfg.mcp.kaleido_node.env?.KALEIDO_API_URL
    ?? cfg.mcp.kaleidoswap.env?.KALEIDOSWAP_API_URL

  await ensureNodeRunning({
    nodeUrl: rlnNodeUrl,
    apiUrl: kaleidoApiUrl,
    envName: process.env.KALEIDO_ENV_NAME ?? cfg.mcp.kaleido_node.env?.KALEIDO_ENV_NAME,
    kaleidoBin: process.env.KALEIDO_BIN,
  })

  // Connect to all MCP servers
  const mcp = new McpManager()
  await mcp.connect(cfg.mcp)

  // Start status + chat server now that MCP tools are available
  const chatRunner = new ChatRunner(mcp, cfg.agent.model)
  const runner = new AgentRunner(mcp, {
    model: cfg.agent.model,
    maxTokens: cfg.agent.max_tokens,
    maxToolCallsPerRun: cfg.agent.max_tool_calls_per_run,
    systemPrompt: AGENT_SYSTEM_PROMPT,
    dryRun,
  })

  const scheduler = new Scheduler(
    runner,
    {
      rebalanceIntervalSec: cfg.schedule.rebalance_interval_sec,
      heartbeatIntervalSec: cfg.schedule.heartbeat_interval_sec,
      dailySummaryCron: cfg.schedule.daily_summary_cron,
      portfolioParams,
    },
    logger
  )

  const statusServer = startStatusServer(4242, chatRunner, scheduler)

  // Graceful shutdown
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

  scheduler.start()

  logger.info(`KaleidoAgent started — dry_run=${dryRun}`)
  process.stderr.write('[kaleidoagent] Running. Press Ctrl+C to stop.\n')
}

main().catch((err) => {
  process.stderr.write(`[kaleidoagent] Fatal: ${err}\n`)
  process.exit(1)
})
