import { useState, useEffect } from 'react'

function useTables() {
  const [tables, setTables] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // TODO: fetch from Supabase or localDb based on online status
    setLoading(false)
  }, [])

  return { tables, loading, setTables }
}

export default useTables
