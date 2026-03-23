import React from 'react'

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#0a0a0a] text-gray-200 gap-4">
        <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center">
          <span className="text-lg">!</span>
        </div>
        <p className="text-sm font-mono text-gray-400">Something went wrong</p>
        <p className="text-xs font-mono text-gray-600 max-w-md text-center">
          {this.state.error?.message}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="text-xs font-mono px-4 py-2 rounded-lg bg-white/5 border border-white/10
                     hover:bg-white/10 transition-colors"
        >
          Reload
        </button>
      </div>
    )
  }
}
