import { LoopStats } from '../api/agent'

const EMPTY_STATS: LoopStats = {
  runs: 0,
  errors: 0,
  last_run_at: null,
  last_duration_ms: null,
  last_tool_calls: null,
  last_error: null,
  last_response: null,
}

interface Props {
  name: string
  icon: string
  stats?: LoopStats
  isRunning?: boolean
  onRun?: () => void
  disabled?: boolean
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function LoopCard({ name, icon, stats: statsProp, isRunning = false, onRun, disabled = false }: Props) {
  const stats = statsProp ?? EMPTY_STATS
  const hasError = !!stats.last_error
  const hasRun = stats.runs > 0

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 transition-colors ${
        hasError
          ? 'border-red-500/20 bg-red-500/5'
          : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
      }`}
    >
      {/* Top row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <span className="text-xs font-mono text-gray-300 font-medium">{name}</span>
        </div>
        <div className="flex items-center gap-2">
          {hasError && (
            <span className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 rounded">
              error
            </span>
          )}
          {onRun && (
            <button
              onClick={onRun}
              disabled={disabled || isRunning}
              className="text-[10px] uppercase tracking-wide font-mono rounded border border-orange-500/20 bg-orange-500/10 px-2 py-0.5 text-orange-300 transition hover:bg-orange-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRunning ? 'running' : 'run'}
            </button>
          )}
          <span className="text-[11px] font-mono text-gray-600">×{stats.runs}</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between text-[11px] font-mono">
        <span className="text-gray-500">{timeAgo(stats.last_run_at)}</span>
        <div className="flex items-center gap-3 text-gray-600">
          {isRunning && <span className="text-orange-400">active</span>}
          {hasRun && (
            <>
              <span>{formatDuration(stats.last_duration_ms)}</span>
              {stats.last_tool_calls !== null && (
                <span>{stats.last_tool_calls} tools</span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Response preview */}
      {stats.last_response && (
        <p className="text-[10px] text-gray-600 leading-relaxed line-clamp-2 font-mono">
          {stats.last_response.slice(0, 140)}
          {stats.last_response.length > 140 ? '…' : ''}
        </p>
      )}

      {/* Error */}
      {hasError && (
        <p className="text-[10px] text-red-400/80 font-mono">
          ✗ {stats.last_error?.slice(0, 80)}
        </p>
      )}
    </div>
  )
}
