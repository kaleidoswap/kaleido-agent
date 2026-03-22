/**
 * ConfigStore — runtime config (provider, model, API keys).
 * Changes apply live without restart; managed values are persisted to .env.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { AIProviderName } from './providers/index.js'
import type { AgentMode } from './agent-config-store.js'

export interface RuntimeConfig {
  provider: AIProviderName
  model: string
  anthropicApiKey: string
  openaiApiKey: string
}

export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-4-5',           label: 'claude-opus-4-5 · Most capable' },
  { id: 'claude-sonnet-4-6',         label: 'claude-sonnet-4-6 · Balanced' },
  { id: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5 · Fast & cheap' },
]

export const OPENAI_MODELS = [
  { id: 'gpt-4o',      label: 'gpt-4o · Most capable' },
  { id: 'gpt-4o-mini', label: 'gpt-4o-mini · Fast & cheap' },
  { id: 'o3-mini',     label: 'o3-mini · Reasoning' },
]

const MANAGED_ENV_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'AGENT_PROVIDER',
  'AGENT_MODEL',
])

class ConfigStore {
  private _provider: AIProviderName = 'anthropic'
  private _model = 'claude-sonnet-4-6'
  private _anthropicApiKey = ''
  private _openaiApiKey = ''
  private _envPath = ''
  agentMode: AgentMode = 'mcp'

  init(envPath: string, initialModel: string) {
    this._envPath = envPath
    this._anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? ''
    this._openaiApiKey = process.env.OPENAI_API_KEY ?? ''
    this._model = process.env.AGENT_MODEL ?? initialModel

    // Detect provider from env
    const providerEnv = process.env.AGENT_PROVIDER as AIProviderName | undefined
    if (providerEnv === 'openai' || providerEnv === 'anthropic') {
      this._provider = providerEnv
    }
  }

  get provider(): AIProviderName { return this._provider }
  get model(): string { return this._model }
  get anthropicApiKey(): string { return this._anthropicApiKey }
  get openaiApiKey(): string { return this._openaiApiKey }

  getPublicConfig() {
    return {
      provider: this._provider,
      model: this._model,
      has_anthropic_key: this._anthropicApiKey.length > 0,
      has_openai_key: this._openaiApiKey.length > 0,
      anthropic_models: ANTHROPIC_MODELS,
      openai_models: OPENAI_MODELS,
    }
  }

  update(patch: {
    provider?: AIProviderName
    model?: string
    anthropic_api_key?: string
    openai_api_key?: string
  }): void {
    if (patch.provider) this._provider = patch.provider
    if (patch.model) this._model = patch.model
    process.env.AGENT_PROVIDER = this._provider
    process.env.AGENT_MODEL = this._model
    if (patch.anthropic_api_key !== undefined) {
      this._anthropicApiKey = patch.anthropic_api_key
      process.env.ANTHROPIC_API_KEY = patch.anthropic_api_key
    }
    if (patch.openai_api_key !== undefined) {
      this._openaiApiKey = patch.openai_api_key
      process.env.OPENAI_API_KEY = patch.openai_api_key
    }
    this.writeEnv()
  }

  private writeEnv(): void {
    if (!this._envPath) return
    const lines: string[] = []
    try {
      const existing = readFileSync(this._envPath, 'utf8')
      for (const line of existing.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        if (trimmed.startsWith('#')) {
          lines.push(line)
          continue
        }
        const key = trimmed.split('=')[0]
        if (!MANAGED_ENV_KEYS.has(key)) {
          lines.push(line)
        }
      }
    } catch {
      // No existing .env file to preserve.
    }

    if (this._anthropicApiKey) lines.push(`ANTHROPIC_API_KEY=${this._anthropicApiKey}`)
    if (this._openaiApiKey) lines.push(`OPENAI_API_KEY=${this._openaiApiKey}`)
    lines.push(`AGENT_PROVIDER=${this._provider}`)
    lines.push(`AGENT_MODEL=${this._model}`)
    try {
      writeFileSync(this._envPath, lines.join('\n') + '\n', 'utf8')
    } catch (err) {
      process.stderr.write(`[config-store] WARNING: failed to write .env: ${err instanceof Error ? err.message : String(err)}\n`)
    }
  }
}

export const configStore = new ConfigStore()
