import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { ChatAction, ChatMessage, ToolCallTrace, sendChat } from '../api/agent'
import { useSpeech } from '../hooks/useSpeech'
import { ConnectionState } from '../hooks/useAgentStatus'

// Lightweight inline markdown renderer: **bold**, *italic*, `code`
function renderMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="text-gray-100 font-semibold">{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={i} className="text-gray-300">{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="font-mono text-orange-300 bg-orange-500/10 px-1 rounded text-[11px]">{part.slice(1, -1)}</code>
    return <span key={i}>{part}</span>
  })
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  action?: ChatAction
  tool_calls?: ToolCallTrace[]
  loading?: boolean
}

interface Props {
  connection: ConnectionState
  onAction: (action: ChatAction) => void
}

const SUGGESTIONS = [
  'What is my BTC balance?',
  'Quote 50000 sats to USDT',
  'Show my Lightning channels',
  'Generate a Lightning invoice for 10000 sats',
  'What is the current BTC price?',
  'Show my open orders',
]

function ToolTrace({ calls }: { calls: ToolCallTrace[] }) {
  const [open, setOpen] = useState(false)
  if (calls.length === 0) return null

  const hasErrors = calls.some((c) => c.error)

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 text-[10px] font-mono transition-colors ${
          hasErrors ? 'text-red-400/70 hover:text-red-400' : 'text-gray-600 hover:text-gray-500'
        }`}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>{calls.length} tool call{calls.length !== 1 ? 's' : ''}</span>
        {hasErrors && <span className="text-red-400">· {calls.filter((c) => c.error).length} error{calls.filter((c) => c.error).length !== 1 ? 's' : ''}</span>}
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5 border-l-2 border-white/5 pl-3">
          {calls.map((call, i) => (
            <div key={i} className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-[10px] font-mono">
                <span className={call.error ? 'text-red-400' : 'text-emerald-400/70'}>
                  {call.error ? '✗' : '✓'}
                </span>
                <span className="text-orange-300/80">{call.name}</span>
              </div>
              <p className="text-[10px] font-mono text-gray-700 pl-3 leading-relaxed">
                ← {call.input}
              </p>
              {call.error && (
                <p className="text-[10px] font-mono text-red-400/70 pl-3 leading-relaxed">
                  ! {call.result}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ActionChip({ action, onAction }: { action: ChatAction; onAction: (a: ChatAction) => void }) {
  if (action.type === 'none') return null

  const label =
    action.type === 'swap'
      ? `Swap ${action.amount ? action.amount + ' ' : ''}${action.fromAsset} → ${action.toAsset}`
      : action.type === 'navigate'
      ? `Open ${action.view}`
      : ''

  return (
    <button
      onClick={() => onAction(action)}
      className="mt-2 inline-flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-lg
                 bg-orange-500/15 border border-orange-500/30 text-orange-300
                 hover:bg-orange-500/25 hover:border-orange-500/50 transition-colors"
    >
      <span>→</span>
      <span>{label}</span>
    </button>
  )
}

function MessageBubble({ msg, onAction }: { msg: Message; onAction: (a: ChatAction) => void }) {
  const isUser = msg.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-orange-500/15 border border-orange-500/20 rounded-2xl rounded-tr-sm px-4 py-2.5">
          <p className="text-sm text-gray-200">{msg.content}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3">
      <div className="w-6 h-6 rounded-md bg-white/5 border border-white/10 flex items-center justify-center shrink-0 mt-0.5">
        <span className="text-[10px]">🤖</span>
      </div>
      <div className="flex-1 min-w-0">
        {msg.loading ? (
          <div className="flex items-center gap-1.5 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce [animation-delay:300ms]" />
          </div>
        ) : (
          <div>
            <div className="text-sm text-gray-300 leading-relaxed space-y-1">
              {msg.content.split('\n').map((line, i) => (
                <p key={i}>{renderMarkdown(line)}</p>
              ))}
            </div>
            {msg.action && msg.action.type !== 'none' && (
              <ActionChip action={msg.action} onAction={onAction} />
            )}
            {msg.tool_calls && msg.tool_calls.length > 0 && (
              <ToolTrace calls={msg.tool_calls} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function ChatPanel({ connection, onAction }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleTranscript = useCallback((text: string) => {
    setInput((prev) => (prev ? prev + ' ' + text : text))
  }, [])

  const { listening, supported: speechSupported, toggle: toggleSpeech } = useSpeech(handleTranscript)

  const submit = async (text: string) => {
    if (!text.trim() || sending || connection !== 'live') return
    const userMsg: Message = { role: 'user', content: text.trim() }
    const loadingMsg: Message = { role: 'assistant', content: '', loading: true }

    setMessages((prev) => [...prev, userMsg, loadingMsg])
    setInput('')
    setSending(true)

    const history: ChatMessage[] = [
      ...messages.filter((m) => !m.loading).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text.trim() },
    ]

    try {
      const res = await sendChat(history)
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: res.text, action: res.action, tool_calls: res.tool_calls ?? [] },
      ])
    } catch (err) {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        },
      ])
    } finally {
      setSending(false)
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit(input)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit(input)
    }
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center gap-6 text-center">
            <div className="space-y-2">
              <p className="text-lg font-semibold text-gray-200">
                Bitcoin L2 Wallet Assistant
              </p>
              <p className="text-sm text-gray-500 max-w-sm">
                {connection === 'live'
                  ? 'Ask anything about your wallet, balances, swaps, or channels.'
                  : 'Start the agent to enable live MCP-powered responses.'}
              </p>
            </div>

            {connection === 'live' && (
              <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => submit(s)}
                    className="text-left text-xs text-gray-400 bg-white/[0.02] border border-white/5
                               rounded-lg px-3 py-2.5 hover:bg-white/[0.05] hover:border-white/10
                               hover:text-gray-300 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} onAction={onAction} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-white/5 px-4 py-3 bg-[#0d0d0d]">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                connection !== 'live'
                  ? 'Agent offline — start kaleidoagent first'
                  : 'Ask about your wallet, request a quote, check channels…'
              }
              disabled={connection !== 'live' || sending}
              rows={1}
              className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 pr-3
                         text-sm text-gray-200 placeholder-gray-600 resize-none
                         focus:outline-none focus:border-orange-500/40 focus:bg-white/[0.06]
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors leading-relaxed"
              style={{ minHeight: '42px', maxHeight: '120px' }}
              onInput={(e) => {
                const t = e.currentTarget
                t.style.height = 'auto'
                t.style.height = Math.min(t.scrollHeight, 120) + 'px'
              }}
            />
          </div>

          {/* Voice button */}
          {speechSupported && (
            <button
              type="button"
              onClick={toggleSpeech}
              disabled={connection !== 'live'}
              title={listening ? 'Stop listening' : 'Start voice input'}
              className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0
                         transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                           listening
                             ? 'bg-red-500/20 border-red-500/40 text-red-400 animate-pulse'
                             : 'bg-white/[0.03] border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20'
                         }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 1 0 4 0V5a2 2 0 0 0-2-2zM5.5 10.5a.5.5 0 0 1 .5.5 6 6 0 0 0 12 0 .5.5 0 0 1 1 0 7 7 0 0 1-6.5 6.97V20h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.03A7 7 0 0 1 5 11a.5.5 0 0 1 .5-.5z" />
              </svg>
            </button>
          )}

          {/* Send button */}
          <button
            type="submit"
            disabled={!input.trim() || sending || connection !== 'live'}
            className="w-10 h-10 rounded-xl bg-orange-500 flex items-center justify-center shrink-0
                       hover:bg-orange-600 disabled:opacity-30 disabled:cursor-not-allowed
                       transition-colors"
          >
            {sending ? (
              <svg className="animate-spin w-4 h-4 text-white" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2z" />
              </svg>
            )}
          </button>
        </form>

        <p className="text-[10px] text-gray-700 mt-1.5 font-mono text-center">
          {connection === 'live'
            ? 'MCP · Live data via kaleidoswap-mcp + wdk-wallet-mcp'
            : 'Connect agent to enable live data'}
        </p>
      </div>
    </div>
  )
}
