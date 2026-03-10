import { useState } from 'react'
import { ChatAction } from './api/agent'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { ActionModal } from './components/ActionModal'
import { useAgentStatus } from './hooks/useAgentStatus'

export default function App() {
  const { status, connection } = useAgentStatus(5000)
  const [pendingAction, setPendingAction] = useState<ChatAction | null>(null)

  const handleAction = (action: ChatAction) => {
    if (action.type !== 'none') {
      setPendingAction(action)
    }
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#0a0a0a] text-gray-200">
      <Header connection={connection} status={status} />

      <div className="flex flex-1 min-h-0">
        <Sidebar status={status} connection={connection} />
        <main className="flex-1 flex flex-col min-h-0 min-w-0">
          <ChatPanel connection={connection} onAction={handleAction} />
        </main>
      </div>

      <ActionModal
        action={pendingAction}
        onClose={() => setPendingAction(null)}
      />
    </div>
  )
}
