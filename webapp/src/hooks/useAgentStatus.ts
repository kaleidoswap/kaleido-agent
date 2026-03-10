import { useEffect, useRef, useState } from 'react'
import { AgentStatus, checkHealth, getStatus } from '../api/agent'

export type ConnectionState = 'connecting' | 'live' | 'offline'

export function useAgentStatus(intervalMs = 5000) {
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = async () => {
    const healthy = await checkHealth()
    if (!healthy) {
      setConnection('offline')
      setStatus(null)
      return
    }
    const data = await getStatus()
    if (data) {
      setStatus(data)
      setConnection('live')
    } else {
      setConnection('offline')
    }
  }

  useEffect(() => {
    poll()
    timerRef.current = setInterval(poll, intervalMs)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [intervalMs])

  return { status, connection, refresh: poll }
}
