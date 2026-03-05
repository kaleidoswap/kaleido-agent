#!/usr/bin/env node
/**
 * KaleidoAgent — Autonomous Bitcoin L2 Portfolio Rebalancer
 *
 * Uses Claude AI + three MCP servers to autonomously rebalance a portfolio
 * of BTC, USDT (RGB), and XAUT (RGB) on the Lightning Network via KaleidoSwap.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY     Claude API key
 *
 * Optional env vars:
 *   KALEIDOSWAP_API_URL   KaleidoSwap API (default: https://api.staging.kaleidoswap.com)
 *   RLN_NODE_URL          RLN daemon URL (default: http://localhost:3001)
 *   L402_GATEWAY_URL      L402 gateway URL (default: demo mode)
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

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// ---------------------------------------------------------------------------
// Load config
// ---------------------------------------------------------------------------
const configPath = resolve(
  process.env.CONFIG_PATH ?? resolve(__dirname, '..', 'agent.config.json')
)

interface AgentConfigFile {
  agent: { model: string; max_tokens: number; max_tool_calls_per_run: number }
  mcp: Record<string, { command: string; args: string[]; env?: Record<string, string> }>
  portfolio: {
    targets: Record<string, number>
    rebalance_threshold_pct: number
    max_swap_usd: number
    min_btc_reserve_sats: number
    max_concurrent_orders: number
    stop_loss_btc_sats: number
    dry_run: boolean
  }
  schedule: {
    rebalance_interval_sec: number
    heartbeat_interval_sec: number
    daily_summary_cron: string
  }
  assets: {
    btc_asset_id: string
    usdt_asset_id: string
    xaut_asset_id: string
  }
  notifications: { log_file: string; log_level: string }
}

const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as AgentConfigFile

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
if (process.env.L402_GATEWAY_URL) {
  cfg.mcp.l402_gateway.env = {
    ...cfg.mcp.l402_gateway.env,
    L402_GATEWAY_URL: process.env.L402_GATEWAY_URL,
  }
}

// Merge portfolio params + assets into agent context
const portfolioParams = {
  ...cfg.portfolio,
  dry_run: dryRun,
  assets: cfg.assets,
}

// ---------------------------------------------------------------------------
// Load strategy skill (system prompt)
// ---------------------------------------------------------------------------
const skillPath = resolve(__dirname, '..', 'skills', 'kaleidoagent', 'SKILL.md')
const systemPrompt = readFileSync(skillPath, 'utf8')

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write('[kaleidoagent] ERROR: ANTHROPIC_API_KEY is not set\n')
    process.exit(1)
  }

  process.stderr.write(
    `[kaleidoagent] Starting — model: ${cfg.agent.model} | dry_run: ${dryRun}\n`
  )

  const logger = new Logger(
    resolve(process.cwd(), cfg.notifications.log_file),
    cfg.notifications.log_level
  )

  // Connect to all MCP servers
  const mcp = new McpManager()
  await mcp.connect(cfg.mcp)

  const runner = new AgentRunner(mcp, {
    model: cfg.agent.model,
    maxTokens: cfg.agent.max_tokens,
    maxToolCallsPerRun: cfg.agent.max_tool_calls_per_run,
    systemPrompt,
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

  // Graceful shutdown
  process.on('SIGINT', async () => {
    process.stderr.write('\n[kaleidoagent] Shutting down...\n')
    scheduler.stop()
    await mcp.disconnect()
    process.exit(0)
  })
  process.on('SIGTERM', async () => {
    scheduler.stop()
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
