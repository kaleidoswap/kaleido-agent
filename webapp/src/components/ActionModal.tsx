import { useMemo, useState } from 'react'
import { ChatAction } from '../api/agent'

interface Props {
  action: ChatAction | null
  onDispatch: (action: ChatAction) => void
  onClose: () => void
}

export function ActionModal({ action, onDispatch, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  if (!action || action.type === 'none') return null

  const payload = useMemo(() => JSON.stringify(action, null, 2), [action])

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
              This dashboard can emit the action to a host wallet via `postMessage` or a `kaleidoagent-action` event.
            </p>

            <pre className="overflow-x-auto rounded-xl border border-white/5 bg-black/30 p-3 text-[11px] text-gray-400">
              {payload}
            </pre>

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-xl text-sm border border-white/10 text-gray-400
                           hover:bg-white/[0.03] transition-colors"
              >
                Cancel
              </button>
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
                {copied ? 'Copied' : 'Copy Intent'}
              </button>
            </div>
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
