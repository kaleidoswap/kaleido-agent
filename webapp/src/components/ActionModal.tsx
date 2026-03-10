import { ChatAction } from '../api/agent'

interface Props {
  action: ChatAction | null
  onClose: () => void
}

export function ActionModal({ action, onClose }: Props) {
  if (!action || action.type === 'none') return null

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
              This will open the swap flow. The agent never executes swaps automatically.
            </p>

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-xl text-sm border border-white/10 text-gray-400
                           hover:bg-white/[0.03] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-xl text-sm bg-orange-500 text-white
                           hover:bg-orange-600 transition-colors font-medium"
              >
                Open Swap
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
            <p className="text-sm text-gray-400">Open: <span className="font-mono text-gray-200">{action.view}</span></p>
            <button
              onClick={onClose}
              className="w-full py-2 rounded-xl text-sm bg-orange-500 text-white
                         hover:bg-orange-600 transition-colors font-medium"
            >
              OK
            </button>
          </>
        )}
      </div>
    </div>
  )
}
