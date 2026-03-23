/**
 * Safe command execution using execFile (no shell invocation).
 * Prevents shell injection by passing arguments as an array.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFilePromise = promisify(execFile)

export interface ExecFileOptions {
  timeout?: number
  env?: Record<string, string | undefined>
}

export async function execFileAsync(
  file: string,
  args: string[],
  opts: ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return execFilePromise(file, args, {
    timeout: opts.timeout ?? 30_000,
    env: opts.env as NodeJS.ProcessEnv,
  })
}
