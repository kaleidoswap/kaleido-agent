export type AIProviderName = 'anthropic' | 'openai'

export interface McpToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ToolCallResult {
  id: string
  result: string
}

export interface TurnOutput {
  stop_reason: 'end_turn' | 'tool_use'
  text: string
  tool_calls: Array<{ id: string; name: string; input: Record<string, unknown> }>
  usage: { input_tokens: number; output_tokens: number }
  _rawResponse: unknown
}

export interface AIProvider {
  initMessages(userPrompt: string): unknown[]
  runTurn(
    model: string,
    maxTokens: number,
    system: string,
    tools: McpToolDef[],
    messages: unknown[]
  ): Promise<TurnOutput>
  appendAssistant(messages: unknown[], output: TurnOutput): void
  appendToolResults(messages: unknown[], results: ToolCallResult[]): void
}
