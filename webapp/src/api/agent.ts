const BASE = '/api/agent'

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
  response_preview: string
}

export interface AgentStatus {
  running: boolean
  uptime_sec: number
  dry_run: boolean
  model: string
  portfolio_targets: Record<string, number>
  cumulative_cost_usd: number
  cumulative_input_tokens: number
  cumulative_output_tokens: number
  loops: {
    rebalance: LoopStats
    heartbeat: LoopStats
    daily_summary: LoopStats
  }
  recent_runs: RecentRun[]
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

export interface ChatResponse {
  text: string
  action: ChatAction
  tool_calls: ToolCallTrace[]
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

// ─── Config API ───

export interface ModelOption {
  id: string
  label: string
}

export interface AgentConfig {
  provider: 'anthropic' | 'openai'
  model: string
  has_anthropic_key: boolean
  has_openai_key: boolean
  anthropic_models: ModelOption[]
  openai_models: ModelOption[]
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
  anthropic_api_key?: string
  openai_api_key?: string
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
