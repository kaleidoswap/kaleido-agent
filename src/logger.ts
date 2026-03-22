import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { RunResult, LoopType } from './agent-runner.js'

export class Logger {
  private logFile: string
  private level: string

  constructor(logFile: string, level = 'INFO') {
    this.logFile = logFile
    this.level = level
    mkdirSync(dirname(logFile), { recursive: true })
  }

  log(result: RunResult): void {
    const line = JSON.stringify({
      ts: result.timestamp,
      level: 'INFO',
      loop: result.loop,
      tool_calls: result.tool_calls,
      duration_ms: result.duration_ms,
      tokens_in: result.usage?.input_tokens ?? 0,
      tokens_out: result.usage?.output_tokens ?? 0,
      cost_usd: result.usage?.estimated_cost_usd?.toFixed(4) ?? '0.0000',
      response: result.final_response.slice(0, 2000),
      trace: result.trace,
    })
    this.write(line)
  }

  error(loop: LoopType | string, message: string): void {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: 'ERROR',
      loop,
      message,
    })
    this.write(line)
  }

  info(message: string): void {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: 'INFO',
      message,
    })
    this.write(line)
  }

  private write(line: string): void {
    try {
      appendFileSync(this.logFile, line + '\n')
    } catch {
      process.stderr.write(`[logger] Failed to write log: ${line}\n`)
    }
    if (this.level === 'DEBUG') {
      process.stderr.write(`[log] ${line}\n`)
    }
  }
}
