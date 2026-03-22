import { useMemo, useState } from 'react'
import { AgentStatus, LoopType, RecentRun, TraceStep } from '../api/agent'
import { ConnectionState } from '../hooks/useAgentStatus'
import { LoopCard } from './LoopCard'
import { WalletCard } from './WalletCard'

interface Props {
  status: AgentStatus | null
  connection: ConnectionState
  runningLoop: LoopType | null
  runError: string | null
  onRunLoop: (loop: LoopType) => void
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
      <div className="flex items-center justify-between text-[11px] font-mono">
        <span className="text-gray-400">{asset}</span>
        <div className="flex items-center gap-2">
          <span className={`${isOver ? 'text-orange-400' : isUnder ? 'text-blue-400' : 'text-gray-500'}`}>
            {pct.toFixed(0)}%
          </span>
          <span className="text-gray-700">/ {target}%</span>
        </div>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  )
}

function OfflinePlaceholder() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/5 bg-white/[0.03]">
        <span className="text-2xl">🤖</span>
      </div>
      <div className="space-y-1">
        <p className="text-sm text-gray-400">Agent offline</p>
        <p className="text-xs font-mono leading-relaxed text-gray-600">node kaleidoagent/dist/index.js</p>
      </div>
    </div>
  )
}

function iconForSkill(skill: string): string {
  switch (skill) {
    case 'portfolio-manager':
    case 'dca':
    case 'kaleidoswap':
    case 'mpp':
      return '⟳'
    case 'channel-manager':
    case 'wallet-assistant':
    case 'node-manager':
    case 'cross-l2':
      return '♥'
    case 'kaleidoagent':
      return '☀'
    default:
      return '•'
  }
}

function ToolTraceRow({ step }: { step: Extract<TraceStep, { type: 'tool' }> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-1">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-left text-[10px] font-mono"
      >
        <span className={step.error ? 'text-red-400' : 'text-emerald-400'}>{step.error ? '✗' : '✓'}</span>
        <span className="text-orange-300">{step.name}</span>
        <span className="flex-1 truncate text-gray-600">{step.input}</span>
        <span className="text-gray-700">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="ml-4 space-y-1 border-l border-white/[0.06] pl-3">
          <p className="break-all text-[10px] font-mono text-gray-600">in: {step.input}</p>
          <p className={`break-all text-[10px] font-mono ${step.error ? 'text-red-400/80' : 'text-gray-500'}`}>
            out: {step.result}
          </p>
        </div>
      )}
    </div>
  )
}

function RunDetailModal({
  run,
  title,
  onClose,
}: {
  run: RecentRun
  title: string
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-[#0d0d0d] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-gray-200">{title}</p>
            <p className="mt-1 text-[10px] font-mono text-gray-600">
              {new Date(run.timestamp).toLocaleString()} · {run.duration_ms}ms · {run.tool_calls} tools · ${run.cost_usd.toFixed(4)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-lg leading-none text-gray-500 transition-colors hover:text-gray-300"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <section>
            <p className="mb-2 text-[10px] font-mono uppercase tracking-widest text-gray-600">Final Output</p>
            <pre className="whitespace-pre-wrap overflow-x-auto rounded-xl border border-white/5 bg-black/30 p-4 text-[11px] leading-relaxed text-gray-300">
              {run.final_response || run.response_preview}
            </pre>
          </section>

          <section>
            <p className="mb-2 text-[10px] font-mono uppercase tracking-widest text-gray-600">Trace</p>
            {run.trace.length === 0 ? (
              <p className="text-[11px] font-mono text-gray-700">No trace captured for this run.</p>
            ) : (
              <div className="space-y-2 rounded-xl border border-white/5 bg-black/20 p-4">
                {run.trace.map((step, index) =>
                  step.type === 'thinking' ? (
                    <div key={index} className="flex gap-2">
                      <span className="text-[9px] font-mono text-gray-700">🤔</span>
                      <p className="text-[11px] italic leading-relaxed text-gray-500">{step.text}</p>
                    </div>
                  ) : (
                    <ToolTraceRow key={index} step={step} />
                  ),
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

export function Sidebar({ status, connection, runningLoop, runError, onRunLoop }: Props) {
  const [selectedRun, setSelectedRun] = useState<RecentRun | null>(null)
  const taskNames = useMemo(
    () => Object.fromEntries((status?.tasks ?? []).map((task) => [task.id, task.name])),
    [status?.tasks],
  )
  const latestRunByTask = useMemo(
    () => Object.fromEntries((status?.recent_runs ?? []).map((run) => [run.loop, run])),
    [status?.recent_runs],
  )

  if (connection === 'offline' || !status) {
    return (
      <aside className="w-72 shrink-0 flex flex-col border-r border-white/5 bg-[#0d0d0d] overflow-y-auto">
        <OfflinePlaceholder />
      </aside>
    )
  }

  const snapshot = status.portfolio_snapshot
  const targets = status.portfolio_targets
  const activeLoops = new Set(status.active_loops)

  return (
    <aside className="w-72 shrink-0 flex flex-col border-r border-white/5 bg-[#0d0d0d] overflow-y-auto">
      <div className="flex-1 space-y-5 p-4">
        <section>
          <h2 className="mb-3 text-[10px] font-mono uppercase tracking-widest text-gray-600">Portfolio</h2>
          {snapshot?.total_usdt !== null && snapshot?.total_usdt !== undefined && (
            <p className="mb-3 text-[11px] font-mono text-gray-500">total ${snapshot.total_usdt.toFixed(2)}</p>
          )}
          <div className="space-y-3">
            {Object.entries(targets).map(([asset, target]) => {
              const currentPct = snapshot?.assets?.[asset]?.pct
              return (
                <AllocationBar
                  key={asset}
                  asset={asset}
                  pct={typeof currentPct === 'number' ? currentPct : target}
                  target={typeof snapshot?.assets?.[asset]?.target_pct === 'number' ? snapshot.assets[asset].target_pct! : target}
                />
              )
            })}
          </div>
          {!snapshot && (
            <p className="mt-3 text-[10px] font-mono text-gray-700">Waiting for the first structured portfolio report.</p>
          )}
        </section>

        <div className="border-t border-white/5" />

        <section>
          <h2 className="mb-3 text-[10px] font-mono uppercase tracking-widest text-gray-600">Wallets</h2>
          <WalletCard snapshot={status.wallet_snapshot ?? null} />
        </section>

        <div className="border-t border-white/5" />

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[10px] font-mono uppercase tracking-widest text-gray-600">Agent Tasks</h2>
            <span className="text-[10px] font-mono uppercase tracking-widest text-orange-400/80">manual only</span>
          </div>
          {runError && <p className="mb-2 text-[10px] font-mono text-red-400/80">{runError}</p>}
          <div className="space-y-2">
            {(status.tasks ?? []).map((task) => (
              <LoopCard
                key={task.id}
                name={task.name}
                icon={iconForSkill(task.skill)}
                stats={status.loops[task.id]}
                isRunning={runningLoop === task.id || activeLoops.has(task.id)}
                disabled={runningLoop !== null && runningLoop !== task.id}
                onRun={() => onRunLoop(task.id)}
                onOpen={latestRunByTask[task.id] ? () => setSelectedRun(latestRunByTask[task.id]) : undefined}
              />
            ))}
          </div>
        </section>

        <div className="border-t border-white/5" />

        <section>
          <h2 className="mb-3 text-[10px] font-mono uppercase tracking-widest text-gray-600">API Usage</h2>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center">
              <p className="text-sm font-mono font-semibold text-orange-400">${status.cumulative_cost_usd.toFixed(3)}</p>
              <p className="mt-0.5 text-[10px] text-gray-600">cost</p>
            </div>
            <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center">
              <p className="text-sm font-mono font-semibold text-gray-300">{(status.cumulative_input_tokens / 1000).toFixed(1)}k</p>
              <p className="mt-0.5 text-[10px] text-gray-600">in</p>
            </div>
            <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center">
              <p className="text-sm font-mono font-semibold text-gray-300">{(status.cumulative_output_tokens / 1000).toFixed(1)}k</p>
              <p className="mt-0.5 text-[10px] text-gray-600">out</p>
            </div>
          </div>
        </section>

        {status.recent_runs.length > 0 && (
          <>
            <div className="border-t border-white/5" />
            <section>
              <h2 className="mb-3 text-[10px] font-mono uppercase tracking-widest text-gray-600">Recent Runs</h2>
              <div className="space-y-1">
                {status.recent_runs.slice(0, 8).map((run, index) => (
                  <button
                    key={index}
                    onClick={() => setSelectedRun(run)}
                    className="flex w-full items-center justify-between py-1 text-[10px] font-mono text-gray-600 transition-colors hover:text-gray-300"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-blue-400/60">{(taskNames[run.loop] ?? run.loop).slice(0, 10)}</span>
                      <span className="text-gray-700">{run.tool_calls}t</span>
                    </div>
                    <span>{Math.round(run.duration_ms / 1000)}s</span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
      {selectedRun && (
        <RunDetailModal
          run={selectedRun}
          title={taskNames[selectedRun.loop] ?? selectedRun.loop}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </aside>
  )
}
