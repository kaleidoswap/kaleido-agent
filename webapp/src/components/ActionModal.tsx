import { useMemo, useState } from 'react'
import { ChatAction, ChatSwapExecutionResponse } from '../api/agent'

interface Props {
  action: ChatAction | null
  onDispatch: (action: ChatAction) => void
  onExecuteSwap: (action: ChatAction) => Promise<ChatSwapExecutionResponse>
  onClose: () => void
}

export function ActionModal({ action, onDispatch, onExecuteSwap, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<ChatSwapExecutionResponse | null>(null)
  const payload = useMemo(() => (action ? JSON.stringify(action, null, 2) : ''), [action])

  if (!action || action.type === 'none') return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const handleDispatch = () => {
    onDispatch(action)
    onClose()
  }

  const handleExecuteSwap = async () => {
    setExecuting(true)
    setResult(null)
    try {
      setResult(await onExecuteSwap(action))
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-[#111] border border-white/10 rounded-2xl p-5 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {action.type === 'swap' && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Confirm Swap</h2>
              <button
                onClick={onClose}
                className="text-gray-600 hover:text-gray-400 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">From</span>
                <span className="font-mono text-gray-200">
                  {action.amount ? `${action.amount} ` : ''}{action.fromAsset}
                </span>
              </div>
              <div className="border-t border-white/5" />
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">To</span>
                <span className="font-mono text-gray-200">{action.toAsset}</span>
              </div>
            </div>

            <p className="text-xs text-gray-600 text-center">
              Confirm here to execute through KaleidoAgent, or forward the intent to a host wallet.
            </p>

            {result && (
              <div className={`rounded-xl border p-3 text-xs ${
                result.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-300'
              }`}>
                <p>{result.text}</p>
                {result.payment_hash && (
                  <p className="mt-2 break-all font-mono text-[11px] text-gray-300">
                    payment_hash: {result.payment_hash}
                  </p>
                )}
              </div>
            )}

            <pre className="overflow-x-auto rounded-xl border border-white/5 bg-black/30 p-3 text-[11px] text-gray-400">
              {payload}
            </pre>

            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={executing}
                className="flex-1 py-2 rounded-xl text-sm border border-white/10 text-gray-400
                           hover:bg-white/[0.03] transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleExecuteSwap()}
                disabled={executing}
                className="flex-1 py-2 rounded-xl text-sm bg-orange-500 text-white
                           hover:bg-orange-600 transition-colors font-medium disabled:opacity-40"
              >
                {executing ? 'Executing…' : 'Execute Here'}
              </button>
              <button
                onClick={handleDispatch}
                disabled={executing}
                className="flex-1 py-2 rounded-xl text-sm border border-orange-500/30 text-orange-300
                           hover:bg-orange-500/10 transition-colors font-medium disabled:opacity-40"
              >
                Send To Host
              </button>
            </div>
            <button
              onClick={() => void handleCopy()}
              className="w-full py-2 rounded-xl text-sm bg-white/[0.03] text-gray-300
                         border border-white/10 hover:bg-white/[0.05] transition-colors font-medium"
            >
              {copied ? 'Copied' : 'Copy Intent'}
            </button>
          </>
        )}

        {action.type === 'navigate' && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Navigate</h2>
              <button
                onClick={onClose}
                className="text-gray-600 hover:text-gray-400 transition-colors"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-gray-400">Suggested view: <span className="font-mono text-gray-200">{action.view}</span></p>
            <pre className="overflow-x-auto rounded-xl border border-white/5 bg-black/30 p-3 text-[11px] text-gray-400">
              {payload}
            </pre>
            <div className="flex gap-2">
              <button
                onClick={handleDispatch}
                className="flex-1 py-2 rounded-xl text-sm border border-orange-500/30 text-orange-300
                           hover:bg-orange-500/10 transition-colors font-medium"
              >
                Send To Host
              </button>
              <button
                onClick={() => void handleCopy()}
                className="flex-1 py-2 rounded-xl text-sm bg-orange-500 text-white
                           hover:bg-orange-600 transition-colors font-medium"
              >
                {copied ? 'Copied' : 'Copy Action'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
