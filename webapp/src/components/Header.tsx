import { ConnectionState } from '../hooks/useAgentStatus'
import { AgentStatus } from '../api/agent'

interface Props {
  connection: ConnectionState
  status: AgentStatus | null
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

export function Header({ connection, status }: Props) {
  return (
    <header className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-[#0d0d0d]">
      {/* Left: brand */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-sm bg-orange-500 flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1L10 4V8L6 11L2 8V4L6 1Z" fill="white" fillOpacity="0.9" />
            </svg>
          </div>
          <span className="font-semibold text-sm tracking-wide text-white">KaleidoAgent</span>
        </div>

        {/* Connection pill */}
        <div
          className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border font-mono ${
            connection === 'live'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : connection === 'connecting'
              ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'
              : 'border-red-500/30 bg-red-500/10 text-red-400'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              connection === 'live'
                ? 'bg-emerald-400 animate-pulse'
                : connection === 'connecting'
                ? 'bg-yellow-400 animate-pulse'
                : 'bg-red-400'
            }`}
          />
          {connection === 'live' ? 'LIVE' : connection === 'connecting' ? 'CONNECTING' : 'OFFLINE'}
        </div>
      </div>

      {/* Right: meta */}
      <div className="flex items-center gap-4 text-xs text-gray-500 font-mono">
        {status && (
          <>
            <span>{status.model}</span>
            <span className="text-gray-700">·</span>
            {status.dry_run && (
              <>
                <span className="text-yellow-500/80 border border-yellow-500/20 px-1.5 py-0.5 rounded text-[10px]">
                  DRY RUN
                </span>
                <span className="text-gray-700">·</span>
              </>
            )}
            <span>up {formatUptime(status.uptime_sec)}</span>
            <span className="text-gray-700">·</span>
            <span className="text-orange-400">${status.cumulative_cost_usd.toFixed(4)}</span>
          </>
        )}
        {connection === 'offline' && (
          <span className="text-gray-600">start kaleidoagent on :4242</span>
        )}
      </div>
    </header>
  )
}
