import { useEffect, useState } from 'react'
import { getConfig, updateConfig, type AgentConfig } from '../api/agent'
import { ConnectionState } from '../hooks/useAgentStatus'

const rlnUrl = 'http://localhost:3001'
const sparkNetwork = 'REGTEST'
const kaleidoUrl = 'https://api.staging.kaleidoswap.com'

interface Props {
  connection: ConnectionState
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${ok ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`}
    />
  )
}

// ─── Inline toggle ─────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? 'bg-orange-500' : 'bg-white/10'
      }`}
    >
      <span
        className={`inline-block w-4 h-4 rounded-full bg-white shadow transition-transform mt-0.5 ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

// ─── Wallet connection card ─────────────────────────────────────────────────

function WalletConnectionCard({
  icon,
  name,
  subtitle,
  badge,
  badgeColor,
  connected,
  children,
}: {
  icon: string
  name: string
  subtitle: string
  badge: string
  badgeColor: string
  connected: boolean
  children?: React.ReactNode
}) {
  return (
    <div
      className={`rounded-2xl border p-5 transition-colors ${
        connected
          ? 'border-emerald-500/20 bg-emerald-500/5'
          : 'border-white/8 bg-white/[0.02]'
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-xl">
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-200">{name}</h3>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${badgeColor}`}>
                {badge}
              </span>
            </div>
            <p className="text-[10px] font-mono text-gray-600 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot ok={connected} />
          <span className={`text-[11px] font-mono ${connected ? 'text-emerald-400' : 'text-gray-600'}`}>
            {connected ? 'connected' : 'offline'}
          </span>
        </div>
      </div>
      {children}
    </div>
  )
}

function InfoRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-white/[0.04] last:border-0">
      <span className="text-[11px] font-mono text-gray-600">{label}</span>
      <span className={`text-[11px] ${mono ? 'font-mono' : ''} text-gray-400 max-w-[60%] truncate text-right`}>
        {value}
      </span>
    </div>
  )
}

// ─── KaleidoSwap config form ─────────────────────────────────────────────────

function KaleidoConfigForm({
  config,
  disabled,
  onSaved,
}: {
  config: AgentConfig
  disabled: boolean
  onSaved: (cfg: AgentConfig) => void
}) {
  const [tradingMode, setTradingMode] = useState<'atomic' | 'rest' | 'both'>(
    config.portfolio?.trading_mode ?? 'atomic'
  )
  const [dryRun, setDryRun] = useState(config.portfolio?.dry_run ?? true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const isDirty =
    tradingMode !== config.portfolio?.trading_mode ||
    dryRun !== config.portfolio?.dry_run

  const handleSave = async () => {
    setSaving(true)
    const res = await updateConfig({ portfolio: { trading_mode: tradingMode, dry_run: dryRun } })
    setSaving(false)
    if (res.ok && res.config) {
      onSaved(res.config)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return (
    <div className="space-y-3">
      {/* Trading mode */}
      <div>
        <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-1.5">Trading mode</p>
        <div className="flex gap-1.5">
          {(['atomic', 'rest', 'both'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setTradingMode(mode)}
              disabled={disabled}
              className={`flex-1 py-1.5 rounded-lg border text-[11px] font-mono transition-colors disabled:opacity-40 ${
                tradingMode === mode
                  ? 'border-orange-500/40 bg-orange-500/15 text-orange-300'
                  : 'border-white/8 bg-white/[0.02] text-gray-500 hover:text-gray-300 hover:border-white/15'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
        <p className="text-[10px] font-mono text-gray-700 mt-1">
          {tradingMode === 'atomic' ? 'HTLC atomic swaps only (fastest, no custody)' :
           tradingMode === 'rest' ? 'REST deposit orders (fallback mode)' :
           'Try atomic first, fall back to REST'}
        </p>
      </div>

      {/* Dry run toggle */}
      <div className="flex items-center justify-between py-2 border-t border-white/5">
        <div>
          <p className="text-[11px] font-mono text-gray-300">Dry run</p>
          <p className="text-[10px] font-mono text-gray-700 mt-0.5">Simulate trades without executing</p>
        </div>
        <Toggle checked={dryRun} onChange={setDryRun} disabled={disabled} />
      </div>

      {isDirty && (
        <button
          onClick={() => void handleSave()}
          disabled={saving || disabled}
          className="w-full py-2 rounded-lg bg-orange-500 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save changes'}
        </button>
      )}
    </div>
  )
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function ConnectionsPanel({ connection }: Props) {
  const [config, setConfig] = useState<AgentConfig | null>(null)

  useEffect(() => {
    void getConfig().then((c) => {
      if (c) setConfig(c)
    })
  }, [connection])

  const isAgentLive = connection === 'live'

  return (
    <div className="p-5 space-y-5 max-w-2xl mx-auto">

      {/* ── Wallets section ── */}
      <div>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-gray-300">Wallets</h2>
          <p className="text-[11px] text-gray-600 mt-0.5 font-mono">WDK protocol adapters</p>
        </div>

        <div className="space-y-3">
          <WalletConnectionCard
            icon="⚡"
            name="WDK RLN"
            subtitle="RGB Lightning Network"
            badge="WDK"
            badgeColor="border-orange-500/30 bg-orange-500/10 text-orange-400"
            connected={isAgentLive}
          >
            <div className="space-y-0">
              <InfoRow label="node url" value={rlnUrl} />
              <InfoRow label="protocol" value="RGB-lightning-node" />
              <InfoRow label="features" value="Lightning · RGB Assets · Atomic HTLC" />
              <InfoRow label="package" value="@kaleidoswap/wdk-wallet-rln" />
            </div>
          </WalletConnectionCard>

          <WalletConnectionCard
            icon="✨"
            name="WDK Spark"
            subtitle="Spark Protocol · L2 Bitcoin"
            badge="WDK"
            badgeColor="border-purple-500/30 bg-purple-500/10 text-purple-400"
            connected={isAgentLive}
          >
            <div className="space-y-0">
              <InfoRow label="network" value={sparkNetwork} />
              <InfoRow label="protocol" value="Spark SDK" />
              <InfoRow label="features" value="Instant payments · BTC · USDT" />
              <InfoRow label="package" value="@tetherto/wdk-wallet-spark" />
            </div>
          </WalletConnectionCard>
        </div>
      </div>

      {/* ── Swap provider section ── */}
      <div className="border-t border-white/5 pt-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-gray-300">Swap Provider</h2>
          <p className="text-[11px] text-gray-600 mt-0.5 font-mono">
            KaleidoSwap via WDK SwapProtocol
          </p>
        </div>

        <WalletConnectionCard
          icon="🔄"
          name="KaleidoSwap"
          subtitle="Atomic HTLC · RGB swaps"
          badge="HTLC"
          badgeColor="border-blue-500/30 bg-blue-500/10 text-blue-400"
          connected={isAgentLive}
        >
          <div className="space-y-0 mb-4">
            <InfoRow label="api url" value={kaleidoUrl} />
            <InfoRow label="assets" value="BTC · USDT (RGB) · XAUT (RGB)" />
            <InfoRow label="package" value="@kaleidoswap/wdk-protocol-swap-kaleidoswap" />
          </div>

          {config ? (
            <KaleidoConfigForm
              config={config}
              disabled={!isAgentLive}
              onSaved={setConfig}
            />
          ) : (
            <div className="space-y-0">
              <InfoRow
                label="trading mode"
                value={isAgentLive ? '…' : 'agent offline'}
              />
            </div>
          )}
        </WalletConnectionCard>
      </div>

      {/* ── Market data section ── */}
      <div className="border-t border-white/5 pt-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-gray-300">Market Data</h2>
          <p className="text-[11px] text-gray-600 mt-0.5 font-mono">L402 / MPP premium data feeds</p>
        </div>

        <WalletConnectionCard
          icon="📡"
          name="L402 / MPP Gateway"
          subtitle="Lightning-gated market data"
          badge="MPP"
          badgeColor="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          connected={isAgentLive}
        >
          <div className="space-y-0">
            <InfoRow label="protocol" value="L402 · MPP payments" />
            <InfoRow label="data" value="Price · OHLCV · Sentiment · News" />
            <InfoRow label="auth" value="Lightning micropayments" />
            <InfoRow label="package" value="mpp-gateway-mcp" />
          </div>
        </WalletConnectionCard>
      </div>

      {!isAgentLive && (
        <div className="rounded-xl bg-orange-500/8 border border-orange-500/15 px-4 py-3">
          <p className="text-[11px] font-mono text-orange-300/80 text-center">
            Start kaleidoagent to see live connection status and configure trading settings.
          </p>
        </div>
      )}
    </div>
  )
}
