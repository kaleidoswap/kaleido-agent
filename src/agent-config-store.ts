import { writeFileSync } from 'node:fs'

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

export interface AgentConfigFile {
  agent: { model: string; max_tokens: number; max_tool_calls_per_run: number }
  mcp: Record<string, { command: string; args: string[]; env?: Record<string, string> }>
  portfolio: PortfolioConfig
  schedule: ScheduleConfig
  assets: {
    btc_asset_id: string
    usdt_asset_id: string
    xaut_asset_id: string
  }
  notifications: { log_file: string; log_level: string }
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
  }

  getConfig(): AgentConfigFile {
    if (!this.config) throw new Error('Agent config store not initialized')
    return cloneConfig(this.config)
  }

  getPublicConfig() {
    const cfg = this.getConfig()
    return {
      portfolio: cfg.portfolio,
      schedule: cfg.schedule,
      assets: cfg.assets,
    }
  }

  update(patch: {
    portfolio?: Partial<PortfolioConfig> & { lsp?: Partial<PortfolioLspConfig> }
    schedule?: Partial<ScheduleConfig>
  }): AgentConfigFile {
    if (!this.config) throw new Error('Agent config store not initialized')

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

  private write(): void {
    if (!this.configPath || !this.config) return
    writeFileSync(this.configPath, `${JSON.stringify(this.config, null, 2)}\n`, 'utf8')
  }
}

export const agentConfigStore = new AgentConfigStore()
