import { useCallback, useEffect, useRef, useState } from 'react'
import type { CV } from '../types'
import { ApiError, getCV, saveCV } from './api'

export type CVStoreStatus = 'loading' | 'ready' | 'saving' | 'saved' | 'error'

export function useCVStore(id: string) {
  const [cv, setCV] = useState<CV | null>(null)
  const [status, setStatus] = useState<CVStoreStatus>('loading')
  const [error, setError] = useState<string | undefined>()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef<CV | null>(null)

  const load = useCallback(async () => {
    setStatus('loading')
    setError(undefined)
    try {
      const envelope = await getCV(id)
      const loaded = envelope.profileSnapshot as unknown as CV
      latest.current = loaded
      setCV(loaded)
      setStatus('ready')
    } catch (err) {
      setStatus('error')
      setError(err instanceof ApiError ? err.message : 'Không tải được CV')
    }
  }, [id])

  useEffect(() => {
    void load()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [load])

  const update = useCallback((next: CV) => {
    latest.current = next
    setCV(next)
    setError(undefined)
    setStatus('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const value = latest.current
      if (!value) return
      void saveCV(id, value)
        .then(() => setStatus('saved'))
        .catch((err: unknown) => {
          setStatus('error')
          setError(err instanceof ApiError ? err.message : 'Không lưu được CV')
        })
    }, 500)
  }, [id])

  return { cv, status, error, update, reload: load }
}
