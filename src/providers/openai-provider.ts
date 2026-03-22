import OpenAI from 'openai'
import type { AIProvider, McpToolDef, TurnOutput, ToolCallResult } from './types.js'

type OAIMessage = OpenAI.Chat.ChatCompletionMessageParam

export class OpenAIProvider implements AIProvider {
  private get client(): OpenAI {
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }

  initMessages(userPrompt: string): unknown[] {
    return [{ role: 'user', content: userPrompt } satisfies OAIMessage]
  }

  private convertTools(tools: McpToolDef[]): OpenAI.Chat.ChatCompletionTool[] {
    return (tools ?? []).map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as OpenAI.FunctionParameters,
      },
    }))
  }

  async runTurn(
    model: string,
    maxTokens: number,
    system: string,
    tools: McpToolDef[],
    messages: unknown[]
  ): Promise<TurnOutput> {
    const systemMsg: OAIMessage = { role: 'system', content: system }
    const allMessages: OAIMessage[] = [systemMsg, ...(messages as OAIMessage[])]

    const response = await this.client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      tools: this.convertTools(tools),
      tool_choice: 'auto',
      messages: allMessages,
    })

    const choice = response.choices[0]
    const msg = choice.message
    const rawToolCalls = msg.tool_calls ?? []

    const tool_calls = rawToolCalls.map((tc) => {
      const fn = 'function' in tc ? tc.function : { name: '', arguments: '{}' }
      return {
        id: tc.id,
        name: fn.name,
        input: (() => {
          try { return JSON.parse(fn.arguments) } catch {
            process.stderr.write(`[openai-provider] WARNING: failed to parse tool arguments for "${fn.name}": ${fn.arguments}\n`)
            return {}
          }
        })(),
      }
    })

    return {
      stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
      text: msg.content ?? '',
      tool_calls,
      usage: {
        input_tokens: response.usage?.prompt_tokens ?? 0,
        output_tokens: response.usage?.completion_tokens ?? 0,
      },
      _rawResponse: msg,
    }
  }

  appendAssistant(messages: unknown[], output: TurnOutput): void {
    const raw = output._rawResponse as OpenAI.Chat.ChatCompletionMessage
    const msg: OAIMessage = { role: 'assistant', content: raw.content ?? null }
    if (raw.tool_calls && raw.tool_calls.length > 0) {
      ;(msg as OpenAI.Chat.ChatCompletionAssistantMessageParam).tool_calls = raw.tool_calls
    }
    ;(messages as OAIMessage[]).push(msg)
  }

  appendToolResults(messages: unknown[], results: ToolCallResult[]): void {
    for (const r of results) {
      ;(messages as OAIMessage[]).push({
        role: 'tool',
        tool_call_id: r.id,
        content: r.result,
      })
    }
  }
}
