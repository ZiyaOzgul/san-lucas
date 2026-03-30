import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import {
  initDb, isDbInitialized,
  getAllTableDefs, insertTableDef, updateTableDef, deleteTableDef,
  getAllCategories,  insertCategory,  updateCategory,  deleteCategory,
  getAllProducts,    upsertProduct,   deleteProduct,
  getUnsyncedCount, clearAllDataExceptTables,
} from '../lib/localDb.js'
import { syncToSupabase, pullFromSupabase } from '../lib/sync.js'
import { deleteProductImage } from '../lib/supabase.js'

const AppContext = createContext(null)

// ── Provider ─────────────────────────────────────────────────────
export function AppProvider({ children }) {
  const [dbReady,       setDbReady]       = useState(false)
  const [dbError,       setDbError]       = useState(null)
  const [tableDefs,     setTableDefs]     = useState([])
  const [categories,    setCategories]    = useState([])
  const [products,      setProducts]      = useState([])
  const [isSyncing,     setIsSyncing]     = useState(false)
  const [lastSyncAt,    setLastSyncAt]    = useState(null)
  const [unsyncedCount, setUnsyncedCount] = useState(0)
  const [isOnline,      setIsOnline]      = useState(navigator.onLine)
  const [kdvRate,       setKdvRate]       = useState(() => {
    const stored = localStorage.getItem('san-lucas-kdv-rate')
    return stored !== null ? Number(stored) : 10
  })

  useEffect(() => {
    const up = () => setIsOnline(true)
    const dn = () => setIsOnline(false)
    window.addEventListener('online',  up)
    window.addEventListener('offline', dn)
    return () => {
      window.removeEventListener('online',  up)
      window.removeEventListener('offline', dn)
    }
  }, [])

  const refreshUnsyncedCount = useCallback(() => {
    if (isDbInitialized()) setUnsyncedCount(getUnsyncedCount())
  }, [])

  const refreshLocalData = useCallback(() => {
    setCategories(getAllCategories())
    setProducts(getAllProducts())
    setUnsyncedCount(getUnsyncedCount())
  }, [])

  const triggerSync = useCallback(async () => {
    if (isSyncing) return
    setIsSyncing(true)
    try {
      await syncToSupabase()
      await pullFromSupabase()
      refreshLocalData()
      setLastSyncAt(new Date())
    } catch (e) {
      console.error('[AppContext] sync error', e)
    } finally {
      setIsSyncing(false)
    }
  }, [isSyncing, refreshLocalData])

  const syncIfOnline = useCallback(() => {
    if (isOnline) triggerSync()
  }, [isOnline, triggerSync])

  // ── Init DB on mount ───────────────────────────────────────────
  useEffect(() => {
    initDb().then(async () => {
      setTableDefs(getAllTableDefs())
      setCategories(getAllCategories())
      setProducts(getAllProducts())
      setUnsyncedCount(getUnsyncedCount())
      setDbReady(true)
      // Pull fresh data from Supabase on startup if online
      await pullFromSupabase()
      setCategories(getAllCategories())
      setProducts(getAllProducts())
    }).catch(err => {
      console.error('[AppContext] DB init failed', err)
      setDbError(err.message ?? 'Veritabanı başlatılamadı')
      setDbReady(true) // unblock UI even on error
    })
  }, [])

  // ── Ensure DB is ready (handles HMR resets and failed init) ───
  const ensureDb = useCallback(async () => {
    if (!isDbInitialized()) {
      await initDb()
      setTableDefs(getAllTableDefs())
      setCategories(getAllCategories())
      setProducts(getAllProducts())
      setDbError(null)
    }
  }, [])

  // ── table_defs actions (LOCAL ONLY) ───────────────────────────
  const addTableDef = useCallback(async (name) => {
    try {
      await ensureDb()
      const row = await insertTableDef(name)
      setTableDefs(getAllTableDefs())
      return row
    } catch (err) {
      console.error('[AppContext] addTableDef failed', err)
      throw err
    }
  }, [ensureDb])

  const editTableDef = useCallback(async (id, name) => {
    try {
      await ensureDb()
      await updateTableDef(id, name)
      setTableDefs(getAllTableDefs())
    } catch (err) {
      console.error('[AppContext] editTableDef failed', err)
      throw err
    }
  }, [ensureDb])

  const removeTableDef = useCallback(async (id) => {
    try {
      await ensureDb()
      await deleteTableDef(id)
      setTableDefs(getAllTableDefs())
    } catch (err) {
      console.error('[AppContext] removeTableDef failed', err)
      throw err
    }
  }, [ensureDb])

  // ── categories actions (LOCAL + future SUPABASE) ──────────────
  const addCategory = useCallback(async (fields) => {
    try {
      await ensureDb()
      const row = await insertCategory(fields)
      setCategories(getAllCategories())
      refreshUnsyncedCount()
      syncIfOnline()
      console.log(`[AppContext] ✓ Category added: "${fields.name}" (id:${row?.id})`)
      return row
    } catch (err) {
      console.error('[AppContext] addCategory failed', err)
      throw err
    }
  }, [ensureDb, refreshUnsyncedCount, syncIfOnline])

  const editCategory = useCallback(async (id, fields) => {
    try {
      await ensureDb()
      await updateCategory(id, fields)
      setCategories(getAllCategories())
      refreshUnsyncedCount()
      syncIfOnline()
      console.log(`[AppContext] ✓ Category updated: "${fields.name}" (id:${id})`)
    } catch (err) {
      console.error('[AppContext] editCategory failed', err)
      throw err
    }
  }, [ensureDb, refreshUnsyncedCount, syncIfOnline])

  const removeCategory = useCallback(async (id) => {
    try {
      await ensureDb()
      await deleteCategory(id)
      setCategories(getAllCategories())
      refreshUnsyncedCount()
      syncIfOnline()
      console.log(`[AppContext] ✓ Category deleted (id:${id})`)
    } catch (err) {
      console.error('[AppContext] removeCategory failed', err)
      throw err
    }
  }, [ensureDb, refreshUnsyncedCount, syncIfOnline])

  // ── products actions (LOCAL + SUPABASE) ───────────────────────
  const saveProduct = useCallback(async (data) => {
    try {
      await ensureDb()
      await upsertProduct(data)
      setProducts(getAllProducts())
      refreshUnsyncedCount()
      syncIfOnline()
      console.log(`[AppContext] ✓ Product saved: "${data.name}" ₺${data.price} (id:${data.id ?? 'new'})`)
    } catch (err) {
      console.error('[AppContext] saveProduct failed', err)
      throw err
    }
  }, [ensureDb, refreshUnsyncedCount, syncIfOnline])

  const removeProduct = useCallback(async (id) => {
    try {
      await ensureDb()
      const imageUrl = await deleteProduct(id)
      if (imageUrl && imageUrl.startsWith('/products/')) {
        window.electronAPI?.images?.deleteFile(imageUrl)
        const filename = imageUrl.replace('/products/', '')
        deleteProductImage(filename).catch(() => {})
      }
      setProducts(getAllProducts())
      refreshUnsyncedCount()
      syncIfOnline()
      console.log(`[AppContext] ✓ Product deleted (id:${id})`)
    } catch (err) {
      console.error('[AppContext] removeProduct failed', err)
      throw err
    }
  }, [ensureDb, refreshUnsyncedCount, syncIfOnline])

  const setKdvRatePersist = useCallback((value) => {
    const clamped = Math.max(0, Math.min(100, Number(value) || 0))
    localStorage.setItem('san-lucas-kdv-rate', String(clamped))
    setKdvRate(clamped)
  }, [])

  const resetAllData = useCallback(async () => {
    await ensureDb()
    await clearAllDataExceptTables()
    setCategories([])
    setProducts([])
    setUnsyncedCount(0)
  }, [ensureDb])

  return (
    <AppContext.Provider value={{
      dbReady, dbError,
      // Table defs (local only)
      tableDefs, addTableDef, editTableDef, removeTableDef,
      // Categories (local + cloud)
      categories, addCategory, editCategory, removeCategory,
      // Products (local + cloud)
      products, saveProduct, removeProduct,
      // Sync
      isSyncing, lastSyncAt, unsyncedCount, triggerSync, refreshUnsyncedCount, isOnline,
      // Reset
      resetAllData,
      // KDV
      kdvRate, setKdvRatePersist,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  return useContext(AppContext)
}
