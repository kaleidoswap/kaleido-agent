import { useMemo, useState } from 'react'
import {
  createTask, updateTask, deleteTask, triggerTask,
  type AgentTask, type SkillInfo,
} from '../api/agent'
import { ConnectionState } from '../hooks/useAgentStatus'

interface Props {
  connection: ConnectionState
  skills: SkillInfo[]
  tasks: AgentTask[]
  onTasksChanged: () => Promise<void>
}

const SKILL_ICONS: Record<string, string> = {
  'kaleidoagent':      '🤖',
  'dca':               '📈',
  'portfolio-manager': '⚖️',
  'kaleido-trading':   '🔄',
  'paid-data':         '💸',
  'wallet-assistant':  '💬',
  'channel-manager':   '🔌',
  'kaleido-node':      '🖥️',
  'cross-l2':          '🌉',
}

const INTERVAL_OPTIONS = [
  { label: 'Every hour',   value: 3600 },
  { label: 'Every 6h',     value: 21600 },
  { label: 'Every 12h',    value: 43200 },
  { label: 'Daily',        value: 86400 },
  { label: 'Weekly',       value: 604800 },
]

// ─── Preset task templates ────────────────────────────────────────────────────

interface TaskTemplate {
  id: string
  icon: string
  name: string
  description: string
  skill: string
  schedule_sec: number
  allocated_btc_sat: number
  allocated_usdt: number
  allocated_xaut: number
  badgeColor: string
}

const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'dca_btc',
    icon: '📈',
    name: 'Daily DCA into BTC',
    description: 'Buy a fixed USDT amount of BTC every day using KaleidoSwap atomic swaps',
    skill: 'dca',
    schedule_sec: 86400,
    allocated_btc_sat: 0,
    allocated_usdt: 10,
    allocated_xaut: 0,
    badgeColor: 'border-orange-500/30 bg-orange-500/10 text-orange-400',
  },
  {
    id: 'portfolio_optimizer',
    icon: '⚖️',
    name: 'Portfolio Optimizer',
    description: 'Rebalance to target allocations (BTC/USDT/XAUT) every 6h when drift exceeds threshold',
    skill: 'portfolio-manager',
    schedule_sec: 21600,
    allocated_btc_sat: 100000,
    allocated_usdt: 20,
    allocated_xaut: 0,
    badgeColor: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
  },
  {
    id: 'l402_trader',
    icon: '💸',
    name: 'L402 News Trader',
    description: 'Buy/sell based on sentiment signals from L402-gated news feeds via MPP payments',
    skill: 'paid-data',
    schedule_sec: 3600,
    allocated_btc_sat: 50000,
    allocated_usdt: 10,
    allocated_xaut: 0,
    badgeColor: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatInterval(sec: number): string {
  if (sec < 3600)  return `${Math.round(sec / 60)}m`
  if (sec < 86400) return `${Math.round(sec / 3600)}h`
  return `${Math.round(sec / 86400)}d`
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1)  return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24)  return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
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

// ─── Template picker ──────────────────────────────────────────────────────────

function TemplatePicker({ onSelect }: { onSelect: (t: TaskTemplate) => void }) {
  return (
    <div className="space-y-2.5">
      <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Quick start</p>
      <div className="grid grid-cols-1 gap-2">
        {TASK_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t)}
            className="text-left rounded-xl border border-white/8 bg-white/[0.02] p-3.5
                       hover:border-orange-500/25 hover:bg-orange-500/5 transition-all group"
          >
            <div className="flex items-start gap-3">
              <span className="text-xl shrink-0 mt-0.5">{t.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-300 group-hover:text-gray-200">{t.name}</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${t.badgeColor}`}>
                      {SKILL_ICONS[t.skill] ?? '🔧'} {t.skill}
                    </span>
                    <span className="text-[10px] font-mono text-gray-600">/{formatInterval(t.schedule_sec)}</span>
                  </div>
                </div>
                <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">{t.description}</p>
                {/* Budget preview */}
                <div className="flex gap-1.5 mt-2">
                  {t.allocated_btc_sat > 0 && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 text-orange-400">
                      {t.allocated_btc_sat.toLocaleString()} sat
                    </span>
                  )}
                  {t.allocated_usdt > 0 && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400">
                      ${t.allocated_usdt} USDT
                    </span>
                  )}
                  {t.allocated_xaut > 0 && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-yellow-500/10 border border-yellow-500/20 text-yellow-400">
                      {t.allocated_xaut} XAUT
                    </span>
                  )}
                </div>
              </div>
              <span className="text-gray-600 group-hover:text-orange-400 transition-colors text-sm shrink-0 mt-1">→</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Create task form ─────────────────────────────────────────────────────────

function CreateTaskForm({
  skills,
  initial,
  onCancel,
  onCreate,
}: {
  skills: SkillInfo[]
  initial?: Partial<AgentTask>
  onCancel: () => void
  onCreate: (task: Omit<AgentTask, 'id' | 'created_at' | 'last_run_at'>) => Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [skill, setSkill] = useState(initial?.skill ?? (skills[0]?.id ?? ''))
  const [intervalSec, setIntervalSec] = useState(initial?.schedule_sec ?? 86400)
  const [btcSat, setBtcSat] = useState(initial?.allocated_btc_sat ? String(initial.allocated_btc_sat) : '')
  const [usdt, setUsdt] = useState(initial?.allocated_usdt ? String(initial.allocated_usdt) : '')
  const [xaut, setXaut] = useState(initial?.allocated_xaut ? String(initial.allocated_xaut) : '')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim() || !skill) return
    setSaving(true)
    await onCreate({
      name: name.trim(),
      description: '',
      skill,
      schedule_sec: intervalSec,
      allocated_btc_sat: parseInt(btcSat) || 0,
      allocated_usdt: parseFloat(usdt) || 0,
      allocated_xaut: parseFloat(xaut) || 0,
      enabled: true,
    })
    setSaving(false)
  }

  return (
    <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-200">New Periodic Task</h3>

      {/* Name */}
      <div>
        <label className="text-[10px] font-mono text-gray-600 uppercase tracking-widest block mb-1.5">Task Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Daily DCA into BTC"
          className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-700 outline-none focus:border-orange-500/30"
        />
      </div>

      {/* Skill */}
      <div>
        <label className="text-[10px] font-mono text-gray-600 uppercase tracking-widest block mb-1.5">Skill</label>
        <div className="grid grid-cols-2 gap-1.5">
          {skills.map((s) => (
            <button
              key={s.id}
              onClick={() => setSkill(s.id)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[11px] font-mono transition-colors ${
                skill === s.id
                  ? 'border-orange-500/40 bg-orange-500/15 text-orange-300'
                  : 'border-white/8 bg-white/[0.02] text-gray-500 hover:text-gray-300'
              }`}
            >
              <span>{SKILL_ICONS[s.id] ?? '🔧'}</span>
              <span className="truncate">{s.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Schedule */}
      <div>
        <label className="text-[10px] font-mono text-gray-600 uppercase tracking-widest block mb-1.5">Schedule</label>
        <div className="grid grid-cols-3 gap-1.5">
          {INTERVAL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setIntervalSec(opt.value)}
              className={`rounded-lg border px-2 py-1.5 text-[11px] font-mono transition-colors ${
                intervalSec === opt.value
                  ? 'border-orange-500/40 bg-orange-500/15 text-orange-300'
                  : 'border-white/8 bg-white/[0.02] text-gray-500 hover:text-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Budget */}
      <div>
        <label className="text-[10px] font-mono text-gray-600 uppercase tracking-widest block mb-1.5">
          Allocate Budget
        </label>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 bg-black/20 border border-white/8 rounded-lg px-3 py-2">
            <span className="text-[11px] font-mono text-orange-400 w-14 shrink-0">BTC sat</span>
            <input value={btcSat} onChange={(e) => setBtcSat(e.target.value)} placeholder="0"
              type="number" min="0"
              className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-700 outline-none" />
          </div>
          <div className="flex items-center gap-2 bg-black/20 border border-white/8 rounded-lg px-3 py-2">
            <span className="text-[11px] font-mono text-blue-400 w-14 shrink-0">USDT</span>
            <input value={usdt} onChange={(e) => setUsdt(e.target.value)} placeholder="0.00"
              type="number" min="0" step="0.01"
              className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-700 outline-none" />
          </div>
          <div className="flex items-center gap-2 bg-black/20 border border-white/8 rounded-lg px-3 py-2">
            <span className="text-[11px] font-mono text-yellow-400 w-14 shrink-0">XAUT</span>
            <input value={xaut} onChange={(e) => setXaut(e.target.value)} placeholder="0.000"
              type="number" min="0" step="0.001"
              className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-700 outline-none" />
          </div>
        </div>
        <p className="text-[10px] font-mono text-gray-700 mt-1.5">
          Budget reserved per execution. Funds remain in your wallet until the task runs.
        </p>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => void handleSubmit()}
          disabled={!name.trim() || !skill || saving}
          className="flex-1 py-2 rounded-lg bg-orange-500 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Creating…' : 'Create Task'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-white/10 text-sm text-gray-400 hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Task card ────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  isLive,
  onToggle,
  onDelete,
  onRun,
}: {
  task: AgentTask
  isLive: boolean
  onToggle: () => void
  onDelete: () => void
  onRun: () => void
}) {
  const [running, setRunning] = useState(false)

  const handleRun = async () => {
    setRunning(true)
    onRun()
    // Small UX delay so the "running" state is visible
    await new Promise((r) => setTimeout(r, 1000))
    setRunning(false)
  }

  return (
    <div className={`rounded-xl border p-4 transition-colors ${
      task.enabled
        ? 'border-orange-500/15 bg-orange-500/[0.04]'
        : 'border-white/8 bg-white/[0.02]'
    }`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <span className="text-xl shrink-0 mt-0.5">{SKILL_ICONS[task.skill] ?? '🤖'}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-200 truncate">{task.name}</p>
            <p className="text-[10px] font-mono text-gray-600 mt-0.5">{task.skill}</p>
          </div>
        </div>
        <ToggleSwitch checked={task.enabled} onChange={onToggle} />
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-white/[0.03] border border-white/5 rounded-lg p-2 text-center">
          <p className="text-[10px] font-mono text-gray-600">schedule</p>
          <p className="text-xs font-mono text-gray-300 mt-0.5">/{formatInterval(task.schedule_sec)}</p>
        </div>
        <div className="bg-white/[0.03] border border-white/5 rounded-lg p-2 text-center">
          <p className="text-[10px] font-mono text-gray-600">last run</p>
          <p className="text-xs font-mono text-gray-300 mt-0.5">{relativeTime(task.last_run_at)}</p>
        </div>
        <div className="bg-white/[0.03] border border-white/5 rounded-lg p-2 text-center">
          <p className="text-[10px] font-mono text-gray-600">budget</p>
          <p className="text-xs font-mono text-gray-300 mt-0.5">
            {task.allocated_btc_sat > 0
              ? `${task.allocated_btc_sat.toLocaleString()}s`
              : task.allocated_usdt > 0
              ? `$${task.allocated_usdt}`
              : '—'}
          </p>
        </div>
      </div>

      {(task.allocated_btc_sat > 0 || task.allocated_usdt > 0 || task.allocated_xaut > 0) && (
        <div className="flex gap-1.5 mb-3 flex-wrap">
          {task.allocated_btc_sat > 0 && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-orange-500/10 border border-orange-500/20 text-orange-400">
              {task.allocated_btc_sat.toLocaleString()} sat
            </span>
          )}
          {task.allocated_usdt > 0 && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400">
              ${task.allocated_usdt} USDT
            </span>
          )}
          {task.allocated_xaut > 0 && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-yellow-400">
              {task.allocated_xaut} XAUT
            </span>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => void handleRun()}
          disabled={!isLive || running}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-orange-500/20 border border-orange-500/30 text-orange-300 text-[11px] font-mono hover:bg-orange-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {running ? '⟳ running…' : '▶ run now'}
        </button>
        <button
          onClick={onDelete}
          className="px-3 py-1.5 rounded-lg border border-white/8 text-gray-600 hover:text-red-400 hover:border-red-500/20 text-[11px] transition-colors"
          title="Delete task"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type FormMode = 'hidden' | 'blank' | 'template'

export function TasksPanel({ connection, skills, tasks, onTasksChanged }: Props) {
  const [formMode, setFormMode] = useState<FormMode>('hidden')
  const [templateInitial, setTemplateInitial] = useState<Partial<AgentTask> | undefined>()

  const isLive = connection === 'live'
  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [tasks],
  )

  const handleCreate = async (task: Omit<AgentTask, 'id' | 'created_at' | 'last_run_at'>) => {
    const created = await createTask(task)
    if (created) {
      await onTasksChanged()
      setFormMode('hidden')
      setTemplateInitial(undefined)
    }
  }

  const handleToggle = async (task: AgentTask) => {
    const ok = await updateTask(task.id, { enabled: !task.enabled })
    if (ok) await onTasksChanged()
  }

  const handleDelete = async (id: string) => {
    const ok = await deleteTask(id)
    if (ok) await onTasksChanged()
  }

  const handleRun = async (task: AgentTask) => {
    await triggerTask(task.id)
    await onTasksChanged()
  }

  const handleSelectTemplate = (t: TaskTemplate) => {
    setTemplateInitial({
      name: t.name,
      skill: t.skill,
      schedule_sec: t.schedule_sec,
      allocated_btc_sat: t.allocated_btc_sat,
      allocated_usdt: t.allocated_usdt,
      allocated_xaut: t.allocated_xaut,
    })
    setFormMode('template')
  }

  const handleCancel = () => {
    setFormMode('hidden')
    setTemplateInitial(undefined)
  }

  if (!tasks) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-[11px] font-mono text-gray-600">Loading tasks…</p>
      </div>
    )
  }

  const enabledTasks = sortedTasks.filter((t) => t.enabled)
  const pausedTasks  = sortedTasks.filter((t) => !t.enabled)

  return (
    <div className="p-5 space-y-5 max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-300">Periodic Tasks</h2>
          <p className="text-[11px] text-gray-600 mt-0.5 font-mono">
            {enabledTasks.length} active · {tasks.length} total
          </p>
        </div>
        {formMode === 'hidden' && (
          <button
            onClick={() => setFormMode('blank')}
            className="flex items-center gap-1.5 text-[11px] font-mono text-gray-400 bg-white/[0.03] border border-white/10 rounded-lg px-3 py-1.5 hover:text-gray-200 hover:border-white/20 transition-colors"
          >
            + New Task
          </button>
        )}
      </div>

      {/* Templates (shown when no tasks or when user clicks + New) */}
      {formMode === 'hidden' && sortedTasks.length === 0 && (
        <TemplatePicker onSelect={handleSelectTemplate} />
      )}

      {formMode === 'hidden' && sortedTasks.length > 0 && (
        <div>
          <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest mb-2">Templates</p>
          <TemplatePicker onSelect={handleSelectTemplate} />
        </div>
      )}

      {/* Create form */}
      {(formMode === 'blank' || formMode === 'template') && (
        <CreateTaskForm
          skills={skills}
          initial={templateInitial}
          onCancel={handleCancel}
          onCreate={handleCreate}
        />
      )}

      {/* Task list */}
      {enabledTasks.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Active</p>
          {enabledTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isLive={isLive}
              onToggle={() => void handleToggle(task)}
              onDelete={() => void handleDelete(task.id)}
              onRun={() => void handleRun(task)}
            />
          ))}
        </div>
      )}

      {pausedTasks.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-mono text-gray-700 uppercase tracking-widest">Paused</p>
          {pausedTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isLive={isLive}
              onToggle={() => void handleToggle(task)}
              onDelete={() => void handleDelete(task.id)}
              onRun={() => void handleRun(task)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
