/**
 * TasksStore — persists periodic agent tasks to tasks.json.
 * Each task has a name, skill, schedule, and optional budget allocation.
 * Default loop tasks (heartbeat, rebalance, daily_summary) are seeded on startup.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolveStatePath } from './runtime-paths.js'
import { canonicalSkillName } from './skill-sources.js'

export interface AgentTask {
  id: string
  name: string
  description: string
  skill: string
  schedule_sec: number
  run_on_startup: boolean
  allocated_btc_sat: number
  allocated_usdt: number
  allocated_xaut: number
  enabled: boolean
  created_at: string
  last_run_at: string | null
}

const TASKS_PATH = process.env.TASKS_PATH ?? resolveStatePath('tasks.json')

async function readTasks(): Promise<AgentTask[]> {
  try {
    const raw = await readFile(TASKS_PATH, 'utf8')
    return (JSON.parse(raw) as AgentTask[]).map((task) => ({ ...task, skill: canonicalSkillName(task.skill) }))
  } catch {
    return []
  }
}

async function writeTasks(tasks: AgentTask[]): Promise<void> {
  await writeFile(TASKS_PATH, JSON.stringify(tasks, null, 2), 'utf8')
}

export const tasksStore = {
  async list(): Promise<AgentTask[]> {
    return readTasks()
  },

  async create(task: Omit<AgentTask, 'id' | 'created_at' | 'last_run_at'>): Promise<AgentTask> {
    const tasks = await readTasks()
    const newTask: AgentTask = {
      ...task,
      run_on_startup: task.run_on_startup ?? false,
      id: randomUUID(),
      created_at: new Date().toISOString(),
      last_run_at: null,
    }
    tasks.push(newTask)
    await writeTasks(tasks)
    return newTask
  },

  async update(id: string, patch: Partial<AgentTask>): Promise<AgentTask | null> {
    const tasks = await readTasks()
    const idx = tasks.findIndex((t) => t.id === id)
    if (idx === -1) return null
    tasks[idx] = { ...tasks[idx], ...patch }
    await writeTasks(tasks)
    return tasks[idx]
  },

  async delete(id: string): Promise<boolean> {
    const tasks = await readTasks()
    const filtered = tasks.filter((t) => t.id !== id)
    if (filtered.length === tasks.length) return false
    await writeTasks(filtered)
    return true
  },

  /** Seed the 3 default loop tasks if their IDs don't already exist. */
  async seedDefaults(defaults: {
    heartbeat_interval_sec: number
    rebalance_interval_sec: number
  }): Promise<void> {
    const tasks = await readTasks()
    const ids = new Set(tasks.map((t) => t.id))
    const now = new Date().toISOString()
    const toAdd: AgentTask[] = []

    if (!ids.has('heartbeat')) {
      toAdd.push({
        id: 'heartbeat',
        name: 'Heartbeat',
        description: 'Node health check, channel audit, RGB transfer flush',
        skill: 'channel-manager',
        schedule_sec: defaults.heartbeat_interval_sec || 300,
        run_on_startup: true,
        allocated_btc_sat: 0, allocated_usdt: 0, allocated_xaut: 0,
        enabled: true,
        created_at: now, last_run_at: null,
      })
    }

    if (!ids.has('rebalance')) {
      toAdd.push({
        id: 'rebalance',
        name: 'Portfolio Rebalance',
        description: 'Detect allocation drift and execute rebalancing swaps',
        skill: 'portfolio-manager',
        schedule_sec: defaults.rebalance_interval_sec > 0 ? defaults.rebalance_interval_sec : 3600,
        run_on_startup: false,
        allocated_btc_sat: 0, allocated_usdt: 0, allocated_xaut: 0,
        enabled: defaults.rebalance_interval_sec > 0,
        created_at: now, last_run_at: null,
      })
    }

    if (!ids.has('daily_summary')) {
      toAdd.push({
        id: 'daily_summary',
        name: 'Daily Summary',
        description: 'Full portfolio snapshot and market report',
        skill: 'kaleidoagent',
        schedule_sec: 86400,
        run_on_startup: false,
        allocated_btc_sat: 0, allocated_usdt: 0, allocated_xaut: 0,
        enabled: true,
        created_at: now, last_run_at: null,
      })
    }

    if (toAdd.length > 0) {
      // Put defaults first so they appear at the top
      await writeTasks([...toAdd, ...tasks])
      process.stderr.write(`[tasks-store] Seeded ${toAdd.length} default task(s): ${toAdd.map(t => t.id).join(', ')}\n`)
    }
  },
}
