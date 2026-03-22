import { useEffect, useState } from 'react'
import { LoopType, triggerLoop, getSkills, type SkillInfo, type ChatAction } from './api/agent'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { ActionModal } from './components/ActionModal'
import { SettingsPanel } from './components/SettingsPanel'
import { ConnectionsPanel } from './components/ConnectionsPanel'
import { SkillsPanel } from './components/SkillsPanel'
import { TasksPanel } from './components/TasksPanel'
import { useAgentStatus } from './hooks/useAgentStatus'

type Tab = 'chat' | 'connect' | 'skills' | 'tasks'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'chat',    label: 'Chat',     icon: '💬' },
  { id: 'connect', label: 'Connect',  icon: '🔗' },
  { id: 'skills',  label: 'Skills',   icon: '⚡' },
  { id: 'tasks',   label: 'Tasks',    icon: '📅' },
]

export default function App() {
  const { status, connection, refresh } = useAgentStatus(5000)
  const [pendingAction, setPendingAction] = useState<ChatAction | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [runningLoop, setRunningLoop] = useState<LoopType | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [skills, setSkills] = useState<SkillInfo[]>([])

  useEffect(() => {
    void getSkills().then(setSkills)
  }, [connection])

  const handleAction = (action: ChatAction) => {
    if (action.type !== 'none') setPendingAction(action)
  }

  const handleDispatchAction = (action: ChatAction) => {
    window.dispatchEvent(new CustomEvent('kaleidoagent-action', { detail: action }))
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'kaleidoagent-action', action }, '*')
    }
  }

  const handleRunLoop = async (loop: LoopType) => {
    setRunError(null)
    setRunningLoop(loop)
    const result = await triggerLoop(loop)
    setRunningLoop(null)
    await refresh()
    if (!result.ok) setRunError(result.error ?? `Failed to run ${loop}`)
  }

  const enabledSkillCount = skills.filter((s) => s.enabled).length
  const isOffline = connection === 'offline'

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#0a0a0a] text-gray-200">
      <Header connection={connection} status={status} onSettingsClick={() => setSettingsOpen(true)} />

      {/* Tab navigation */}
      <div className="flex border-b border-white/5 bg-[#0d0d0d] shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-5 py-3 text-[11px] font-mono transition-colors relative ${
              activeTab === tab.id
                ? 'text-orange-400 border-b-2 border-orange-500 -mb-px'
                : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            <span>{tab.icon}</span>
            <span className="uppercase tracking-widest">{tab.label}</span>

            {/* Badge: skill count */}
            {tab.id === 'skills' && enabledSkillCount > 0 && (
              <span className="ml-1 text-[9px] bg-orange-500/20 text-orange-400 rounded-full px-1.5 py-0.5 font-mono">
                {enabledSkillCount}
              </span>
            )}

            {/* Badge: offline warning on Connect tab */}
            {tab.id === 'connect' && isOffline && (
              <span className="ml-1 w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
            )}
          </button>
        ))}
      </div>

      {/* Main layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar: always shown for agent stats */}
        <Sidebar
          status={status}
          connection={connection}
          runningLoop={runningLoop}
          runError={runError}
          onRunLoop={handleRunLoop}
        />

        {/* Tab content */}
        <main className="flex-1 flex flex-col min-h-0 min-w-0 overflow-y-auto">
          {activeTab === 'chat' && (
            <ChatPanel
              connection={connection}
              onAction={handleAction}
              onNavigate={(tab) => setActiveTab(tab as Tab)}
            />
          )}
          {activeTab === 'connect' && (
            <ConnectionsPanel connection={connection} />
          )}
          {activeTab === 'skills' && (
            <SkillsPanel connection={connection} />
          )}
          {activeTab === 'tasks' && (
            <TasksPanel connection={connection} skills={skills} />
          )}
        </main>
      </div>

      <ActionModal
        action={pendingAction}
        onDispatch={handleDispatchAction}
        onClose={() => setPendingAction(null)}
      />
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
