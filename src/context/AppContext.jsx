import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import {
  initDb, isDbInitialized,
  getAllTableDefs, insertTableDef, updateTableDef, deleteTableDef,
  getAllCategories,  insertCategory,  updateCategory,  deleteCategory,
  getAllProducts,    upsertProduct,   deleteProduct,
  getAllIngredients, upsertIngredient, deleteIngredient,
  replaceVariants,  getAllVariantsAll,
  replaceProductIngredients, getAllProductIngredientsAll,
  getAllModifiers, upsertModifier, deleteModifier,
  getProductModifierExcludes, setProductModifierExclude,
  getEffectiveModifiersForProduct,
  getUnsyncedCount, clearAllDataExceptTables,
} from '../lib/localDb.js'
import { syncToSupabase, pullFromSupabase } from '../lib/sync.js'
import { deleteProductImage, resetSupabaseData, supabase, isSupabaseReady } from '../lib/supabase.js'

async function fetchProfileForUser(authUser) {
  if (!authUser) return null
  let profile = null
  if (isSupabaseReady) {
    try {
      const result = await Promise.race([
        supabase
          .from('profiles')
          .select('full_name, role, can_take_orders, can_close_tables, can_manage_products')
          .eq('id', authUser.id)
          .maybeSingle(),
        new Promise((resolve) => setTimeout(() => {
          console.warn('[Auth] profiles sorgusu 8s içinde dönmedi — varsayılan profil ile devam ediliyor')
          resolve({ data: null, __timedOut: true })
        }, 8000)),
      ])
      profile = result?.data ?? null
    } catch (e) {
      console.warn('[Auth] profiles sorgusu hata verdi — varsayılan profil ile devam ediliyor', e)
    }
  }
  return {
    id:                  authUser.id,
    email:               authUser.email,
    full_name:           profile?.full_name ?? null,
    role:                profile?.role ?? 'waiter',
    can_take_orders:     profile?.can_take_orders     ?? true,
    can_close_tables:    profile?.can_close_tables    ?? false,
    can_manage_products: profile?.can_manage_products ?? false,
  }
}

const AppContext = createContext(null)

// ── Provider ─────────────────────────────────────────────────────
export function AppProvider({ children }) {
  const [dbReady,       setDbReady]       = useState(false)
  const [dbError,       setDbError]       = useState(null)
  const [tableDefs,     setTableDefs]     = useState([])
  const [categories,    setCategories]    = useState([])
  const [products,      setProducts]      = useState([])
  const [ingredients,   setIngredients]   = useState([])
  const [productVariants, setProductVariants] = useState({}) // { [productId]: Variant[] }
  const [productIngredients, setProductIngredients] = useState({}) // { [productId]: [{ingredientId,name,unit,amountUsed}] }
  const [modifiers, setModifiers] = useState([]) // flat list, scope via categoryId|productId
  const [isSyncing,     setIsSyncing]     = useState(false)
  const [lastSyncAt,    setLastSyncAt]    = useState(null)
  const [unsyncedCount, setUnsyncedCount] = useState(0)
  const [syncLogs,      setSyncLogs]      = useState([])
  const [isOnline,      setIsOnline]      = useState(navigator.onLine)
  const [kdvRate,       setKdvRate]       = useState(() => {
    const stored = localStorage.getItem('san-lucas-kdv-rate')
    return stored !== null ? Number(stored) : 10
  })
  const [kdvEnabled,    setKdvEnabled]    = useState(() => {
    const stored = localStorage.getItem('san-lucas-kdv-enabled')
    return stored === null ? true : stored === 'true'
  })
  const [runtimeStates, setRuntimeStates] = useState({})
  const [currentUser,   setCurrentUser]   = useState(null)
  const [authReady,     setAuthReady]     = useState(false)
  const loginUser  = useCallback((u) => setCurrentUser(u), [])
  const logoutUser = useCallback(async () => {
    if (isSupabaseReady) {
      try { await supabase.auth.signOut() } catch (e) { console.error('[Auth] signOut failed', e) }
    }
    setCurrentUser(null)
  }, [])

  // Restore Supabase session on mount + listen for auth state changes.
  useEffect(() => {
    if (!isSupabaseReady) { setAuthReady(true); return }
    let mounted = true
    ;(async () => {
      try {
        // Guard: if getSession ever hangs (e.g. corrupt storage), fall through to
        // login after 12s instead of leaving the app on a permanent white screen.
        // 12s is comfortable for cold-start DNS + first request to Supabase;
        // if it ever fires, onAuthStateChange will still log the user in when
        // the real session eventually resolves in the background.
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise((resolve) => setTimeout(() => {
            console.warn('[Auth] getSession timed out after 12s — showing login; will auto-login if session resolves later')
            resolve({ data: { session: null }, __timedOut: true })
          }, 12000)),
        ])
        const session = result?.data?.session
        if (mounted && session?.user) {
          const u = await fetchProfileForUser(session.user)
          if (mounted) setCurrentUser(u)
        }
      } catch (e) {
        console.error('[Auth] getSession failed', e)
      } finally {
        if (mounted) setAuthReady(true)
      }
    })()
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return
      console.log('[Auth] state change', event, session?.user?.id ?? null)
      if (event === 'SIGNED_OUT' || !session?.user) {
        setCurrentUser(null)
        return
      }
      // SIGNED_IN / TOKEN_REFRESHED — refresh user profile
      const u = await fetchProfileForUser(session.user)
      if (mounted) setCurrentUser(u)
    })
    return () => { mounted = false; sub?.subscription?.unsubscribe() }
  }, [])

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
    setIngredients(getAllIngredients())
    setProductVariants(getAllVariantsAll())
    setProductIngredients(getAllProductIngredientsAll())
    setModifiers(getAllModifiers())
    setUnsyncedCount(getUnsyncedCount())
  }, [])

  const triggerSync = useCallback(async () => {
    if (isSyncing) {
      console.warn('[Sync] ⚠ triggerSync atlandı — başka bir sync zaten çalışıyor (isSyncing=true)')
      return
    }
    if (!isSupabaseReady) {
      console.warn('[Sync] ⚠ triggerSync atlandı — Supabase yapılandırılmamış')
      return
    }
    const t0 = performance.now()
    const pre = isDbInitialized() ? getUnsyncedCount() : 0
    console.log(`[Sync] ▶ triggerSync başlıyor — bekleyen=${pre}, online=${isOnline}`)

    // Surface auth/session state — without a valid JWT, RLS will reject writes silently to the console
    try {
      const { data: sess, error: sessErr } = await supabase.auth.getSession()
      if (sessErr) console.warn('[Sync] auth.getSession hatası', sessErr)
      const u = sess?.session?.user
      console.log('[Sync] session →', {
        userId: u?.id ?? null,
        email: u?.email ?? null,
        hasAccessToken: !!sess?.session?.access_token,
        expiresAt: sess?.session?.expires_at
          ? new Date(sess.session.expires_at * 1000).toISOString()
          : null,
      })
      if (!u) console.warn('[Sync] ⚠ Aktif session yok — RLS koruması varsa yazma işlemleri reddedilir')
    } catch (e) {
      console.warn('[Sync] session okunamadı', e)
    }

    setIsSyncing(true)
    setSyncLogs([])
    const addLog = (type, text) =>
      setSyncLogs(prev => [...prev, { id: Date.now() + Math.random(), time: new Date(), type, text }])
    addLog('info', `Senkronizasyon başlatıldı (bekleyen=${pre})…`)
    try {
      const pushed = await syncToSupabase(addLog)
      console.log('[Sync] push sonucu →', pushed)
      await pullFromSupabase(addLog)
      refreshLocalData()
      const post = isDbInitialized() ? getUnsyncedCount() : 0
      setLastSyncAt(new Date())
      addLog('info', `Senkronizasyon tamamlandı. Kalan bekleyen=${post}`)
      console.log(`[Sync] ✓ bitti — ${Math.round(performance.now() - t0)}ms, kalan bekleyen=${post}`)
    } catch (e) {
      console.error('[Sync] ✗ triggerSync hata', e)
      addLog('error', 'Senkronizasyon hatası: ' + (e.message ?? String(e)))
    } finally {
      setIsSyncing(false)
    }
  }, [isSyncing, isOnline, refreshLocalData])

  const syncIfOnline = useCallback((reason = '?') => {
    console.log(`[Sync] syncIfOnline çağrıldı (sebep=${reason}) — isOnline=${isOnline}, isSyncing=${isSyncing}, supabaseReady=${isSupabaseReady}`)
    if (!isOnline) {
      console.log('[Sync] syncIfOnline atlandı — offline')
      return
    }
    triggerSync()
  }, [isOnline, isSyncing, triggerSync])

  // ── Init DB on mount ───────────────────────────────────────────
  useEffect(() => {
    initDb().then(async () => {
      setTableDefs(getAllTableDefs())
      setCategories(getAllCategories())
      setProducts(getAllProducts())
      setIngredients(getAllIngredients())
      setProductVariants(getAllVariantsAll())
      setProductIngredients(getAllProductIngredientsAll())
      setModifiers(getAllModifiers())
      setUnsyncedCount(getUnsyncedCount())
      setDbReady(true)
      // Guard startup sync — prevents user-triggered syncIfOnline from racing
      // and creating phantom entries from Supabase data not yet in local DB
      setIsSyncing(true)
      try {
        await syncToSupabase()
        await pullFromSupabase()
        setCategories(getAllCategories())
        setProducts(getAllProducts())
        setIngredients(getAllIngredients())
        setProductVariants(getAllVariantsAll())
        setProductIngredients(getAllProductIngredientsAll())
        setModifiers(getAllModifiers())
      } finally {
        setIsSyncing(false)
      }
    }).catch(err => {
      console.error('[AppContext] DB init failed', err)
      setDbError(err.message ?? 'Veritabanı başlatılamadı')
      setDbReady(true)
      setIsSyncing(false)
    })
  }, [])

  // ── Ensure DB is ready (handles HMR resets and failed init) ───
  const ensureDb = useCallback(async () => {
    if (!isDbInitialized()) {
      await initDb()
      setTableDefs(getAllTableDefs())
      setCategories(getAllCategories())
      setProducts(getAllProducts())
      setIngredients(getAllIngredients())
      setProductVariants(getAllVariantsAll())
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
      syncIfOnline('addCategory')
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
      syncIfOnline('editCategory')
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
      syncIfOnline('removeCategory')
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
      syncIfOnline('saveProduct')
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
      syncIfOnline('removeProduct')
      console.log(`[AppContext] ✓ Product deleted (id:${id})`)
    } catch (err) {
      console.error('[AppContext] removeProduct failed', err)
      throw err
    }
  }, [ensureDb, refreshUnsyncedCount, syncIfOnline])

  // ── ingredients actions ───────────────────────────────────────
  const saveIngredient = useCallback(async (data) => {
    try {
      await ensureDb()
      await upsertIngredient(data)
      setIngredients(getAllIngredients())
      refreshUnsyncedCount()
      syncIfOnline('saveIngredient')
    } catch (err) {
      console.error('[AppContext] saveIngredient failed', err)
      throw err
    }
  }, [ensureDb, refreshUnsyncedCount, syncIfOnline])

  const removeIngredient = useCallback(async (id) => {
    try {
      await ensureDb()
      await deleteIngredient(id)
      setIngredients(getAllIngredients())
      refreshUnsyncedCount()
      syncIfOnline('removeIngredient')
    } catch (err) {
      console.error('[AppContext] removeIngredient failed', err)
      throw err
    }
  }, [ensureDb, refreshUnsyncedCount, syncIfOnline])

  // ── product variant actions ───────────────────────────────────
  const saveVariants = useCallback(async (productId, variants) => {
    try {
      await ensureDb()
      await replaceVariants(productId, variants)
      setProductVariants(getAllVariantsAll())
    } catch (err) {
      console.error('[AppContext] saveVariants failed', err)
      throw err
    }
  }, [ensureDb])

  const saveProductIngredients = useCallback(async (productId, rows) => {
    try {
      await ensureDb()
      await replaceProductIngredients(productId, rows)
      setProductIngredients(getAllProductIngredientsAll())
    } catch (err) {
      console.error('[AppContext] saveProductIngredients failed', err)
      throw err
    }
  }, [ensureDb])

  // ── modifiers actions (LOCAL + SUPABASE) ──────────────────────
  const saveModifier = useCallback(async (data) => {
    try {
      await ensureDb()
      const id = await upsertModifier(data)
      setModifiers(getAllModifiers())
      refreshUnsyncedCount()
      syncIfOnline('saveModifier')
      return id
    } catch (err) {
      console.error('[AppContext] saveModifier failed', err)
      throw err
    }
  }, [ensureDb, refreshUnsyncedCount, syncIfOnline])

  const removeModifier = useCallback(async (id) => {
    try {
      await ensureDb()
      await deleteModifier(id)
      setModifiers(getAllModifiers())
      refreshUnsyncedCount()
      syncIfOnline('removeModifier')
    } catch (err) {
      console.error('[AppContext] removeModifier failed', err)
      throw err
    }
  }, [ensureDb, refreshUnsyncedCount, syncIfOnline])

  // Toggle whether a product opts out of an inherited category modifier.
  const setModifierExcluded = useCallback(async (productId, modifierId, excluded) => {
    try {
      await ensureDb()
      await setProductModifierExclude(productId, modifierId, excluded)
      refreshUnsyncedCount()
      syncIfOnline('setModifierExcluded')
    } catch (err) {
      console.error('[AppContext] setModifierExcluded failed', err)
      throw err
    }
  }, [ensureDb, refreshUnsyncedCount, syncIfOnline])

  // Resolve effective modifier list for a product (category-inherited minus
  // excluded, plus product-specific). Pure read — caller passes categoryId
  // from the product to avoid an extra lookup here.
  const effectiveModifiersForProduct = useCallback((productId, categoryId) => {
    if (!isDbInitialized()) return []
    return getEffectiveModifiersForProduct(productId, categoryId)
  }, [modifiers])

  const productModifierExcludes = useCallback((productId) => {
    if (!isDbInitialized()) return []
    return getProductModifierExcludes(productId)
  }, [modifiers])

  const setKdvRatePersist = useCallback((value) => {
    const clamped = Math.max(0, Math.min(100, Number(value) || 0))
    localStorage.setItem('san-lucas-kdv-rate', String(clamped))
    setKdvRate(clamped)
  }, [])

  const setKdvEnabledPersist = useCallback((value) => {
    const next = !!value
    localStorage.setItem('san-lucas-kdv-enabled', String(next))
    setKdvEnabled(next)
  }, [])

  const resetAllData = useCallback(async () => {
    await ensureDb()
    await clearAllDataExceptTables()
    setCategories([])
    setProducts([])
    setUnsyncedCount(0)
  }, [ensureDb])

  const resetOnlineData = useCallback(async () => {
    await resetSupabaseData()
    await ensureDb()
    await clearAllDataExceptTables()
    setCategories([])
    setProducts([])
    setIngredients([])
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
      // Ingredients (local + cloud)
      ingredients, saveIngredient, removeIngredient,
      // Product variants
      productVariants, saveVariants,
      // Product ingredients (direct recipe)
      productIngredients, saveProductIngredients,
      // Modifiers (category- or product-scoped priced extras)
      modifiers, saveModifier, removeModifier,
      setModifierExcluded, productModifierExcludes,
      effectiveModifiersForProduct,
      // Sync
      isSyncing, lastSyncAt, unsyncedCount, triggerSync, refreshUnsyncedCount, isOnline,
      // Reset
      resetAllData, resetOnlineData,
      // Sync logs
      syncLogs,
      // KDV
      kdvRate, setKdvRatePersist,
      kdvEnabled, setKdvEnabledPersist,
      // Active table orders (persists across navigation)
      runtimeStates, setRuntimeStates,
      // Auth
      currentUser, loginUser, logoutUser, authReady,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  return useContext(AppContext)
}
