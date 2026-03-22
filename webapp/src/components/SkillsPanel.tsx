import { useEffect, useState } from 'react'
import { getSkills, patchSkill, type SkillInfo } from '../api/agent'
import { ConnectionState } from '../hooks/useAgentStatus'

interface Props {
  connection: ConnectionState
}

// ─── MCP definitions ──────────────────────────────────────────────────────────

interface McpInfo {
  id: string
  icon: string
  name: string
  description: string
  badge: string
  badgeColor: string
}

const MCPS: McpInfo[] = [
  {
    id: 'wdk_rln',
    icon: '⚡',
    name: 'WDK RLN',
    description: 'RGB Lightning · balances · invoices · payments · RGB assets · atomic HTLC taker',
    badge: 'WDK',
    badgeColor: 'border-orange-500/30 bg-orange-500/10 text-orange-400',
  },
  {
    id: 'wdk_spark',
    icon: '✨',
    name: 'WDK Spark',
    description: 'L2 BTC · instant sends · USDT · cross-layer bridge',
    badge: 'WDK',
    badgeColor: 'border-purple-500/30 bg-purple-500/10 text-purple-400',
  },
  {
    id: 'kaleidoswap',
    icon: '🔄',
    name: 'KaleidoSwap',
    description: 'Atomic HTLC swaps · quotes · orders · LSPS1 channels · RGB assets',
    badge: 'HTLC',
    badgeColor: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
  },
  {
    id: 'l402',
    icon: '📡',
    name: 'L402 / MPP Gateway',
    description: 'Paid market data · price · OHLCV · sentiment · news via Lightning micropayments',
    badge: 'MPP',
    badgeColor: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  },
]

// ─── Skill metadata ──────────────────────────────────────────────────────────

const SKILL_META: Record<string, {
  icon: string
  description: string
  category: string
  mcps: string[]
}> = {
  'kaleidoagent': {
    icon: '🤖',
    description: 'Main autonomous loop — portfolio rebalancing via KaleidoSwap atomic swaps',
    category: 'Trading',
    mcps: ['wdk_rln', 'kaleidoswap'],
  },
  'dca': {
    icon: '📈',
    description: 'Dollar-cost average into BTC or other assets at regular intervals',
    category: 'Trading',
    mcps: ['wdk_rln', 'wdk_spark', 'kaleidoswap'],
  },
  'portfolio-manager': {
    icon: '⚖️',
    description: 'Monitor drift from target allocations and trigger rebalancing swaps',
    category: 'Trading',
    mcps: ['wdk_rln', 'wdk_spark', 'kaleidoswap'],
  },
  'kaleidoswap': {
    icon: '🔄',
    description: 'Execute swaps via KaleidoSwap atomic HTLC protocol',
    category: 'Trading',
    mcps: ['wdk_rln', 'kaleidoswap'],
  },
  'mpp': {
    icon: '💸',
    description: 'L402 market-data driven trading — buy/sell on news & sentiment signals',
    category: 'Trading',
    mcps: ['wdk_rln', 'kaleidoswap', 'l402'],
  },
  'wallet-assistant': {
    icon: '💬',
    description: 'Natural language wallet queries — balances, activity, invoices, payments',
    category: 'Wallet',
    mcps: ['wdk_rln', 'wdk_spark'],
  },
  'channel-manager': {
    icon: '🔌',
    description: 'Manage Lightning channel liquidity and purchase channels via LSPS1',
    category: 'Wallet',
    mcps: ['wdk_rln', 'kaleidoswap'],
  },
  'node-manager': {
    icon: '🖥️',
    description: 'Monitor node health, flush pending RGB transfers, handle stuck payments',
    category: 'Infrastructure',
    mcps: ['wdk_rln'],
  },
  'cross-l2': {
    icon: '🌉',
    description: 'Move assets between RGB Lightning, Spark, and Arkade layers',
    category: 'Infrastructure',
    mcps: ['wdk_rln', 'wdk_spark'],
  },
}

// ─── Toggle switch ───────────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onChange}
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

// ─── MCP card ─────────────────────────────────────────────────────────────────

function McpCard({ mcp, enabled }: { mcp: McpInfo; enabled: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3.5 transition-colors ${
        enabled
          ? 'border-emerald-500/20 bg-emerald-500/5'
          : 'border-white/8 bg-white/[0.02]'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-base shrink-0">
          {mcp.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-semibold text-gray-200">{mcp.name}</p>
            <span className={`text-[9px] font-mono px-1 py-0.5 rounded border ${mcp.badgeColor}`}>
              {mcp.badge}
            </span>
          </div>
          <p className="text-[10px] font-mono text-gray-600 mt-0.5 leading-relaxed truncate">{mcp.description}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`} />
          <span className={`text-[10px] font-mono ${enabled ? 'text-emerald-400' : 'text-gray-700'}`}>
            {enabled ? 'live' : 'offline'}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Add skill form ───────────────────────────────────────────────────────────

function AddSkillHint() {
  return (
    <div className="rounded-xl border border-dashed border-white/10 p-4 text-center space-y-2">
      <p className="text-sm text-gray-500">Add a custom skill</p>
      <p className="text-[11px] font-mono text-gray-700 leading-relaxed">
        Create a directory under{' '}
        <code className="text-orange-400/70">skills/</code> with a{' '}
        <code className="text-orange-400/70">SKILL.md</code> file.
        KaleidoAgent syncs these into the shared Nanobot workspace on startup.
      </p>
      <div className="mt-3 bg-black/30 border border-white/5 rounded-lg px-3 py-2 text-left">
        <p className="text-[10px] font-mono text-gray-600">
          <span className="text-gray-700">$</span>{' '}
          <span className="text-orange-300/60">mkdir</span> skills/my-strategy
        </p>
        <p className="text-[10px] font-mono text-gray-600">
          <span className="text-gray-700">$</span>{' '}
          <span className="text-orange-300/60">touch</span> skills/my-strategy/SKILL.md
        </p>
      </div>
    </div>
  )
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function SkillsPanel({ connection }: Props) {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)

  const isLive = connection === 'live'

  useEffect(() => {
    void getSkills().then((data) => {
      setSkills(data)
      setLoading(false)
    })
  }, [])

  const handleToggle = async (skill: SkillInfo) => {
    if (!isLive || toggling) return
    setToggling(skill.id)
    const newEnabled = !skill.enabled
    const ok = await patchSkill(skill.id, newEnabled)
    if (ok) {
      setSkills((prev) => prev.map((s) => s.id === skill.id ? { ...s, enabled: newEnabled } : s))
    }
    setToggling(null)
  }

  const categories = Array.from(new Set(
    skills.map((s) => SKILL_META[s.id]?.category ?? 'Other')
  ))

  return (
    <div className="p-5 space-y-6 max-w-2xl mx-auto">

      {/* ── MCP servers ── */}
      <div>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-300">MCP Servers</h2>
            <p className="text-[11px] text-gray-600 mt-0.5 font-mono">
              Active tool providers for agent skills
            </p>
          </div>
          {!isLive && (
            <span className="text-[10px] font-mono text-gray-700 bg-white/5 border border-white/8 rounded-lg px-2 py-1">
              agent offline
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2">
          {MCPS.map((mcp) => (
            <McpCard key={mcp.id} mcp={mcp} enabled={isLive} />
          ))}
        </div>
      </div>

      {/* ── Skills ── */}
      <div className="border-t border-white/5 pt-2">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-300">Skills</h2>
            <p className="text-[11px] text-gray-600 mt-0.5 font-mono">
              {loading
                ? 'Loading…'
                : `${skills.filter((s) => s.enabled).length} of ${skills.length} enabled`}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-24">
            <p className="text-[11px] font-mono text-gray-600">Loading skills…</p>
          </div>
        ) : skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 gap-2 text-center">
            <p className="text-sm text-gray-500">No skills found</p>
            <p className="text-[11px] font-mono text-gray-700">Skills are loaded from the local skills/ directory and mirrored into Nanobot</p>
          </div>
        ) : (
          <div className="space-y-5">
            {categories.map((cat) => {
              const catSkills = skills.filter((s) => (SKILL_META[s.id]?.category ?? 'Other') === cat)
              return (
                <div key={cat}>
                  <h3 className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-2.5">{cat}</h3>
                  <div className="space-y-2">
                    {catSkills.map((skill) => {
                      const meta = SKILL_META[skill.id]
                      const requiredMcps = meta?.mcps ?? []
                      return (
                        <div
                          key={skill.id}
                          className={`rounded-xl border p-4 transition-colors ${
                            skill.enabled
                              ? 'border-orange-500/20 bg-orange-500/5'
                              : 'border-white/8 bg-white/[0.02]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                              <span className="text-xl shrink-0 mt-0.5">{meta?.icon ?? '🔧'}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-gray-200">{skill.name}</p>
                                {meta?.description && (
                                  <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">{meta.description}</p>
                                )}
                                {/* MCP badges */}
                                {requiredMcps.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {requiredMcps.map((mcpId) => {
                                      const mcpInfo = MCPS.find((m) => m.id === mcpId)
                                      if (!mcpInfo) return null
                                      return (
                                        <span
                                          key={mcpId}
                                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${mcpInfo.badgeColor}`}
                                        >
                                          {mcpInfo.icon} {mcpInfo.name}
                                        </span>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                            <ToggleSwitch
                              checked={skill.enabled}
                              onChange={() => void handleToggle(skill)}
                              disabled={!isLive || toggling === skill.id}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Add skill hint ── */}
      <div className="border-t border-white/5 pt-2">
        <AddSkillHint />
      </div>
    </div>
  )
}
