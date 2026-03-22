import type { ChatAction, ChatMessage, ChatResponse } from './chat-runner.js'
import { NanobotManager } from './nanobot-manager.js'

const ACTION_RE = /<action>([\s\S]*?)<\/action>/

export class NanobotChatRunner {
  private readonly manager: NanobotManager
  private dryRun: boolean

  constructor(manager: NanobotManager, dryRun: boolean) {
    this.manager = manager
    this.dryRun = dryRun
  }

  setDryRun(dryRun: boolean): void {
    this.dryRun = dryRun
  }

  async chat(history: ChatMessage[]): Promise<ChatResponse> {
    const prompt = buildChatPrompt(history, this.dryRun)
    const raw = await this.manager.runAgent(prompt)
    const { cleanText, action } = parseAction(raw)
    return {
      text: cleanText || 'Done.',
      action,
      tool_calls: [],
      trace: [],
    }
  }
}

function buildChatPrompt(history: ChatMessage[], dryRun: boolean): string {
  const recent = history.slice(-8)
  const lines = [
    'You are the compact KaleidoAgent wallet assistant running inside Nanobot.',
    `Current time: ${new Date().toISOString()}`,
    `dry_run: ${dryRun}`,
    'Rules:',
    '- Keep replies to 1-3 sentences.',
    '- Never execute swaps, sends, or payments automatically.',
    '- If you want the dashboard to prepare an action, append exactly one <action>{...}</action> block.',
    '- Supported action formats:',
    '<action>{"type":"swap","fromAsset":"BTC","toAsset":"USDT","amount":"0.001"}</action>',
    '<action>{"type":"navigate","view":"withdraw"}</action>',
    '- Prefer the wallet-assistant, kaleidoswap, channel-manager, and mpp skills when relevant.',
    '',
    'Conversation history:',
  ]

  for (const message of recent) {
    lines.push(`${message.role.toUpperCase()}: ${message.content}`)
  }

  lines.push('', 'Answer the latest user request now.')
  return lines.join('\n')
}

function parseAction(text: string): { cleanText: string; action: ChatAction } {
  const match = text.match(ACTION_RE)
  if (!match) return { cleanText: text.trim(), action: { type: 'none' } }

  const cleanText = text.replace(ACTION_RE, '').trim()
  try {
    const parsed = JSON.parse(match[1].trim()) as ChatAction
    if (parsed.type === 'swap' && parsed.fromAsset && parsed.toAsset) {
      return {
        cleanText,
        action: {
          type: 'swap',
          fromAsset: String(parsed.fromAsset).toUpperCase(),
          toAsset: String(parsed.toAsset).toUpperCase(),
          amount: parsed.amount ? String(parsed.amount) : '',
        },
      }
    }
    if (parsed.type === 'navigate' && parsed.view) {
      return {
        cleanText,
        action: { type: 'navigate', view: String(parsed.view) },
      }
    }
  } catch {
    // Ignore malformed action payloads.
  }
  return { cleanText, action: { type: 'none' } }
}

