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

type Color = 'orange' | 'emerald' | 'blue'

interface Props {
  name: string
  icon: string
  color?: Color
  stats?: LoopStats
  isRunning?: boolean
  onRun?: () => void
  disabled?: boolean
  onOpen?: () => void
}

const COLOR: Record<Color, { dot: string; border: string; bg: string; badge: string; btn: string }> = {
  orange: {
    dot: 'bg-orange-400',
    border: 'border-orange-500/30',
    bg: 'bg-orange-500/5',
    badge: 'bg-orange-500/15 text-orange-400',
    btn: 'border-orange-500/30 bg-orange-500/10 text-orange-300 hover:bg-orange-500/25',
  },
  emerald: {
    dot: 'bg-emerald-400',
    border: 'border-emerald-500/30',
    bg: 'bg-emerald-500/5',
    badge: 'bg-emerald-500/15 text-emerald-400',
    btn: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/25',
  },
  blue: {
    dot: 'bg-blue-400',
    border: 'border-blue-500/30',
    bg: 'bg-blue-500/5',
    badge: 'bg-blue-500/15 text-blue-400',
    btn: 'border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/25',
  },
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function formatDuration(ms: number | null): string {
  if (ms === null) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function LoopCard({
  name,
  icon,
  color = 'orange',
  stats: statsProp,
  isRunning = false,
  onRun,
  disabled = false,
  onOpen,
}: Props) {
  const stats = statsProp ?? EMPTY_STATS
  const c = COLOR[color]
  const hasError = !!stats.last_error
  const hasRun = stats.runs > 0

  const containerClass = hasError
    ? 'border-red-500/25 bg-red-500/5'
    : isRunning
    ? `${c.border} ${c.bg}`
    : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.035]'

  return (
    <div className={`rounded-lg border p-2.5 transition-all ${containerClass}`}>

      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-all ${
            isRunning ? `${c.dot} animate-pulse` : hasError ? 'bg-red-400' : hasRun ? c.dot : 'bg-gray-700'
          }`} />
          <span className="text-[11px] font-mono text-gray-200 font-medium truncate">{icon} {name}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {hasError && (
            <span className="text-[9px] font-mono text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 rounded">
              error
            </span>
          )}
          {isRunning && (
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${c.badge}`}>
              running
            </span>
          )}
          {hasRun && !isRunning && (
            <span className="text-[10px] font-mono text-gray-700">×{stats.runs}</span>
          )}
          {onOpen && (stats.last_response || hasError) && (
            <button
              onClick={onOpen}
              className="text-[10px] font-mono rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-gray-500 hover:text-gray-300 transition-colors"
            >
              view
            </button>
          )}
          {onRun && (
            <button
              onClick={onRun}
              disabled={disabled || isRunning}
              className={`text-[10px] uppercase tracking-wide font-mono rounded border px-2 py-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${c.btn}`}
            >
              {isRunning ? '…' : 'run'}
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      {(hasRun || isRunning) && (
        <div className="mt-1.5 flex items-center gap-3 text-[10px] font-mono text-gray-600">
          <span>{timeAgo(stats.last_run_at)}</span>
          {stats.last_duration_ms !== null && <span>{formatDuration(stats.last_duration_ms)}</span>}
          {stats.last_tool_calls !== null && stats.last_tool_calls > 0 && (
            <span>{stats.last_tool_calls} tools</span>
          )}
        </div>
      )}

      {/* Response preview */}
      {stats.last_response && !hasError && (
        <p className="mt-1.5 text-[10px] text-gray-700 leading-relaxed line-clamp-2 font-mono">
          {stats.last_response.slice(0, 120)}{stats.last_response.length > 120 ? '…' : ''}
        </p>
      )}

      {/* Error */}
      {hasError && (
        <p className="mt-1.5 text-[10px] text-red-400/80 font-mono line-clamp-2">
          ✗ {stats.last_error}
        </p>
      )}
    </div>
  )
}
