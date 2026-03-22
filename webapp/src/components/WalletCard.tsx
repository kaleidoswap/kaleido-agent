import { useState, useEffect } from 'react'
import { WalletSnapshot, RgbAssetBalance, refreshWallet } from '../api/agent'

interface Props {
  snapshot: WalletSnapshot | null
}

function satsToBtc(sats: number): string {
  if (sats === 0) return '0'
  if (sats < 1000) return `${sats} sat`
  if (sats < 1_000_000) return `${(sats / 1000).toFixed(1)}k sat`
  return `${(sats / 1e8).toFixed(6)} BTC`
}

function formatAssetAmount(raw: number, precision: number): string {
  if (raw === 0) return '0'
  const value = raw / Math.pow(10, precision)
  return value >= 1000
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : value.toFixed(Math.min(precision, 6))
}

function AssetRow({ asset }: { asset: RgbAssetBalance }) {
  const fmt = (n: number) => formatAssetAmount(n, asset.precision)
  const hasLn = asset.offchain_outbound > 0 || asset.offchain_inbound > 0
  return (
    <div className="pt-1.5 border-t border-white/5 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest">{asset.ticker}</span>
        <span className="text-[11px] font-mono text-gray-300 font-medium">{fmt(asset.spendable)}</span>
      </div>
      {hasLn && (
        <div className="flex justify-between text-[10px] font-mono text-gray-600">
          <span>
            <span className="text-emerald-400/70">↑ {fmt(asset.offchain_outbound)}</span>
            <span className="mx-1 text-gray-700">/</span>
            <span className="text-blue-400/70">↓ {fmt(asset.offchain_inbound)}</span>
          </span>
          <span className="text-gray-700">LN</span>
        </div>
      )}
    </div>
  )
}

function LiquidityBar({ label, outbound, inbound }: { label: string; outbound: number; inbound: number }) {
  const total = outbound + inbound
  if (total === 0) return null
  const outPct = Math.round((outbound / total) * 100)

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] font-mono text-gray-600">
        <span>
          <span className="text-emerald-400/80">↑ {satsToBtc(outbound)}</span>
          <span className="mx-1 text-gray-700">/</span>
          <span className="text-blue-400/80">↓ {satsToBtc(inbound)}</span>
        </span>
        <span className="text-gray-700">{label}</span>
      </div>
      <div className="h-1 rounded-full overflow-hidden bg-blue-500/20">
        <div
          className="h-full rounded-full bg-emerald-500/60 transition-all duration-500"
          style={{ width: `${outPct}%` }}
        />
      </div>
    </div>
  )
}

export function WalletCard({ snapshot: propSnapshot }: Props) {
  // localSnapshot holds a manually-refreshed result; cleared when parent polling updates
  const [localSnapshot, setLocalSnapshot] = useState<WalletSnapshot | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => { setLocalSnapshot(null) }, [propSnapshot])

  const snapshot = localSnapshot ?? propSnapshot

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const fresh = await refreshWallet()
      if (fresh) setLocalSnapshot(fresh)
    } finally {
      setRefreshing(false)
    }
  }

  if (!snapshot) {
    return (
      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
        <p className="text-[10px] font-mono text-gray-700">
          Wallet data not yet available. Agent fetches on startup.
        </p>
      </div>
    )
  }

  const age = snapshot.fetched_at
    ? Math.floor((Date.now() - new Date(snapshot.fetched_at).getTime()) / 1000)
    : null

  return (
    <div className="space-y-2">
      {/* RLN */}
      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono font-semibold text-gray-400 uppercase tracking-wider">
            RLN
          </span>
          <div className="flex items-center gap-2">
            {snapshot.rln === null && (
              <span className="text-[10px] font-mono text-gray-700">offline</span>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={`text-[11px] font-mono transition-colors disabled:opacity-40 ${refreshing ? 'text-gray-500 animate-spin' : 'text-gray-600 hover:text-gray-300'}`}
              title="Refresh wallet"
            >
              ↻
            </button>
          </div>
        </div>

        {snapshot.rln && (
          <>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Stat label="on-chain" value={satsToBtc(snapshot.rln.btc_onchain_sats)} />
              <Stat label="lightning" value={satsToBtc(snapshot.rln.lightning_balance_sat)} />
              <Stat label="channels" value={String(snapshot.rln.channel_count)} />
            </div>
            {(snapshot.rln.total_outbound_sat + snapshot.rln.total_inbound_sat) > 0 && (
              <LiquidityBar
                label="liquidity"
                outbound={snapshot.rln.total_outbound_sat}
                inbound={snapshot.rln.total_inbound_sat}
              />
            )}
            {snapshot.rln.assets?.map((asset) => (
              <AssetRow key={asset.asset_id} asset={asset} />
            ))}
          </>
        )}
      </div>

      {/* Spark */}
      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono font-semibold text-gray-400 uppercase tracking-wider">
            Spark L2
          </span>
          {snapshot.spark === null && (
            <span className="text-[10px] font-mono text-gray-700">offline</span>
          )}
          {snapshot.spark !== null && (
            <span className="text-[10px] font-mono text-emerald-400/60">fee-free</span>
          )}
        </div>

        {snapshot.spark && (
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-mono font-bold text-gray-200">
              {satsToBtc(snapshot.spark.balance_sats)}
            </span>
            <span className="text-[10px] font-mono text-gray-600">
              {snapshot.spark.balance_sats.toLocaleString()} sat
            </span>
          </div>
        )}
      </div>

      {/* Footer: age + error */}
      <div className="flex items-center justify-between px-0.5">
        {snapshot.error && (
          <p className="text-[10px] font-mono text-red-400/70 truncate">{snapshot.error.slice(0, 50)}</p>
        )}
        {age !== null && !snapshot.error && (
          <p className="text-[10px] font-mono text-gray-700 ml-auto">
            {age < 60 ? `${age}s ago` : `${Math.floor(age / 60)}m ago`}
          </p>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-mono text-gray-600 uppercase tracking-widest">{label}</p>
      <p className="text-[11px] font-mono text-gray-300 font-medium truncate">{value}</p>
    </div>
  )
}
