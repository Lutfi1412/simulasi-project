import { useEffect, useRef, useState } from 'react'
import type { Snapshot } from '../../../server/src/api/contract'

export type Connection = 'connecting' | 'live' | 'retrying'

/**
 * Berlangganan snapshot dari /ws. Kalau socket putus, UI mencoba lagi tiap 2 detik
 * dan tetap menampilkan snapshot terakhir (ditandai "menyambung ulang").
 */
export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [connection, setConnection] = useState<Connection>('connecting')
  const [receivedAt, setReceivedAt] = useState(0)
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let stopped = false
    let retry: ReturnType<typeof setTimeout> | null = null

    const loadInitial = async () => {
      try {
        const res = await fetch('/api/snapshot')
        if (res.ok && !stopped) {
          setSnapshot((await res.json()) as Snapshot)
          setReceivedAt(Date.now())
        }
      } catch {
        /* server belum siap; socket akan menyusul */
      }
    }

    const connect = () => {
      if (stopped) return
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/ws`)
      socketRef.current = ws

      ws.onopen = () => setConnection('live')
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as { type: string; data?: Snapshot }
          if (msg.type === 'snapshot' && msg.data) {
            setSnapshot(msg.data)
            setReceivedAt(Date.now())
            setConnection('live')
          }
        } catch {
          /* pesan tidak dikenal diabaikan */
        }
      }
      ws.onclose = () => {
        if (stopped) return
        setConnection('retrying')
        retry = setTimeout(connect, 2000)
      }
      ws.onerror = () => ws.close()
    }

    void loadInitial()
    connect()

    return () => {
      stopped = true
      if (retry) clearTimeout(retry)
      socketRef.current?.close()
    }
  }, [])

  return { snapshot, connection, receivedAt }
}
