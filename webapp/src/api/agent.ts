const BASE = '/api/agent'

export type LoopType = string   // now equals task ID (e.g. "heartbeat", "rebalance", or a UUID)
export type AgentMode = 'mcp' | 'skill'

export interface LoopStats {
  runs: number
  errors: number
  last_run_at: string | null
  last_duration_ms: number | null
  last_tool_calls: number | null
  last_error: string | null
  last_response: string | null
}

export interface RecentRun {
  loop: string
  timestamp: string
  tool_calls: number
  duration_ms: number
  cost_usd: number
  final_response: string
  response_preview: string
  trace: TraceStep[]
}

export interface RgbAssetBalance {
  asset_id: string
  ticker: string
  precision: number
  spendable: number
  offchain_outbound: number
  offchain_inbound: number
}

export interface WalletSnapshot {
  fetched_at: string
  rln: {
    btc_onchain_sats: number
    lightning_balance_sat: number
    channel_count: number
    total_outbound_sat: number
    total_inbound_sat: number
    assets: RgbAssetBalance[]
  } | null
  spark: {
    balance_sats: number
  } | null
  error?: string
}

export interface NanobotRuntime {
  backend: 'nanobot'
  installed: boolean
  gateway_running: boolean
  gateway_port: number | null
  health_error?: string
}

export interface AgentStatus {
  running: boolean
  uptime_sec: number
  dry_run: boolean
  model: string
  provider: string
  agent_mode: AgentMode
  active_loops: string[]
  portfolio_targets: Record<string, number>
  portfolio_snapshot: {
    total_usdt: number | null
    assets: Record<string, {
      pct: number | null
      target_pct: number | null
      usdt: number | null
      amount: number | null
      amount_sat: number | null
    }>
  } | null
  wallet_snapshot: WalletSnapshot | null
  cumulative_cost_usd: number
  cumulative_input_tokens: number
  cumulative_output_tokens: number
  runtime: NanobotRuntime | null
  loops: Record<string, LoopStats>
  recent_runs: RecentRun[]
  tasks: AgentTask[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatAction {
  type: 'swap' | 'navigate' | 'none'
  fromAsset?: string
  toAsset?: string
  amount?: string
  view?: string
}

export interface ToolCallTrace {
  name: string
  input: string
  result: string
  error: boolean
}

export type TraceStep =
  | { type: 'thinking'; text: string }
  | { type: 'tool'; name: string; input: string; result: string; error: boolean }

export interface ChatResponse {
  text: string
  action: ChatAction
  tool_calls: ToolCallTrace[]
  trace?: TraceStep[]
}

export interface ChatSwapExecutionResponse {
  ok: boolean
  text: string
  payment_hash?: string
  final_status?: string
  error?: string
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

export async function getStatus(): Promise<AgentStatus | null> {
  try {
    const res = await fetch(`${BASE}/status`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function refreshWallet(): Promise<WalletSnapshot | null> {
  try {
    const res = await fetch(`${BASE}/wallets`, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function sendChat(messages: ChatMessage[]): Promise<ChatResponse> {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) {
    let details = `Chat error: ${res.status}`
    try {
      const payload = (await res.json()) as { error?: string }
      if (payload?.error) details += ` ${payload.error}`
    } catch {
      // Ignore JSON parse errors for non-JSON error bodies.
    }
    throw new Error(details)
  }
  return res.json()
}

export async function executeChatSwap(action: ChatAction): Promise<ChatSwapExecutionResponse> {
  const res = await fetch(`${BASE}/chat/actions/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
    signal: AbortSignal.timeout(90000),
  })

  const payload = await res.json() as ChatSwapExecutionResponse
  if (!res.ok && !payload.text) {
    payload.text = payload.error ?? `Swap error: ${res.status}`
  }
  return payload
}

/** Trigger a task by its ID (or legacy loop name for backwards compat) */
export async function triggerTask(taskId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId }),
      signal: AbortSignal.timeout(120000),
    })
    const payload = (await res.json()) as { ok?: boolean; error?: string }
    if (!res.ok) {
      return { ok: false, error: payload.error ?? `Run error: ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** @deprecated Use triggerTask instead */
export async function triggerLoop(loop: LoopType): Promise<{ ok: boolean; error?: string }> {
  return triggerTask(loop)
}

// ─── Skills API ───

export interface SkillInfo {
  id: string
  name: string
  enabled: boolean
}

export async function getSkills(): Promise<SkillInfo[]> {
  try {
    const res = await fetch(`${BASE}/skills`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return []
    const data = await res.json() as { skills: SkillInfo[] }
    return data.skills ?? []
  } catch {
    return []
  }
}

export async function patchSkill(id: string, enabled: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/skills`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled }),
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── Tasks API ───

export interface AgentTask {
  id: string
  name: string
  description: string
  skill: string
  schedule_sec: number
  allocated_btc_sat: number
  allocated_usdt: number
  allocated_xaut: number
  enabled: boolean
  created_at: string
  last_run_at: string | null
}

export async function getTasks(): Promise<AgentTask[]> {
  try {
    const res = await fetch(`${BASE}/tasks`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return []
    const data = await res.json() as { tasks: AgentTask[] }
    return data.tasks ?? []
  } catch {
    return []
  }
}

export async function createTask(task: Omit<AgentTask, 'id' | 'created_at' | 'last_run_at'>): Promise<AgentTask | null> {
  try {
    const res = await fetch(`${BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json() as { task: AgentTask }
    return data.task
  } catch {
    return null
  }
}

export async function updateTask(id: string, patch: Partial<AgentTask>): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function deleteTask(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/tasks/${id}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── Config API ───

export interface ModelOption {
  id: string
  label: string
}

export interface AgentPortfolioConfig {
  targets: Record<string, number>
  rebalance_threshold_pct: number
  max_swap_usd: number
  min_btc_reserve_sats: number
  max_concurrent_orders: number
  stop_loss_btc_sats: number
  dry_run: boolean
  trading_mode: 'atomic' | 'rest' | 'both'
  lsp: {
    lsp_balance_sat: number
    client_balance_sat: number
    channel_expiry_blocks: number
    min_outbound_liquidity_sat: number
    auto_buy_channel: boolean
  }
}

export interface AgentScheduleConfig {
  rebalance_interval_sec: number
  heartbeat_interval_sec: number
  daily_summary_cron: string
}

export interface AgentConfig {
  provider: 'anthropic' | 'openai'
  model: string
  agent_mode: AgentMode
  has_anthropic_key: boolean
  has_openai_key: boolean
  anthropic_models: ModelOption[]
  openai_models: ModelOption[]
  portfolio: AgentPortfolioConfig
  schedule: AgentScheduleConfig
}

export async function getConfig(): Promise<AgentConfig | null> {
  try {
    const res = await fetch(`${BASE}/config`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function updateConfig(patch: {
  provider?: 'anthropic' | 'openai'
  model?: string
  agent_mode?: AgentMode
  anthropic_api_key?: string
  openai_api_key?: string
  portfolio?: Partial<AgentPortfolioConfig> & {
    lsp?: Partial<AgentPortfolioConfig['lsp']>
  }
  schedule?: Partial<AgentScheduleConfig>
}): Promise<{ ok: boolean; config?: AgentConfig; error?: string }> {
  try {
    const res = await fetch(`${BASE}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(5000),
    })
    return res.json()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
