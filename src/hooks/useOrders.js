import { useState, useEffect } from 'react'

function useOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // TODO: fetch from Supabase or localDb based on online status
    setLoading(false)
  }, [])

  return { orders, loading, setOrders }
}

export default useOrders
