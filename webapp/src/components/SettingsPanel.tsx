import { useState, useEffect } from 'react'
import { getConfig, updateConfig, AgentConfig, AgentMode } from '../api/agent'

interface Props {
  open: boolean
  onClose: () => void
}

export function SettingsPanel({ open, onClose }: Props) {
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [targets, setTargets] = useState({ BTC: '70', USDT: '20', XAUT: '10' })
  const [rebalanceThreshold, setRebalanceThreshold] = useState('5')
  const [maxSwapUsd, setMaxSwapUsd] = useState('200')
  const [minBtcReserve, setMinBtcReserve] = useState('50000')
  const [maxConcurrentOrders, setMaxConcurrentOrders] = useState('3')
  const [stopLossBtc, setStopLossBtc] = useState('30000')
  const [tradingMode, setTradingMode] = useState<'atomic' | 'rest' | 'both'>('atomic')
  const [dryRun, setDryRun] = useState(true)
  const [rebalanceIntervalSec, setRebalanceIntervalSec] = useState('300')
  const [heartbeatIntervalSec, setHeartbeatIntervalSec] = useState('300')
  const [dailySummaryCron, setDailySummaryCron] = useState('00:00')
  const [lspBalanceSat, setLspBalanceSat] = useState('2000000')
  const [clientBalanceSat, setClientBalanceSat] = useState('0')
  const [channelExpiryBlocks, setChannelExpiryBlocks] = useState('4320')
  const [minOutboundLiquiditySat, setMinOutboundLiquiditySat] = useState('200000')
  const [autoBuyChannel, setAutoBuyChannel] = useState(false)
  const [agentMode, setAgentMode] = useState<AgentMode>('mcp')
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
      setAgentMode(cfg.agent_mode ?? 'mcp')
      setApiKey('')
      setTargets({
        BTC: String(cfg.portfolio.targets.BTC ?? 0),
        USDT: String(cfg.portfolio.targets.USDT ?? 0),
        XAUT: String(cfg.portfolio.targets.XAUT ?? 0),
      })
      setRebalanceThreshold(String(cfg.portfolio.rebalance_threshold_pct))
      setMaxSwapUsd(String(cfg.portfolio.max_swap_usd))
      setMinBtcReserve(String(cfg.portfolio.min_btc_reserve_sats))
      setMaxConcurrentOrders(String(cfg.portfolio.max_concurrent_orders))
      setStopLossBtc(String(cfg.portfolio.stop_loss_btc_sats))
      setTradingMode(cfg.portfolio.trading_mode)
      setDryRun(cfg.portfolio.dry_run)
      setRebalanceIntervalSec(String(cfg.schedule.rebalance_interval_sec))
      setHeartbeatIntervalSec(String(cfg.schedule.heartbeat_interval_sec))
      setDailySummaryCron(cfg.schedule.daily_summary_cron)
      setLspBalanceSat(String(cfg.portfolio.lsp.lsp_balance_sat))
      setClientBalanceSat(String(cfg.portfolio.lsp.client_balance_sat))
      setChannelExpiryBlocks(String(cfg.portfolio.lsp.channel_expiry_blocks))
      setMinOutboundLiquiditySat(String(cfg.portfolio.lsp.min_outbound_liquidity_sat))
      setAutoBuyChannel(cfg.portfolio.lsp.auto_buy_channel)
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
    const btc = Number(targets.BTC || 0)
    const usdt = Number(targets.USDT || 0)
    const xaut = Number(targets.XAUT || 0)
    if (btc < 0 || usdt < 0 || xaut < 0) {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
      return
    }
    const targetSum = btc + usdt + xaut
    if (Math.round(targetSum) !== 100) {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
      return
    }

    setSaving(true)
    setSaveStatus('idle')
    const patch: Parameters<typeof updateConfig>[0] = {
      provider,
      model,
      agent_mode: agentMode,
      portfolio: {
        targets: {
          BTC: Number(targets.BTC || 0),
          USDT: Number(targets.USDT || 0),
          XAUT: Number(targets.XAUT || 0),
        },
        rebalance_threshold_pct: Number(rebalanceThreshold || 0),
        max_swap_usd: Number(maxSwapUsd || 0),
        min_btc_reserve_sats: Number(minBtcReserve || 0),
        max_concurrent_orders: Number(maxConcurrentOrders || 0),
        stop_loss_btc_sats: Number(stopLossBtc || 0),
        dry_run: dryRun,
        trading_mode: tradingMode,
        lsp: {
          lsp_balance_sat: Number(lspBalanceSat || 0),
          client_balance_sat: Number(clientBalanceSat || 0),
          channel_expiry_blocks: Number(channelExpiryBlocks || 0),
          min_outbound_liquidity_sat: Number(minOutboundLiquiditySat || 0),
          auto_buy_channel: autoBuyChannel,
        },
      },
      schedule: {
        rebalance_interval_sec: Number(rebalanceIntervalSec || 0),
        heartbeat_interval_sec: Number(heartbeatIntervalSec || 0),
        daily_summary_cron: dailySummaryCron,
      },
    }
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

          {/* Agent Mode */}
          <div>
            <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-2">
              Agent Mode
            </p>
            <div className="flex gap-2">
              {(['mcp', 'skill'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setAgentMode(m)}
                  className={`flex-1 py-1.5 px-3 rounded text-xs font-mono font-semibold transition-all border ${
                    agentMode === m
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                      : 'bg-white/[0.02] border-white/5 text-gray-500 hover:text-gray-300 hover:border-white/10'
                  }`}
                >
                  {m === 'mcp' ? 'MCP' : 'Skill (CLI)'}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-700 mt-1 font-mono">
              {agentMode === 'mcp' ? 'Uses MCP servers with 60+ tools' : 'Uses kaleido CLI via skill files'}
            </p>
          </div>

          <div>
            <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-2">
              Portfolio Targets
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(['BTC', 'USDT', 'XAUT'] as const).map((asset) => (
                <label key={asset} className="space-y-1">
                  <span className="block text-[10px] font-mono text-gray-500">{asset}</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={targets[asset]}
                    onChange={(e) => setTargets((prev) => ({ ...prev, [asset]: e.target.value }))}
                    className="w-full bg-white/[0.03] border border-white/10 rounded px-3 py-2 text-xs font-mono text-gray-300"
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-2">
              Risk Rules
            </p>
            <div className="space-y-2">
              <ConfigField label="rebalance threshold %" value={rebalanceThreshold} onChange={setRebalanceThreshold} />
              <ConfigField label="max swap usd" value={maxSwapUsd} onChange={setMaxSwapUsd} />
              <ConfigField label="min btc reserve sats" value={minBtcReserve} onChange={setMinBtcReserve} />
              <ConfigField label="max concurrent orders" value={maxConcurrentOrders} onChange={setMaxConcurrentOrders} />
              <ConfigField label="stop loss btc sats" value={stopLossBtc} onChange={setStopLossBtc} />
            </div>
          </div>

          <div>
            <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-2">
              Strategy
            </p>
            <select
              value={tradingMode}
              onChange={(e) => setTradingMode(e.target.value as typeof tradingMode)}
              className="w-full bg-white/[0.03] border border-white/10 rounded px-3 py-2 text-xs font-mono text-gray-300"
            >
              <option value="atomic">atomic</option>
              <option value="rest">rest</option>
              <option value="both">both</option>
            </select>
          </div>

          <div>
            <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-2">
              Execution
            </p>
            <label className="flex items-center justify-between rounded border border-white/10 bg-white/[0.03] px-3 py-2">
              <div>
                <p className="text-xs font-mono text-gray-300">{dryRun ? 'Dry Run' : 'Live Trading'}</p>
                <p className="text-[10px] font-mono text-gray-600">
                  {dryRun ? 'Quotes and plans only' : 'Confirmed swaps and channel actions can execute'}
                </p>
              </div>
              <input
                type="checkbox"
                checked={!dryRun}
                onChange={(e) => setDryRun(!e.target.checked)}
                className="h-4 w-4 accent-emerald-500"
              />
            </label>
          </div>

          <div>
            <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-2">
              Schedule
            </p>
            <p className="mb-2 text-[10px] font-mono text-gray-700">
              Stored for reference, but loops only run when launched manually from the dashboard.
            </p>
            <div className="space-y-2">
              <ConfigField label="rebalance interval sec" value={rebalanceIntervalSec} onChange={setRebalanceIntervalSec} />
              <ConfigField label="heartbeat interval sec" value={heartbeatIntervalSec} onChange={setHeartbeatIntervalSec} />
              <ConfigField label="daily summary time" value={dailySummaryCron} onChange={setDailySummaryCron} placeholder="00:00" />
            </div>
          </div>

          <div>
            <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-2">
              Channel Buy
            </p>
            <div className="space-y-2">
              <ConfigField label="lsp balance sat" value={lspBalanceSat} onChange={setLspBalanceSat} />
              <ConfigField label="client balance sat" value={clientBalanceSat} onChange={setClientBalanceSat} />
              <ConfigField label="expiry blocks" value={channelExpiryBlocks} onChange={setChannelExpiryBlocks} />
              <ConfigField label="min outbound sats" value={minOutboundLiquiditySat} onChange={setMinOutboundLiquiditySat} />
              <label className="flex items-center justify-between rounded border border-white/10 bg-white/[0.03] px-3 py-2">
                <span className="text-[10px] font-mono text-gray-400">auto buy channel</span>
                <input
                  type="checkbox"
                  checked={autoBuyChannel}
                  onChange={(e) => setAutoBuyChannel(e.target.checked)}
                  className="h-4 w-4 accent-emerald-500"
                />
              </label>
            </div>
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
            Chat picks this up immediately. Manual loop runs use it the next time you press Run.
          </p>
        </div>
      </div>
    </div>
  )
}

function ConfigField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] font-mono text-gray-500">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white/[0.03] border border-white/10 rounded px-3 py-2 text-xs font-mono text-gray-300"
      />
    </label>
  )
}
