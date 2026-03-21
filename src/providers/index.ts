export { AnthropicProvider } from './anthropic-provider.js'
export { OpenAIProvider } from './openai-provider.js'
export type { AIProvider, AIProviderName, McpToolDef, TurnOutput, ToolCallResult } from './types.js'

import type { AIProvider, AIProviderName } from './types.js'
import { AnthropicProvider } from './anthropic-provider.js'
import { OpenAIProvider } from './openai-provider.js'

export function createProvider(name: AIProviderName): AIProvider {
  if (name === 'openai') return new OpenAIProvider()
  return new AnthropicProvider()
}
