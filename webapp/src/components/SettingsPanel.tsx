import { useState, useEffect } from 'react'
import { getConfig, updateConfig, AgentConfig } from '../api/agent'

interface Props {
  open: boolean
  onClose: () => void
}

export function SettingsPanel({ open, onClose }: Props) {
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  useEffect(() => {
    if (!open) return
    getConfig().then((cfg) => {
      if (!cfg) return
      setConfig(cfg)
      setProvider(cfg.provider)
      setModel(cfg.model)
      setApiKey('')
    })
  }, [open])

  const models = provider === 'anthropic'
    ? (config?.anthropic_models ?? [])
    : (config?.openai_models ?? [])

  const hasKey = provider === 'anthropic'
    ? config?.has_anthropic_key
    : config?.has_openai_key

  const handleProviderSwitch = (p: 'anthropic' | 'openai') => {
    setProvider(p)
    setApiKey('')
    setShowKey(false)
    // pre-select first model for the new provider
    const mlist = p === 'anthropic'
      ? (config?.anthropic_models ?? [])
      : (config?.openai_models ?? [])
    if (mlist.length > 0) setModel(mlist[0].id)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus('idle')
    const patch: Parameters<typeof updateConfig>[0] = { provider, model }
    if (apiKey.trim()) {
      if (provider === 'anthropic') patch.anthropic_api_key = apiKey.trim()
      else patch.openai_api_key = apiKey.trim()
    }
    const result = await updateConfig(patch)
    setSaving(false)
    if (result.ok) {
      setSaveStatus('saved')
      if (result.config) setConfig(result.config)
      setApiKey('')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } else {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-80 h-full bg-[#0d0d0d] border-l border-white/5 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <span className="text-sm font-semibold text-white font-mono tracking-wide">Settings</span>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Provider tabs */}
          <div>
            <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-2">
              AI Provider
            </p>
            <div className="flex gap-2">
              {(['anthropic', 'openai'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => handleProviderSwitch(p)}
                  className={`flex-1 py-1.5 px-3 rounded text-xs font-mono font-semibold transition-all border ${
                    provider === p
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                      : 'bg-white/[0.02] border-white/5 text-gray-500 hover:text-gray-300 hover:border-white/10'
                  }`}
                >
                  {p === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">
                API Key
              </p>
              {hasKey && (
                <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  saved
                </span>
              )}
            </div>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
                className="w-full bg-white/[0.03] border border-white/10 rounded px-3 py-2 text-xs font-mono text-gray-300 placeholder-gray-700 focus:outline-none focus:border-emerald-500/40 pr-10"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 text-[11px] font-mono"
              >
                {showKey ? 'hide' : 'show'}
              </button>
            </div>
            <p className="text-[10px] text-gray-700 mt-1 font-mono">
              {hasKey ? 'Leave blank to keep existing key' : 'Enter your API key to enable the agent'}
            </p>
          </div>

          {/* Model selector */}
          <div>
            <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-2">
              Model
            </p>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/10 rounded px-3 py-2 text-xs font-mono text-gray-300 focus:outline-none focus:border-emerald-500/40 appearance-none cursor-pointer"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id} className="bg-[#1a1a1a]">
                  {m.label}
                </option>
              ))}
              {models.length === 0 && (
                <option value={model}>{model}</option>
              )}
            </select>
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full py-2 rounded text-xs font-mono font-semibold transition-all ${
              saveStatus === 'saved'
                ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400'
                : saveStatus === 'error'
                ? 'bg-red-500/20 border border-red-500/40 text-red-400'
                : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50'
            }`}
          >
            {saving ? 'Saving...' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? 'Error — try again' : 'Save'}
          </button>
        </div>

        {/* Footer note */}
        <div className="px-5 py-3 border-t border-white/5">
          <p className="text-[10px] font-mono text-gray-700">
            Changes apply on the next agent run
          </p>
        </div>
      </div>
    </div>
  )
}
