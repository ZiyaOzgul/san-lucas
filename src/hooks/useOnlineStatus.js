import { useState, useEffect, useRef } from 'react'
import { supabase, isSupabaseReady } from '../lib/supabase.js'

function useOnlineStatus({ onReconnect } = {}) {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const onReconnectRef = useRef(onReconnect)
  onReconnectRef.current = onReconnect

  useEffect(() => {
    const handleOnline = async () => {
      // Confirm real Supabase connectivity before declaring online
      if (isSupabaseReady) {
        try {
          await supabase.from('categories').select('id').limit(1)
        } catch {
          return  // browser fired 'online' but Supabase is unreachable
        }
      }
      setIsOnline(true)
      onReconnectRef.current?.()
    }
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return { isOnline }
}

export default useOnlineStatus
