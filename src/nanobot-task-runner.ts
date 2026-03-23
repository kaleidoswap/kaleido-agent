import type { RunResult, RunTraceStep } from './agent-runner.js'
import { NanobotManager } from './nanobot-manager.js'

export class NanobotTaskRunner {
  private readonly manager: NanobotManager
  private dryRun: boolean

  constructor(manager: NanobotManager, dryRun: boolean) {
    this.manager = manager
    this.dryRun = dryRun
  }

  setDryRun(dryRun: boolean): void {
    this.dryRun = dryRun
  }

  async run(taskId: string, skillName: string, portfolioParams: Record<string, unknown>): Promise<RunResult> {
    const start = Date.now()
    const prompt = buildTaskPrompt(taskId, skillName, portfolioParams, this.dryRun)
    const finalResponse = await this.manager.runAgent(prompt)
    return buildRunResult(taskId, start, finalResponse)
  }
}

function buildTaskPrompt(
  taskId: string,
  skillName: string,
  portfolioParams: Record<string, unknown>,
  dryRun: boolean,
): string {
  return [
    'You are operating as the KaleidoAgent background runtime inside Nanobot.',
    `Current time: ${new Date().toISOString()}`,
    `Task id: ${taskId}`,
    `Primary skill: ${skillName}`,
    `dry_run: ${dryRun}`,
    `Portfolio parameters: ${JSON.stringify(portfolioParams)}`,
    '',
    `Use the "${skillName}" skill from the workspace skills directory if it exists.`,
    'Complete the task safely using the available MCP tools.',
    'Do not execute destructive or live wallet actions when dry_run=true.',
    'Return strict JSON with these fields:',
    '{"loop":"...", "timestamp":"ISO8601", "action":"...", "dry_run":true, "reason":"...", "details":{}}',
  ].join('\n')
}

function buildRunResult(taskId: string, start: number, rawResponse: string): RunResult {
  const trace: RunTraceStep[] = []
  let usage = { input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 }
  let toolCalls = 0
  let finalResponse = rawResponse

  // Try to extract usage metadata from nanobot's JSON envelope
  try {
    const parsed = JSON.parse(rawResponse)
    if (parsed.usage) {
      usage = {
        input_tokens: parsed.usage.input_tokens ?? 0,
        output_tokens: parsed.usage.output_tokens ?? 0,
        estimated_cost_usd: parsed.usage.estimated_cost_usd ?? 0,
      }
    }
    if (typeof parsed.tool_calls === 'number') toolCalls = parsed.tool_calls
    if (parsed.response) finalResponse = parsed.response
  } catch {
    // Raw text response — no usage metadata available
  }

  return {
    loop: taskId,
    timestamp: new Date().toISOString(),
    tool_calls: toolCalls,
    final_response: finalResponse,
    trace,
    duration_ms: Date.now() - start,
    usage,
  }
}
