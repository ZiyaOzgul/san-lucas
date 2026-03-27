import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import {
  initDb, isDbInitialized,
  getAllTableDefs, insertTableDef, updateTableDef, deleteTableDef,
  getAllCategories,  insertCategory,  updateCategory,  deleteCategory,
  getAllProducts,    upsertProduct,   deleteProduct,
  getUnsyncedCount,
} from '../lib/localDb.js'
import { syncToSupabase } from '../lib/sync.js'

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

  const refreshUnsyncedCount = useCallback(() => {
    if (isDbInitialized()) setUnsyncedCount(getUnsyncedCount())
  }, [])

  const triggerSync = useCallback(async () => {
    if (isSyncing) return
    setIsSyncing(true)
    try {
      await syncToSupabase()
      setLastSyncAt(new Date())
      setUnsyncedCount(getUnsyncedCount())
    } catch (e) {
      console.error('[AppContext] sync error', e)
    } finally {
      setIsSyncing(false)
    }
  }, [isSyncing])

  // ── Init DB on mount ───────────────────────────────────────────
  useEffect(() => {
    initDb().then(() => {
      setTableDefs(getAllTableDefs())
      setCategories(getAllCategories())
      setProducts(getAllProducts())
      setUnsyncedCount(getUnsyncedCount())
      setDbReady(true)
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
      return row
    } catch (err) {
      console.error('[AppContext] addCategory failed', err)
      throw err
    }
  }, [ensureDb, refreshUnsyncedCount])

  const editCategory = useCallback(async (id, fields) => {
    try {
      await ensureDb()
      await updateCategory(id, fields)
      setCategories(getAllCategories())
      refreshUnsyncedCount()
    } catch (err) {
      console.error('[AppContext] editCategory failed', err)
      throw err
    }
  }, [ensureDb, refreshUnsyncedCount])

  const removeCategory = useCallback(async (id) => {
    try {
      await ensureDb()
      await deleteCategory(id)
      setCategories(getAllCategories())
      refreshUnsyncedCount()
    } catch (err) {
      console.error('[AppContext] removeCategory failed', err)
      throw err
    }
  }, [ensureDb, refreshUnsyncedCount])

  // ── products actions (LOCAL + future SUPABASE) ────────────────
  const saveProduct = useCallback(async (data) => {
    try {
      await ensureDb()
      await upsertProduct(data)
      setProducts(getAllProducts())
      refreshUnsyncedCount()
    } catch (err) {
      console.error('[AppContext] saveProduct failed', err)
      throw err
    }
  }, [ensureDb, refreshUnsyncedCount])

  const removeProduct = useCallback(async (id) => {
    try {
      await ensureDb()
      await deleteProduct(id)
      setProducts(getAllProducts())
      refreshUnsyncedCount()
    } catch (err) {
      console.error('[AppContext] removeProduct failed', err)
      throw err
    }
  }, [ensureDb, refreshUnsyncedCount])

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
      isSyncing, lastSyncAt, unsyncedCount, triggerSync, refreshUnsyncedCount,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  return useContext(AppContext)
}
