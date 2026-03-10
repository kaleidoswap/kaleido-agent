import { AgentStatus } from '../api/agent'
import { ConnectionState } from '../hooks/useAgentStatus'
import { LoopCard } from './LoopCard'

interface Props {
  status: AgentStatus | null
  connection: ConnectionState
}

function AllocationBar({ asset, pct, target }: { asset: string; pct: number; target: number }) {
  const isOver = pct > target + 5
  const isUnder = pct < target - 5

  const color = isOver
    ? 'bg-orange-500'
    : isUnder
    ? 'bg-blue-500'
    : 'bg-emerald-500'

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-[11px] font-mono">
        <span className="text-gray-400">{asset}</span>
        <div className="flex items-center gap-2">
          <span
            className={`${isOver ? 'text-orange-400' : isUnder ? 'text-blue-400' : 'text-gray-500'}`}
          >
            {pct.toFixed(0)}%
          </span>
          <span className="text-gray-700">/ {target}%</span>
        </div>
      </div>
      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  )
}

// Offline placeholder
function OfflinePlaceholder() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-4">
      <div className="w-12 h-12 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-center">
        <span className="text-2xl">🤖</span>
      </div>
      <div className="space-y-1">
        <p className="text-sm text-gray-400">Agent offline</p>
        <p className="text-xs text-gray-600 font-mono leading-relaxed">
          node kaleidoagent/dist/index.js
        </p>
      </div>
    </div>
  )
}

export function Sidebar({ status, connection }: Props) {
  if (connection === 'offline' || !status) {
    return (
      <aside className="w-72 shrink-0 flex flex-col border-r border-white/5 bg-[#0d0d0d] overflow-y-auto">
        <OfflinePlaceholder />
      </aside>
    )
  }

  // Placeholder visualization: current allocation mirrors target values.
  const targets = status.portfolio_targets

  return (
    <aside className="w-72 shrink-0 flex flex-col border-r border-white/5 bg-[#0d0d0d] overflow-y-auto">
      <div className="flex-1 space-y-5 p-4">

        {/* Portfolio targets */}
        <section>
          <h2 className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-3">
            Portfolio Targets
          </h2>
          <div className="space-y-3">
            {Object.entries(targets).map(([asset, pct]) => (
              <AllocationBar
                key={asset}
                asset={asset}
                pct={pct}
                target={pct}
              />
            ))}
          </div>
        </section>

        {/* Divider */}
        <div className="border-t border-white/5" />

        {/* Agent loops */}
        <section>
          <h2 className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-3">
            Agent Loops
          </h2>
          <div className="space-y-2">
            <LoopCard
              name="rebalance"
              icon="⟳"
              stats={status.loops.rebalance}
            />
            <LoopCard
              name="heartbeat"
              icon="♥"
              stats={status.loops.heartbeat}
            />
            <LoopCard
              name="daily summary"
              icon="☀"
              stats={status.loops.daily_summary}
            />
          </div>
        </section>

        {/* Divider */}
        <div className="border-t border-white/5" />

        {/* Cost tracker */}
        <section>
          <h2 className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-3">
            API Usage
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/[0.02] border border-white/5 rounded-lg p-2 text-center">
              <p className="text-orange-400 text-sm font-mono font-semibold">
                ${status.cumulative_cost_usd.toFixed(3)}
              </p>
              <p className="text-[10px] text-gray-600 mt-0.5">cost</p>
            </div>
            <div className="bg-white/[0.02] border border-white/5 rounded-lg p-2 text-center">
              <p className="text-gray-300 text-sm font-mono font-semibold">
                {(status.cumulative_input_tokens / 1000).toFixed(1)}k
              </p>
              <p className="text-[10px] text-gray-600 mt-0.5">in</p>
            </div>
            <div className="bg-white/[0.02] border border-white/5 rounded-lg p-2 text-center">
              <p className="text-gray-300 text-sm font-mono font-semibold">
                {(status.cumulative_output_tokens / 1000).toFixed(1)}k
              </p>
              <p className="text-[10px] text-gray-600 mt-0.5">out</p>
            </div>
          </div>
        </section>

        {/* Recent runs */}
        {status.recent_runs.length > 0 && (
          <>
            <div className="border-t border-white/5" />
            <section>
              <h2 className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-3">
                Recent Runs
              </h2>
              <div className="space-y-1">
                {status.recent_runs.slice(-8).reverse().map((run, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-[10px] font-mono text-gray-600 py-0.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          run.loop === 'rebalance'
                            ? 'text-orange-400/60'
                            : run.loop === 'heartbeat'
                            ? 'text-emerald-400/60'
                            : 'text-blue-400/60'
                        }
                      >
                        {run.loop.slice(0, 5)}
                      </span>
                      <span className="text-gray-700">{run.tool_calls}t</span>
                    </div>
                    <span>${run.cost_usd.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </aside>
  )
}
