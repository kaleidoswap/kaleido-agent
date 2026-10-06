import { writeFileSync } from 'node:fs'
import { canonicalSkillName } from './skill-sources.js'

export interface PortfolioLspConfig {
  lsp_balance_sat: number
  client_balance_sat: number
  channel_expiry_blocks: number
  min_outbound_liquidity_sat: number
  auto_buy_channel: boolean
}

export interface PortfolioConfig {
  targets: Record<string, number>
  rebalance_threshold_pct: number
  max_swap_usd: number
  min_btc_reserve_sats: number
  max_concurrent_orders: number
  stop_loss_btc_sats: number
  dry_run: boolean
  trading_mode: 'atomic' | 'rest' | 'both'
  lsp: PortfolioLspConfig
}

export interface ScheduleConfig {
  rebalance_interval_sec: number
  heartbeat_interval_sec: number
  daily_summary_cron: string
}

export interface NanobotTelegramConfig {
  allow_from?: string[]
}

export type WalletFetchMethod = 'cli' | 'agent' | 'mcp'

export interface NanobotConfigFile {
  gateway_port?: number
  heartbeat_interval_sec?: number
  wallet_fetch_method?: WalletFetchMethod
  telegram?: NanobotTelegramConfig
}

export type AgentMode = 'mcp' | 'skill'

export type McpServerConfigFile =
  | {
      command: string
      args: string[]
      env?: Record<string, string>
      url?: never
      headers?: never
    }
  | {
      url: string
      headers?: Record<string, string>
      command?: never
      args?: never
      env?: never
    }

export interface AgentConfigFile {
  agent: { model: string; max_tokens: number; max_tool_calls_per_run: number; mode?: AgentMode }
  mcp: Record<string, McpServerConfigFile>
  portfolio: PortfolioConfig
  schedule: ScheduleConfig
  notifications: { log_file: string; log_level: string }
  skills?: { enabled: string[] }
  nanobot?: NanobotConfigFile
}

function cloneConfig(config: AgentConfigFile): AgentConfigFile {
  return JSON.parse(JSON.stringify(config)) as AgentConfigFile
}

class AgentConfigStore {
  private configPath = ''
  private config: AgentConfigFile | null = null

  init(configPath: string, config: AgentConfigFile): void {
    this.configPath = configPath
    this.config = cloneConfig(config)
    if (this.config.skills) {
      this.config.skills.enabled = [...new Set(this.config.skills.enabled.map(canonicalSkillName))]
    }
  }

  getConfig(): AgentConfigFile {
    if (!this.config) throw new Error('Agent config store not initialized')
    return cloneConfig(this.config)
  }

  getMode(): AgentMode {
    return this.config?.agent.mode ?? 'skill'
  }

  getPublicConfig() {
    const cfg = this.getConfig()
    return {
      agent_mode: cfg.agent.mode ?? 'skill',
      portfolio: cfg.portfolio,
      schedule: cfg.schedule,
      nanobot: {
        heartbeat_interval_sec: cfg.nanobot?.heartbeat_interval_sec ?? cfg.schedule?.heartbeat_interval_sec ?? 300,
        wallet_fetch_method: cfg.nanobot?.wallet_fetch_method ?? 'cli',
      },
    }
  }

  update(patch: {
    agent?: { mode?: AgentMode }
    portfolio?: Partial<PortfolioConfig> & { lsp?: Partial<PortfolioLspConfig> }
    schedule?: Partial<ScheduleConfig>
  }): AgentConfigFile {
    if (!this.config) throw new Error('Agent config store not initialized')

    if (patch.agent?.mode) {
      this.config.agent.mode = patch.agent.mode
    }

    if (patch.portfolio) {
      this.config.portfolio = {
        ...this.config.portfolio,
        ...patch.portfolio,
        targets: patch.portfolio.targets
          ? { ...patch.portfolio.targets }
          : this.config.portfolio.targets,
        lsp: patch.portfolio.lsp
          ? { ...this.config.portfolio.lsp, ...patch.portfolio.lsp }
          : this.config.portfolio.lsp,
      }
    }

    if (patch.schedule) {
      this.config.schedule = {
        ...this.config.schedule,
        ...patch.schedule,
      }
    }

    this.write()
    return this.getConfig()
  }

  getEnabledSkills(): string[] {
    return this.config?.skills?.enabled ?? []
  }

  setSkillEnabled(id: string, enabled: boolean): void {
    if (!this.config) throw new Error('Agent config store not initialized')
    const current = new Set(this.config.skills?.enabled ?? [])
    if (enabled) {
      current.add(id)
    } else {
      current.delete(id)
    }
    this.config.skills = { enabled: Array.from(current) }
    this.write()
  }

  private write(): void {
    if (!this.configPath || !this.config) return
    writeFileSync(this.configPath, `${JSON.stringify(this.config, null, 2)}\n`, 'utf8')
  }
}

export const agentConfigStore = new AgentConfigStore()
