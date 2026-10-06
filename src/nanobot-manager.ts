import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { closeSync, constants as fsConstants, openSync, readFileSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import type { AgentConfigFile } from './agent-config-store.js'
import type { AIProviderName } from './providers/index.js'
import type { AgentTask } from './tasks-store.js'
import { writeCronJobs } from './nanobot-cron-sync.js'
import { canonicalSkillName, listSkillSources, missingMindSkills, resolveSkillDir } from './skill-sources.js'

const execFileAsync = promisify(execFile)

const DEFAULT_GATEWAY_PORT = 18790

const RLN_TOOLS = [
  'get_node_info',
  'get_balances',
  'get_asset_balance',
  'list_assets',
  'get_address',
  'create_rgb_invoice',
  'create_ln_invoice',
  'pay_invoice',
  'send_btc',
  'send_asset',
  'list_channels',
  'connect_peer',
  'open_channel',
  'close_channel',
  'get_channel_id',
  'list_payments',
  'refresh_transfers',
  'atomic_taker',
  'list_swaps',
  'get_swap',
  'mpp_pay',
] as const

// kaleido-mcp serves every RLN tool as wdk_* and rln_*; local skills use wdk_*, @kaleidorg/mind skills use rln_*.
const KALEIDO_MCP_ENABLED_TOOLS = [
  ...RLN_TOOLS.map((name) => `wdk_${name}`),
  ...RLN_TOOLS.map((name) => `rln_${name}`),
  // Node lifecycle (read-only; state changes stay on the CLI)
  'kaleido_node_list',
  'kaleido_node_ps',
  'kaleido_node_status',
  'kaleido_node_info',
  // Spark tools
  'spark_get_balance',
  'spark_get_address',
  'spark_get_token_balance',
  'spark_get_deposit_address',
  'spark_create_lightning_invoice',
  'spark_pay_lightning_invoice',
  'spark_quote_lightning_payment',
  'spark_send_sats',
  'spark_transfer_token',
  'spark_quote_withdraw',
  'spark_withdraw',
  'spark_get_transfers',
  'spark_mpp_pay',
  // KaleidoSwap DEX tools
  'kaleidoswap_get_assets',
  'kaleidoswap_get_pairs',
  'kaleidoswap_get_quote',
  'kaleidoswap_get_spreads',
  'kaleidoswap_atomic_init',
  'kaleidoswap_atomic_execute',
  'kaleidoswap_atomic_status',
  'kaleidoswap_lsp_get_info',
  'kaleidoswap_lsp_estimate_fees',
  'kaleidoswap_lsp_create_order',
  'kaleidoswap_lsp_get_order',
  'kaleidoswap_lsp_quote_asset_channel',
  'kaleidoswap_lsp_create_asset_channel',
  // MPP / L402 tools
  'mpp_request_challenge',
  'mpp_submit_credential',
  'mpp_parse_challenge_header',
  'l402_request_challenge',
  'l402_fetch_resource',
  'l402_get_price',
  'l402_get_market_data',
  'l402_get_ohlcv',
  'l402_get_sentiment',
  'search_paid_apis',
]

const CONTROL_TOOL_NAMES = [
  'agent_get_status',
  'agent_get_config',
  'agent_list_tasks',
  'agent_run_task',
  'agent_update_task',
  'agent_list_skills',
  'agent_set_skill_enabled',
] as const

// Matches only exact known tool names to avoid false positives from env var names or formula variables.
// Built lazily from KALEIDO_MCP_ENABLED_TOOLS + CONTROL_TOOL_NAMES at validation time.
function buildSkillToolRe(tools: readonly string[]): RegExp {
  const escaped = tools.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'g')
}

export interface NanobotRuntimeInfo {
  installed: boolean
  running: boolean
  binary: string
  config_path: string
  workspace_path: string
  gateway_port: number
  pid: number | null
  health_error?: string
}

interface ManagerOptions {
  projectRoot: string
  stateDir: string
  distDir: string
  agentConfig: AgentConfigFile
  provider: AIProviderName
  model: string
  anthropicApiKey: string
  openaiApiKey: string
}

type NanobotConfig = {
  providers: Record<string, Record<string, unknown>>
  agents: {
    defaults: {
      provider: string
      model: string
      workspace: string
    }
  }
  tools: {
    mcpServers: Record<string, Record<string, unknown>>
  }
  channels?: {
    telegram?: {
      enabled: boolean
      token: string
      allowFrom?: string[]
    }
  }
  gateway: {
    port: number
  }
}

export class NanobotManager {
  private readonly projectRoot: string
  private readonly stateDir: string
  private readonly distDir: string
  private readonly agentConfigPath: string
  private provider: AIProviderName
  private model: string
  private anthropicApiKey: string
  private openaiApiKey: string

  readonly instanceDir: string
  readonly workspaceDir: string
  readonly skillsDir: string
  readonly configPath: string
  readonly heartbeatPath: string
  readonly tasksSnapshotPath: string
  readonly cronDir: string
  readonly gatewayLogPath: string
  readonly gatewayPidPath: string

  constructor(options: ManagerOptions) {
    this.projectRoot = options.projectRoot
    this.stateDir = options.stateDir
    this.distDir = options.distDir
    this.agentConfigPath = resolve(process.env.CONFIG_PATH ?? resolve(this.stateDir, 'agent.config.json'))
    this.provider = options.provider
    this.model = options.model
    this.anthropicApiKey = options.anthropicApiKey
    this.openaiApiKey = options.openaiApiKey

    this.instanceDir = resolve(this.stateDir, '.nanobot')
    this.workspaceDir = resolve(this.instanceDir, 'workspace')
    this.skillsDir = resolve(this.workspaceDir, 'skills')
    this.configPath = resolve(this.instanceDir, 'config.json')
    this.heartbeatPath = resolve(this.workspaceDir, 'HEARTBEAT.md')
    this.tasksSnapshotPath = resolve(this.workspaceDir, 'tasks.snapshot.json')
    this.cronDir = resolve(this.instanceDir, 'cron')
    this.gatewayLogPath = resolve(this.instanceDir, 'gateway.log')
    this.gatewayPidPath = resolve(this.instanceDir, 'gateway.pid')
  }

  updateRuntime(provider: AIProviderName, model: string, anthropicApiKey: string, openaiApiKey: string): void {
    this.provider = provider
    this.model = model
    this.anthropicApiKey = anthropicApiKey
    this.openaiApiKey = openaiApiKey
  }

  get gatewayPort(): number {
    return this.getAgentConfig().nanobot?.gateway_port ?? DEFAULT_GATEWAY_PORT
  }

  get binary(): string {
    return process.env.NANOBOT_BIN || 'nanobot'
  }

  async sync(tasks: AgentTask[], portfolioParams?: Record<string, unknown>): Promise<void> {
    await mkdir(this.instanceDir, { recursive: true })
    await mkdir(this.workspaceDir, { recursive: true })
    await this.writeConfig()
    await this.syncSkills()
    await this.writeHeartbeat(tasks)
    await this.writeTasksSnapshot(tasks)
    if (portfolioParams) {
      await this.syncCronJobs(tasks, portfolioParams)
    }
  }

  async syncCronJobs(tasks: AgentTask[], portfolioParams: Record<string, unknown>): Promise<void> {
    const agentConfig = this.getAgentConfig()
    const dryRun = agentConfig.portfolio.dry_run
    await writeCronJobs(this.cronDir, tasks, portfolioParams, dryRun)
  }

  async validate(tasks: AgentTask[]): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = []
    if (!(await this.isInstalled())) {
      errors.push(`nanobot binary not found: ${this.binary}`)
    }

    const enabledSkills = new Set((this.getAgentConfig().skills?.enabled ?? []).map(canonicalSkillName))
    const localSkillsDir = resolve(this.projectRoot, 'skills')
    const availableTools = new Set<string>([
      ...CONTROL_TOOL_NAMES,
      ...KALEIDO_MCP_ENABLED_TOOLS,
    ])
    const skillToolRe = buildSkillToolRe([...availableTools])

    for (const skillName of enabledSkills) {
      const skillDir = resolveSkillDir(skillName, localSkillsDir)
      try {
        if (!skillDir) throw new Error('not found')
        const content = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
        const required = new Set<string>((content.match(skillToolRe) ?? []).map((match) => match.trim()))
        const missing = [...required].filter((name) => !availableTools.has(name))
        if (missing.length > 0) {
          errors.push(`skill "${skillName}" references unavailable tools: ${missing.join(', ')}`)
        }
      } catch {
        errors.push(`skill not found: ${skillName}`)
      }
    }

    const enabledTaskSkills = new Set(tasks.filter((task) => task.enabled).map((task) => canonicalSkillName(task.skill)))
    for (const skillName of enabledTaskSkills) {
      if (!enabledSkills.has(skillName)) {
        errors.push(`enabled task references disabled skill: ${skillName}`)
      }
    }

    return { ok: errors.length === 0, errors }
  }

  async isInstalled(): Promise<boolean> {
    try {
      await execFileAsync(this.binary, ['--help'], { timeout: 15_000 })
      return true
    } catch {
      return false
    }
  }

  async getRuntimeInfo(): Promise<NanobotRuntimeInfo> {
    const installed = await this.isInstalled()
    const pid = await this.readPid()
    const processAlive = pid !== null && (await this.isProcessAlive(pid))
    const health = processAlive ? await this.checkHealth() : { ok: false }
    return {
      installed,
      running: processAlive,
      binary: this.binary,
      config_path: this.configPath,
      workspace_path: this.workspaceDir,
      gateway_port: this.gatewayPort,
      pid,
      ...(health.ok ? {} : (health.error ? { health_error: health.error } : {})),
    }
  }

  async startGateway(tasks: AgentTask[], portfolioParams?: Record<string, unknown>): Promise<void> {
    await this.sync(tasks, portfolioParams)
    const existingPid = await this.readPid()
    if (existingPid !== null) {
      if (await this.isProcessAlive(existingPid)) {
        // Verify it's actually the gateway by checking health
        const health = await this.checkHealth()
        if (health.ok) return
      }
      // Stale PID — clean up
      await rm(this.gatewayPidPath, { force: true })
    }

    // In container mode, pipe gateway logs to both file and stderr (visible in docker logs).
    // Locally, write to file only (detached, no tty).
    const isContainer = !!process.env.KALEIDOAGENT_STATE_DIR
    if (isContainer) {
      const child = spawn(
        'sh',
        ['-c', `${this.binary} gateway --config ${this.configPath} --workspace ${this.workspaceDir} 2>&1 | tee -a ${this.gatewayLogPath}`],
        {
          cwd: this.projectRoot,
          detached: true,
          stdio: ['ignore', process.stderr, process.stderr],
          env: process.env,
        },
      )
      child.unref()
      await writeFile(this.gatewayPidPath, `${child.pid}\n`, 'utf8')
    } else {
      const logFd = openSync(this.gatewayLogPath, 'a')
      const child = spawn(
        this.binary,
        ['gateway', '--config', this.configPath, '--workspace', this.workspaceDir],
        {
          cwd: this.projectRoot,
          detached: true,
          stdio: ['ignore', logFd, logFd],
          env: process.env,
        },
      )
      closeSync(logFd)
      child.unref()
      await writeFile(this.gatewayPidPath, `${child.pid}\n`, 'utf8')
    }

    // Give the gateway a moment to start, then verify process is alive.
    // Not all nanobot versions expose an HTTP health endpoint.
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const launchedPid = await this.readPid()
    if (launchedPid !== null && !(await this.isProcessAlive(launchedPid))) {
      throw new Error('Nanobot gateway process exited immediately — check gateway.log')
    }
  }

  async stopGateway(): Promise<void> {
    const pid = await this.readPid()
    if (pid !== null) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // Ignore stale pid files.
      }
    }
    await rm(this.gatewayPidPath, { force: true })
  }

  async runAgent(message: string): Promise<string> {
    const { stdout, stderr } = await execFileAsync(
      this.binary,
      ['agent', '-c', this.configPath, '-w', this.workspaceDir, '--no-markdown', '-m', message],
      {
        cwd: this.projectRoot,
        env: process.env,
        maxBuffer: 1024 * 1024 * 8,
        timeout: 120_000,
      },
    )
    const output = stdout.trim()
    if (output) return output
    if (stderr.trim()) return stderr.trim()
    return ''
  }

  private async writeConfig(): Promise<void> {
    const config = this.renderConfig()
    await writeFile(this.configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  }

  private async syncSkills(): Promise<void> {
    const localSkillsDir = resolve(this.projectRoot, 'skills')
    await rm(this.skillsDir, { recursive: true, force: true })
    await mkdir(this.skillsDir, { recursive: true })
    const sources = listSkillSources(localSkillsDir)
    for (const source of sources) {
      await cp(source.dir, join(this.skillsDir, source.name), { recursive: true, force: true })
    }
    const missing = missingMindSkills(localSkillsDir)
    if (missing.length > 0) {
      process.stderr.write(`[nanobot] @kaleidorg/mind does not ship: ${missing.join(', ')} (upgrade the package)\n`)
    }
  }

  private async writeHeartbeat(tasks: AgentTask[]): Promise<void> {
    const lines = [
      '# KaleidoAgent Heartbeat',
      '',
      '## Periodic Tasks',
    ]

    const activeTasks = tasks.filter((task) => task.enabled)
    if (activeTasks.length === 0) {
      lines.push('- [ ] No enabled tasks. Ask the operator to enable a task from the dashboard or via agent tools.')
    } else {
      for (const task of activeTasks) {
        lines.push(
          `- [ ] ${task.name} (${task.id}) every ${task.schedule_sec}s using skill "${task.skill}". ${task.description || 'No description.'}`,
        )
      }
    }

    lines.push(
      '',
      'Use the local control tools to inspect status, trigger tasks, or enable/disable skills. Do not execute destructive wallet actions without explicit confirmation when dry run is enabled.',
      '',
    )
    await writeFile(this.heartbeatPath, lines.join('\n'), 'utf8')
  }

  private async writeTasksSnapshot(tasks: AgentTask[]): Promise<void> {
    await writeFile(this.tasksSnapshotPath, `${JSON.stringify(tasks, null, 2)}\n`, 'utf8')
  }

  private renderConfig(): NanobotConfig {
    const agentConfig = this.getAgentConfig()
    const authToken = process.env.MCP_AUTH_TOKEN
    const providerModel = prefixNanobotModel(this.provider, this.model)
    const controlMcpPath = resolve(this.distDir, 'control-mcp.js')

    const mcpServers: Record<string, Record<string, unknown>> = {
      kaleido_control: {
        command: 'node',
        args: [controlMcpPath],
        env: {
          CONTROL_API_URL: process.env.CONTROL_API_URL || 'http://127.0.0.1:4242',
          KALEIDO_BIN: process.env.KALEIDO_BIN || 'kaleido',
          KALEIDO_ENV_NAME: process.env.KALEIDO_ENV_NAME || '',
        },
      },
      kaleido: process.env.NANOBOT_KALEIDO_MCP_URL
        ? {
            ...buildRemoteMcpConfig(process.env.NANOBOT_KALEIDO_MCP_URL, authToken),
            enabledTools: [...KALEIDO_MCP_ENABLED_TOOLS],
          }
        : {
            command: 'node',
            args: [resolve(this.projectRoot, '..', 'kaleido-mcp', 'dist', 'index.js')],
            env: sanitizeEnv({
              ...(('command' in agentConfig.mcp.kaleido && agentConfig.mcp.kaleido.env) ? agentConfig.mcp.kaleido.env : {}),
              ...(process.env.WDK_SEED ? { WDK_SEED: process.env.WDK_SEED } : {}),
              ...(process.env.SPARK_SCAN_API_KEY ? { SPARK_SCAN_API_KEY: process.env.SPARK_SCAN_API_KEY } : {}),
              ...(process.env.SPARK_USDT_TOKEN ? { SPARK_USDT_TOKEN: process.env.SPARK_USDT_TOKEN } : {}),
              ...(process.env.SPARK_NETWORK ? { SPARK_NETWORK: process.env.SPARK_NETWORK } : {}),
              ...(process.env.RLN_NODE_URL ? { RLN_NODE_URL: process.env.RLN_NODE_URL } : {}),
              ...(process.env.KALEIDO_NETWORK ? { KALEIDO_NETWORK: process.env.KALEIDO_NETWORK } : {}),
              ...(process.env.KALEIDOSWAP_API_URL ? { KALEIDOSWAP_API_URL: process.env.KALEIDOSWAP_API_URL } : {}),
              ...(process.env.MPP_GATEWAY_URL ? { MPP_GATEWAY_URL: process.env.MPP_GATEWAY_URL } : {}),
            }),
            enabledTools: [...KALEIDO_MCP_ENABLED_TOOLS],
          },
    }

    const providers: Record<string, Record<string, unknown>> = {}
    if (this.anthropicApiKey) providers.anthropic = { apiKey: this.anthropicApiKey }
    if (this.openaiApiKey) providers.openai = { apiKey: this.openaiApiKey }

    const telegramToken = process.env.TELEGRAM_BOT_TOKEN ?? ''
    const allowFrom = splitCsv(process.env.TELEGRAM_ALLOW_FROM) ?? agentConfig.nanobot?.telegram?.allow_from ?? []
    const resolvedAllowFrom = allowFrom.length > 0 ? allowFrom : ['*']

    const config: NanobotConfig = {
      providers,
      agents: {
        defaults: {
          provider: this.provider,
          model: providerModel,
          workspace: this.workspaceDir,
        },
      },
      tools: { mcpServers },
      gateway: {
        port: this.gatewayPort,
      },
    }

    if (telegramToken) {
      config.channels = {
        telegram: sanitizeObject({
          enabled: true,
          token: telegramToken,
          allowFrom: resolvedAllowFrom,
        }),
      }
    }

    return config
  }

  private async waitForHealth(): Promise<void> {
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      const health = await this.checkHealth()
      if (health.ok) return
      await new Promise((resolve) => setTimeout(resolve, 750))
    }
    throw new Error(`Timed out waiting for nanobot gateway on port ${this.gatewayPort}`)
  }

  private async checkHealth(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.gatewayPort}/health`, {
        signal: AbortSignal.timeout(2_000),
      })
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private async readPid(): Promise<number | null> {
    try {
      const raw = (await readFile(this.gatewayPidPath, 'utf8')).trim()
      const pid = Number(raw)
      return Number.isInteger(pid) && pid > 0 ? pid : null
    } catch {
      return null
    }
  }

  private async isProcessAlive(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  private getAgentConfig(): AgentConfigFile {
    return JSON.parse(readFileSync(this.agentConfigPath, 'utf8')) as AgentConfigFile
  }
}

function buildRemoteMcpConfig(url: string, authToken?: string): Record<string, unknown> {
  const config: Record<string, unknown> = { url }
  if (authToken) {
    config.headers = { Authorization: `Bearer ${authToken}` }
  }
  return config
}

function prefixNanobotModel(provider: AIProviderName, model: string): string {
  if (model.includes('/')) return model
  return `${provider}/${model}`
}

function sanitizeEnv(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.length > 0) {
      result[key] = value
    }
  }
  return result
}

function sanitizeObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T
}

function splitCsv(value: string | undefined): string[] | null {
  if (!value) return null
  const parts = value.split(',').map((entry) => entry.trim()).filter(Boolean)
  return parts.length > 0 ? parts : null
}

export async function nanobotBinaryExists(binary: string): Promise<boolean> {
  try {
    await access(binary, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}
