import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, McpToolDef, TurnOutput, ToolCallResult } from './types.js'

export class AnthropicProvider implements AIProvider {
  private get client(): Anthropic {
    // Create fresh client each time so key changes apply immediately
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }

  initMessages(userPrompt: string): unknown[] {
    return [{ role: 'user', content: userPrompt }]
  }

  private convertTools(tools: McpToolDef[]): Anthropic.Tool[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: (t.inputSchema as Anthropic.Tool['input_schema']) ?? {
        type: 'object',
        properties: {},
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
    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      tools: this.convertTools(tools),
      messages: messages as Anthropic.MessageParam[],
    })

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    const tool_calls = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> }))

    return {
      stop_reason: response.stop_reason === 'end_turn' ? 'end_turn' : 'tool_use',
      text,
      tool_calls,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      _rawResponse: response,
    }
  }

  appendAssistant(messages: unknown[], output: TurnOutput): void {
    const raw = output._rawResponse as Anthropic.Message
    ;(messages as Anthropic.MessageParam[]).push({ role: 'assistant', content: raw.content })
  }

  appendToolResults(messages: unknown[], results: ToolCallResult[]): void {
    ;(messages as Anthropic.MessageParam[]).push({
      role: 'user',
      content: results.map((r) => ({
        type: 'tool_result' as const,
        tool_use_id: r.id,
        content: r.result,
      })),
    })
  }
}
