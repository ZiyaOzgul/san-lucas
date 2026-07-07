import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
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
  dedupeSyncedEntities, getAllActiveOrders,
  ensurePersistedActiveOrder, setOrderStatus, deleteActiveOrderCascade,
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

function modSum(modifiers) {
  if (!modifiers?.length) return 0
  return modifiers.reduce((s, m) => s + (Number(m.priceDelta) || 0) * (Number(m.quantity) || 1), 0)
}

function groupSubtotal(items) {
  return (items ?? []).reduce((s, i) => s + i.qty * (i.unitPrice + modSum(i.modifiers)), 0)
}

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
  // Loyalty: TL value of 1 point (used when redeeming points at checkout)
  const [pointRate,     setPointRate]     = useState(() => {
    const stored = Number(localStorage.getItem('san-lucas-point-rate'))
    return Number.isFinite(stored) && stored > 0 ? stored : 1
  })
  const [runtimeStates, setRuntimeStates] = useState({})
  const [currentUser,   setCurrentUser]   = useState(null)
  const [authReady,     setAuthReady]     = useState(false)
  // Refs so concurrent-sync checks never read stale state: a sync request that
  // arrives mid-sync is queued (pendingResyncRef) and re-run when the current
  // one finishes, instead of being silently dropped (lost local edits).
  const isSyncingRef      = useRef(false)
  const pendingResyncRef  = useRef(false)
  const initialSyncRanRef = useRef(false)
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

  // After a pull, mirror payments made on other devices into the open
  // tables: refresh paid flags/amounts, and drop groups whose order was
  // completed or cancelled elsewhere.
  const refreshRuntimePaidState = useCallback(() => {
    if (!isDbInitialized()) return
    let actives
    try { actives = getAllActiveOrders() } catch { return }
    const byLocalId = new Map(actives.map(o => [String(o.local_id), o]))
    setRuntimeStates(prev => {
      let changed = false
      const next = {}
      for (const [tid, state] of Object.entries(prev)) {
        const orders = state.orders ?? []
        if (orders.length === 0) { next[tid] = state; continue } // QR-pending tables etc.
        const newOrders = []
        let stateChanged = false
        for (const g of orders) {
          if (!g.persistedOrderId) { newOrders.push(g); continue }
          const o = byLocalId.get(String(g.localId))
          if (!o) { stateChanged = true; continue } // closed/cancelled on another device
          const paidKeys = new Set()
          for (const r of o.items) {
            if (!r.paid) continue
            paidKeys.add(String(r.local_id))
            if (r.remote_id != null) paidKeys.add(String(r.remote_id))
          }
          let groupChanged = (g.paidAmount ?? 0) !== o.totalPaid
          const newItems = g.items.map(i => {
            const paid = paidKeys.has(String(i.id))
            if (!!i.paid !== paid) { groupChanged = true; return { ...i, paid } }
            return i
          })
          if (groupChanged) {
            stateChanged = true
            newOrders.push({ ...g, items: newItems, paidAmount: o.totalPaid })
          } else {
            newOrders.push(g)
          }
        }
        if (newOrders.length === 0) { changed = true; continue } // table fully closed elsewhere
        if (stateChanged) { changed = true; next[tid] = { ...state, orders: newOrders } }
        else next[tid] = state
      }
      return changed ? next : prev
    })
  }, [])

  const triggerSync = useCallback(async () => {
    if (isSyncingRef.current) {
      pendingResyncRef.current = true
      console.warn('[Sync] ⚠ başka bir sync çalışıyor — bu istek kuyruğa alındı, bitince tekrar denenecek')
      return
    }
    if (!isSupabaseReady) {
      console.warn('[Sync] ⚠ triggerSync atlandı — Supabase yapılandırılmamış')
      return
    }
    const t0 = performance.now()
    const pre = isDbInitialized() ? getUnsyncedCount() : 0
    console.log(`[Sync] ▶ triggerSync başlıyor — bekleyen=${pre}, online=${navigator.onLine}`)

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

    isSyncingRef.current = true
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
      refreshRuntimePaidState()
      const post = isDbInitialized() ? getUnsyncedCount() : 0
      setLastSyncAt(new Date())
      addLog('info', `Senkronizasyon tamamlandı. Kalan bekleyen=${post}`)
      console.log(`[Sync] ✓ bitti — ${Math.round(performance.now() - t0)}ms, kalan bekleyen=${post}`)
    } catch (e) {
      console.error('[Sync] ✗ triggerSync hata', e)
      addLog('error', 'Senkronizasyon hatası: ' + (e.message ?? String(e)))
    } finally {
      isSyncingRef.current = false
      setIsSyncing(false)
      if (pendingResyncRef.current) {
        pendingResyncRef.current = false
        console.log('[Sync] ↻ kuyruğa alınmış sync isteği yeniden çalıştırılıyor')
        setTimeout(() => triggerSync(), 0)
      }
    }
  }, [refreshLocalData, refreshRuntimePaidState])

  const syncIfOnline = useCallback((reason = '?') => {
    console.log(`[Sync] syncIfOnline çağrıldı (sebep=${reason}) — isOnline=${navigator.onLine}, supabaseReady=${isSupabaseReady}`)
    if (!navigator.onLine) {
      console.log('[Sync] syncIfOnline atlandı — offline')
      return
    }
    triggerSync()
  }, [triggerSync])

  // Reconnection: the online event alone only flips the banner — actually
  // push the queue + pull fresh data as soon as the network is back.
  useEffect(() => {
    const onReconnect = () => syncIfOnline('reconnect')
    window.addEventListener('online', onReconnect)
    return () => window.removeEventListener('online', onReconnect)
  }, [syncIfOnline])

  // Periodic re-sync: retries failed pushes and picks up remote changes even
  // if no realtime event or local CRUD ever fires (e.g. RLS-empty first pull).
  useEffect(() => {
    if (!dbReady || dbError) return
    const t = setInterval(() => {
      if (initialSyncRanRef.current) syncIfOnline('interval')
    }, 60_000)
    return () => clearInterval(t)
  }, [dbReady, dbError, syncIfOnline])

  // ── Init DB on mount ───────────────────────────────────────────
  useEffect(() => {
    initDb().then(() => {
      setTableDefs(getAllTableDefs())
      setCategories(getAllCategories())
      setProducts(getAllProducts())
      setIngredients(getAllIngredients())
      setProductVariants(getAllVariantsAll())
      setProductIngredients(getAllProductIngredientsAll())
      setModifiers(getAllModifiers())
      setUnsyncedCount(getUnsyncedCount())
      // Rebuild open tables from materialized active orders so a table with
      // partial payments survives an app restart (paid flags included).
      // Tables that never had a partial payment stay in-memory-only as before.
      try {
        const actives = getAllActiveOrders()
        if (actives.length) {
          const hydrated = {}
          for (const o of actives) {
            const isRemote = o.remote_id != null
            const items = o.items.map(r => ({
              // QR items keep their Supabase integer id as the runtime id;
              // manual items use their uuid local_id — matches how
              // ensurePersistedActiveOrder keys the rows.
              id: isRemote && r.remote_id != null ? Number(r.remote_id) : r.local_id,
              productId: r.product_id ?? null,
              variantId: r.variant_id ?? null,
              name: r.name,
              unitPrice: r.unit_price,
              qty: r.quantity,
              note: r.note || '',
              addedAt: r.added_at || o.created_at,
              modifiers: r.modifiers,
              paid: r.paid,
            }))
            const t = hydrated[o.table_id] ?? {
              status: 'occupied',
              type: 'normal',
              openTime: o.created_at
                ? new Date(o.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
                : undefined,
              openedAt: o.created_at,
              waiter: o.waiter_name || '—',
              orders: [],
            }
            t.orders.push({
              localId: o.local_id,
              label: `Sipariş ${t.orders.length + 1}`,
              supabaseOrderId: isRemote ? Number(o.remote_id) : null,
              persistedOrderId: o.id,
              paidAmount: o.totalPaid,
              items,
            })
            hydrated[o.table_id] = t
          }
          setRuntimeStates(hydrated)
          console.log(`[AppContext] ${actives.length} aktif sipariş geri yüklendi (kısmi ödemeli masalar)`)
        }
      } catch (e) {
        console.warn('[AppContext] aktif sipariş geri yükleme hatası', e)
      }
      setDbReady(true)
    }).catch(err => {
      console.error('[AppContext] DB init failed', err)
      setDbError(err.message ?? 'Veritabanı başlatılamadı')
      setDbReady(true)
      setIsSyncing(false)
    })
  }, [])

  // ── Initial sync — gated on BOTH the local DB and the auth session ──
  // Running the first pull before the Supabase session is restored returns
  // zero rows under RLS, which looked like "products never arrive on a
  // fresh install". Guarded via isSyncingRef so a user-triggered
  // syncIfOnline can't race it (it gets queued instead).
  useEffect(() => {
    if (!dbReady || dbError || !authReady || initialSyncRanRef.current) return
    if (!isDbInitialized()) return
    initialSyncRanRef.current = true
    ;(async () => {
      isSyncingRef.current = true
      setIsSyncing(true)
      try {
        await syncToSupabase()
        await pullFromSupabase()
        // One-time merge of duplicates created by the old local_id-only push.
        // Runs after the pull so remote copies are present and get tombstoned;
        // the deletes reach Supabase on the next sync pass.
        const deduped = await dedupeSyncedEntities()
        if (deduped && (deduped.categories || deduped.ingredients)) {
          console.log(`[AppContext] duplicate temizliği: ${deduped.categories} kategori, ${deduped.ingredients} malzeme birleştirildi`)
          pendingResyncRef.current = true
        }
        refreshLocalData()
        refreshRuntimePaidState()
      } catch (e) {
        console.error('[AppContext] açılış senkronizasyonu hata verdi', e)
      } finally {
        isSyncingRef.current = false
        setIsSyncing(false)
        if (pendingResyncRef.current) {
          pendingResyncRef.current = false
          setTimeout(() => triggerSync(), 0)
        }
      }
    })()
  }, [dbReady, dbError, authReady, refreshLocalData, refreshRuntimePaidState, triggerSync])

  // ── Persist every open table (debounced) ───────────────────────
  // Any change to the open tables is materialized into sql.js ~1s later so a
  // crash or restart can't lose an open table — hydration on the next launch
  // rebuilds all of them, not just partially-paid ones. Orders whose group
  // was removed from the UI with nothing paid are cleaned up so they don't
  // resurrect as ghost tables.
  useEffect(() => {
    if (!dbReady || dbError) return
    const t = setTimeout(async () => {
      if (!isDbInitialized()) return
      try {
        const liveGroupIds = new Set()
        for (const [tidStr, state] of Object.entries(runtimeStates)) {
          const tableId = Number(tidStr)
          const groups = state.orders ?? []
          const discount = state.discount?.amount ?? 0
          const allSub = groups.reduce((s, g) => s + groupSubtotal(g.items), 0)
          for (const g of groups) {
            liveGroupIds.add(String(g.localId))
            if (!g.items?.length) continue
            const gSub = groupSubtotal(g.items)
            const gDiscount = allSub > 0 ? discount * (gSub / allSub) : 0
            const gTotal = Math.round((gSub - gDiscount) * 100) / 100
            await ensurePersistedActiveOrder({
              tableId,
              tableName: tableDefs.find(td => td.id === tableId)?.name ?? '',
              waiterName: state.waiter && state.waiter !== '—' ? state.waiter : null,
              groupLocalId: g.localId,
              supabaseOrderId: g.supabaseOrderId ?? null,
              items: g.items,
              total: gTotal,
            })
          }
        }
        for (const o of getAllActiveOrders()) {
          if (liveGroupIds.has(String(o.local_id)) || o.totalPaid > 0) continue
          if (o.remote_id == null) {
            await deleteActiveOrderCascade(o.id) // never left this device — no trace needed
          } else {
            await setOrderStatus(o.id, 'cancelled') // propagates to Supabase on next push
          }
        }
      } catch (e) {
        console.warn('[AppContext] açık masalar kalıcılaştırılamadı', e)
      }
    }, 1000)
    return () => clearTimeout(t)
  }, [runtimeStates, dbReady, dbError, tableDefs])

  // If the user signs in after the initial sync already ran (getSession
  // timeout path or manual login), re-sync so RLS-gated data arrives
  // without an app restart.
  const prevUserIdRef = useRef(null)
  useEffect(() => {
    const uid = currentUser?.id ?? null
    if (uid && !prevUserIdRef.current && initialSyncRanRef.current && dbReady && !dbError) {
      syncIfOnline('auth-restored')
    }
    prevUserIdRef.current = uid
  }, [currentUser, dbReady, dbError, syncIfOnline])

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

  const setPointRatePersist = useCallback((value) => {
    const n = Number(String(value).replace(',', '.'))
    const clamped = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 1
    localStorage.setItem('san-lucas-point-rate', String(clamped))
    setPointRate(clamped)
  }, [])

  const resetAllData = useCallback(async () => {
    await ensureDb()
    await clearAllDataExceptTables()
    setRuntimeStates({}) // open tables reference deleted rows — drop them too
    refreshLocalData()
  }, [ensureDb, refreshLocalData])

  const resetOnlineData = useCallback(async () => {
    await resetSupabaseData()
    await ensureDb()
    await clearAllDataExceptTables()
    setRuntimeStates({})
    refreshLocalData()
  }, [ensureDb, refreshLocalData])

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
      // Loyalty points
      pointRate, setPointRatePersist,
      // Active table orders (persists across navigation)
      runtimeStates, setRuntimeStates,
      // Auth
      currentUser, loginUser, logoutUser, authReady,
    }}>
      {children}
    </AppContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- context provider + hook are co-located by design
export function useApp() {
  return useContext(AppContext)
}
