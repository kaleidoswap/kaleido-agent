/**
 * NanobotCronSync — converts tasks.json entries into Nanobot cron/jobs.json
 *
 * Each enabled task with schedule_sec > 0 becomes a Nanobot cron job.
 * The prompt mirrors NanobotTaskRunner.buildTaskPrompt().
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import type { AgentTask } from './tasks-store.js'

export interface CronJob {
  id: string
  name: string
  cron: string
  enabled: boolean
  prompt: string
}

export interface CronJobsFile {
  version: number
  jobs: CronJob[]
}

/**
 * Convert schedule_sec to a 5-field cron expression.
 *
 *   300  → *​/5 * * * *
 *   600  → *​/10 * * * *
 *   900  → *​/15 * * * *
 *  1800  → *​/30 * * * *
 *  3600  → 0 * * * *
 *  7200  → 0 *​/2 * * *
 * 86400  → 0 0 * * *
 */
export function scheduleToCron(sec: number): string {
  if (sec <= 0) return '0 * * * *'

  if (sec < 3600) {
    const minutes = Math.max(1, Math.round(sec / 60))
    if (minutes >= 60) return '0 * * * *'
    return `*/${minutes} * * * *`
  }

  if (sec < 86400) {
    const hours = Math.round(sec / 3600)
    if (hours <= 1) return '0 * * * *'
    if (hours >= 24) return '0 0 * * *'
    return `0 */${hours} * * *`
  }

  return '0 0 * * *'
}

function buildCronPrompt(
  task: AgentTask,
  portfolioParams: Record<string, unknown>,
  dryRun: boolean,
): string {
  return [
    'You are operating as the KaleidoAgent background runtime inside Nanobot.',
    `Current time: ${new Date().toISOString()}`,
    `Task id: ${task.id}`,
    `Primary skill: ${task.skill}`,
    `dry_run: ${dryRun}`,
    `Portfolio parameters: ${JSON.stringify(portfolioParams)}`,
    '',
    `Use the "${task.skill}" skill from the workspace skills directory if it exists.`,
    'Complete the task safely using the available MCP tools.',
    'Do not execute destructive or live wallet actions when dry_run=true.',
    'Return strict JSON with these fields:',
    '{"loop":"...", "timestamp":"ISO8601", "action":"...", "dry_run":true, "reason":"...", "details":{}}',
  ].join('\n')
}

export function buildCronJobs(
  tasks: AgentTask[],
  portfolioParams: Record<string, unknown>,
  dryRun: boolean,
): CronJobsFile {
  const jobs: CronJob[] = tasks
    .filter((t) => t.schedule_sec > 0)
    .map((task) => ({
      id: task.id,
      name: task.name,
      cron: scheduleToCron(task.schedule_sec),
      enabled: task.enabled,
      prompt: buildCronPrompt(task, portfolioParams, dryRun),
    }))

  return { version: 1, jobs }
}

export async function writeCronJobs(
  cronDir: string,
  tasks: AgentTask[],
  portfolioParams: Record<string, unknown>,
  dryRun: boolean,
): Promise<CronJobsFile> {
  const file = buildCronJobs(tasks, portfolioParams, dryRun)
  const filePath = resolve(cronDir, 'jobs.json')
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  return file
}
