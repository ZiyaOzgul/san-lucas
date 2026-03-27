import { useState, useEffect } from 'react'

function useProducts() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // TODO: fetch from Supabase or localDb based on online status
    setLoading(false)
  }, [])

  return { products, loading, setProducts }
}

export default useProducts
