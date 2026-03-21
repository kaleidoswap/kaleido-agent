import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface NodeBootstrapOptions {
  nodeUrl: string
  apiUrl?: string
  envName?: string
  kaleidoBin?: string
  waitTimeoutMs?: number
  pollIntervalMs?: number
}

type FetchLike = typeof fetch
type ExecFileLike = typeof execFileAsync
type SleepLike = (ms: number) => Promise<void>

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function findKaleidoBinary(): string {
  const fromEnv = process.env.KALEIDO_BIN
  if (fromEnv && existsSync(fromEnv)) return fromEnv

  const candidates = [
    `${process.env.HOME}/.local/bin/kaleido`,
    '/usr/local/bin/kaleido',
    '/opt/homebrew/bin/kaleido',
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  return 'kaleido'
}

export async function probeNode(nodeUrl: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  const url = `${nodeUrl.replace(/\/$/, '')}/nodeinfo`
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function ensureNodeRunning(
  options: NodeBootstrapOptions,
  deps: {
    fetchImpl?: FetchLike
    execFileImpl?: ExecFileLike
    sleep?: SleepLike
    logger?: (msg: string) => void
  } = {}
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const execFileImpl = deps.execFileImpl ?? execFileAsync
  const sleep = deps.sleep ?? defaultSleep
  const logger = deps.logger ?? ((msg: string) => process.stderr.write(msg + '\n'))
  const waitTimeoutMs = options.waitTimeoutMs ?? 60_000
  const pollIntervalMs = options.pollIntervalMs ?? 2_000

  if (await probeNode(options.nodeUrl, fetchImpl)) {
    logger(`[kaleidoagent] RLN node already reachable at ${options.nodeUrl}`)
    return
  }

  const kaleidoBin = options.kaleidoBin ?? findKaleidoBinary()
  const args = ['--json', '--agent']
  if (options.apiUrl) args.push('--api-url', options.apiUrl)
  args.push('node', 'up')
  if (options.envName) args.push(options.envName)

  logger(
    `[kaleidoagent] RLN node not reachable at ${options.nodeUrl}; starting it via ${kaleidoBin} ${args.slice(2).join(' ')}`
  )

  try {
    const { stdout, stderr } = await execFileImpl(kaleidoBin, args, {
      timeout: 60_000,
      env: { ...process.env, PATH: process.env.PATH ?? '' },
    })
    const output = [stdout, stderr].filter(Boolean).join('\n').trim()
    if (output) logger(output)
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string }
    const detail = [error.stderr, error.stdout, error.message].filter(Boolean).join('\n')
    throw new Error(`Failed to start node with kaleido CLI: ${detail}`)
  }

  const deadline = Date.now() + waitTimeoutMs
  while (Date.now() < deadline) {
    if (await probeNode(options.nodeUrl, fetchImpl)) {
      logger(`[kaleidoagent] RLN node became reachable at ${options.nodeUrl}`)
      return
    }
    await sleep(pollIntervalMs)
  }

  throw new Error(
    `Timed out waiting for RLN node at ${options.nodeUrl} after starting it with kaleido CLI`
  )
}
