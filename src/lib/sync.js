/**
 * sync.js
 * Pushes locally-created/updated records (is_synced = 0) up to Supabase.
 * Called after network reconnection or on a periodic interval.
 *
 * Only categories and products are synced — table_defs are local-only.
 */

import { supabase, isSupabaseReady, uploadProductImage } from './supabase.js'
import {
  getUnsyncedCategories, markCategorySynced,
  getUnsyncedProducts,   markProductSynced,
  getUnsyncedOrders,     markOrderSynced,
  getUnsyncedOrderItems, markOrderItemSynced,
  upsertCategoryFromRemote, upsertProductFromRemote, upsertIngredientFromRemote,
  getAllIngredients, upsertIngredient, markIngredientSynced,
  getUnsyncedVariants, markVariantSynced,
  getPendingDeletes, clearPendingDelete,
  getCategoryRemoteId,
  persistDb,
} from './localDb.js'

export async function syncToSupabase(log = null) {
  const ok  = (msg) => { console.log(msg);        log?.('success', msg) }
  const inf = (msg) => { console.log(msg);        log?.('info',    msg) }
  const err = (msg, e) => { console.error(msg, e); log?.('error',  msg) }

  if (!isSupabaseReady) {
    inf('[Sync] Supabase yapılandırılmamış — senkronizasyon atlandı')
    return { categories: 0, products: 0, orders: 0, orderItems: 0 }
  }

  let synced = { categories: 0, products: 0, ingredients: 0, variants: 0, orders: 0, orderItems: 0 }

  // ── Pending deletes ────────────────────────────────────────────
  const pendingDeletes = getPendingDeletes()
  for (const pd of pendingDeletes) {
    const tableMap = { product: 'products', category: 'categories', ingredient: 'ingredients' }
    const table = tableMap[pd.entity_type]
    if (!table) { await clearPendingDelete(pd.id); continue }
    const { error } = await supabase.from(table).delete().eq('id', pd.remote_id)
    if (!error) {
      await clearPendingDelete(pd.id)
      ok(`[Sync] ✓ Silindi: ${pd.entity_type} remote:${pd.remote_id}`)
    } else {
      err(`[Sync] ✗ Silinemedi: ${pd.entity_type} remote:${pd.remote_id}`, error)
    }
  }

  // ── Categories ─────────────────────────────────────────────────
  const cats = getUnsyncedCategories()
  for (const [id, name, color, icon] of cats) {
    const { data, error } = await supabase
      .from('categories')
      .upsert({ local_id: String(id), name, color, icon }, { onConflict: 'local_id' })
      .select('id')
      .single()

    if (!error && data) {
      await markCategorySynced(id, data.id)
      synced.categories++
      ok(`[Sync] ✓ Kategori: "${name}" (local:${id} → remote:${data.id})`)
    } else if (error) {
      err('[Sync] ✗ Kategori yüklenemedi', error)
    }
  }

  // ── Ingredients ────────────────────────────────────────────────
  const allIngredients = getAllIngredients()
  const unsyncedIngredients = allIngredients.filter(i => !i.is_synced)
  for (const ing of unsyncedIngredients) {
    const { data, error } = await supabase
      .from('ingredients')
      .upsert(
        { local_id: String(ing.id), name: ing.name, unit: ing.unit, stock_amount: ing.stockAmount, min_stock_alert: ing.minStockAlert, container_name: ing.containerName ?? null, container_size: ing.containerSize ?? 0, image_url: ing.imageUrl ?? null },
        { onConflict: 'local_id' }
      )
      .select('id')
      .single()

    if (!error && data) {
      await markIngredientSynced(ing.id, data.id)
      synced.ingredients++
      ok(`[Sync] ✓ Malzeme: "${ing.name}" (local:${ing.id} → remote:${data.id})`)
    } else if (error) {
      err('[Sync] ✗ Malzeme yüklenemedi', error)
    }
  }

  // ── Products ───────────────────────────────────────────────────
  const prods = getUnsyncedProducts()
  for (const [id, name, price, stock, category_id, image_url, recipe] of prods) {
    let supabaseImageUrl = image_url
    if (image_url && image_url.startsWith('/products/')) {
      try {
        const filename = image_url.replace('/products/', '')
        const bytes = await window.electronAPI?.images?.readFileBytes(image_url)
        if (bytes) {
          supabaseImageUrl = await uploadProductImage(bytes, filename)
          inf(`[Sync] ↑ Görsel yüklendi: ${filename}`)
        }
      } catch (imgErr) {
        err('[Sync] ✗ Görsel yüklenemedi — görselsiz devam ediliyor', imgErr)
        supabaseImageUrl = null
      }
    }

    const remoteCatId = getCategoryRemoteId(category_id)
    const { data, error } = await supabase
      .from('products')
      .upsert(
        { local_id: String(id), name, price, stock, category_id: remoteCatId ? Number(remoteCatId) : null, image_url: supabaseImageUrl, recipe },
        { onConflict: 'local_id' }
      )
      .select('id')
      .single()

    if (!error && data) {
      await markProductSynced(id, data.id)
      synced.products++
      ok(`[Sync] ✓ Ürün: "${name}" ₺${price} (local:${id} → remote:${data.id})`)
    } else if (error) {
      err('[Sync] ✗ Ürün yüklenemedi', error)
    }
  }

  // ── Product Variants ───────────────────────────────────────────
  const variants = getUnsyncedVariants()
  for (const [id, local_id, product_remote_id, name, price] of variants) {
    if (!product_remote_id) continue
    const { data, error } = await supabase
      .from('product_variants')
      .upsert(
        { local_id: String(local_id ?? id), product_id: Number(product_remote_id), name, price },
        { onConflict: 'local_id' }
      )
      .select('id')
      .single()
    if (!error && data) {
      await markVariantSynced(id, data.id)
      synced.variants++
      ok(`[Sync] ✓ Varyant: "${name}" ₺${price} (local:${id} → remote:${data.id})`)
    } else if (error) {
      err('[Sync] ✗ Varyant yüklenemedi', error)
    }
  }

  // ── Orders ─────────────────────────────────────────────────────
  const orders = getUnsyncedOrders()
  for (const [id, local_id, table_id, status, payment_method, total, created_at, closed_at, waiter_name] of orders) {
    const { data, error } = await supabase
      .from('orders')
      .upsert(
        { local_id, table_id, status, payment_method, total, created_at, closed_at, waiter_name: waiter_name ?? null },
        { onConflict: 'local_id' }
      )
      .select('id')
      .single()

    if (!error && data) {
      await markOrderSynced(id, data.id)
      synced.orders++
      ok(`[Sync] ✓ Sipariş: ₺${total} | ${payment_method} | ${status} (remote:${data.id})`)
    } else if (error) {
      err('[Sync] ✗ Sipariş yüklenemedi', error)
    }
  }

  // ── Order items ────────────────────────────────────────────────
  const items = getUnsyncedOrderItems()
  let itemDirty = false
  for (const [id, local_id, order_remote_id, quantity, unit_price, product_remote_id, variant_remote_id] of items) {
    if (!order_remote_id) continue

    const { error } = await supabase
      .from('order_items')
      .upsert(
        { local_id, order_id: order_remote_id, quantity, unit_price,
          product_id: product_remote_id ? Number(product_remote_id) : null,
          variant_id: variant_remote_id ? Number(variant_remote_id) : null },
        { onConflict: 'local_id' }
      )

    if (!error) {
      markOrderItemSynced(id)
      itemDirty = true
      synced.orderItems++
      ok(`[Sync] ✓ Sipariş kalemi: ${quantity}× ₺${unit_price} → sipariş:${order_remote_id}`)
    } else {
      err('[Sync] ✗ Sipariş kalemi yüklenemedi', error)
    }
  }
  if (itemDirty) await persistDb()

  const anyWork = synced.categories + synced.products + synced.ingredients + synced.variants + synced.orders + synced.orderItems
  if (anyWork > 0) {
    inf(`[Sync] ── Yükleme tamamlandı ── kat:${synced.categories} ürün:${synced.products} malz:${synced.ingredients} varyant:${synced.variants} sipariş:${synced.orders} kalem:${synced.orderItems}`)
  } else {
    inf('[Sync] Yüklenecek yeni kayıt yok')
  }
  return synced
}

export async function pullFromSupabase(log = null) {
  const ok  = (msg) => { console.log(msg);        log?.('success', msg) }
  const err = (msg, e) => { console.error(msg, e); log?.('error',  msg) }

  if (!isSupabaseReady) {
    log?.('info', '[Sync] Supabase yapılandırılmamış — çekme atlandı')
    return
  }

  const pendingDeletes = getPendingDeletes()
  const pendingCatIds  = new Set(pendingDeletes.filter(p => p.entity_type === 'category').map(p => p.remote_id))
  const pendingProdIds = new Set(pendingDeletes.filter(p => p.entity_type === 'product').map(p => p.remote_id))
  const pendingIngIds  = new Set(pendingDeletes.filter(p => p.entity_type === 'ingredient').map(p => p.remote_id))

  // ── Pull categories ────────────────────────────────────────────
  const { data: cats, error: catErr } = await supabase
    .from('categories')
    .select('id, name, color, icon')

  if (catErr) {
    err('[Sync] ✗ Kategoriler çekilemedi', catErr)
  } else if (cats) {
    for (const c of cats) {
      if (pendingCatIds.has(c.id)) continue
      await upsertCategoryFromRemote({ remoteId: c.id, name: c.name, color: c.color, icon: c.icon })
    }
    await persistDb()
    ok(`[Sync] ↓ ${cats.length} kategori çekildi`)
  }

  // ── Pull ingredients ───────────────────────────────────────────
  const { data: ings, error: ingErr } = await supabase
    .from('ingredients')
    .select('id, name, unit, stock_amount, min_stock_alert')

  if (ingErr) {
    err('[Sync] ✗ Malzemeler çekilemedi', ingErr)
  } else if (ings) {
    for (const ing of ings) {
      if (pendingIngIds.has(ing.id)) continue
      await upsertIngredientFromRemote({
        remoteId:      ing.id,
        name:          ing.name,
        unit:          ing.unit,
        stockAmount:   ing.stock_amount,
        minStockAlert: ing.min_stock_alert,
      })
    }
    await persistDb()
    ok(`[Sync] ↓ ${ings.length} malzeme çekildi`)
  }

  // ── Pull products ──────────────────────────────────────────────
  const { data: prods, error: prodErr } = await supabase
    .from('products')
    .select('id, name, price, stock, category_id, image_url')

  if (prodErr) {
    err('[Sync] ✗ Ürünler çekilemedi', prodErr)
  } else if (prods) {
    for (const p of prods) {
      if (pendingProdIds.has(p.id)) continue
      await upsertProductFromRemote({
        remoteId: p.id,
        name: p.name,
        price: p.price,
        stock: p.stock,
        remoteCatId: p.category_id,
        imageUrl: p.image_url,
      })
    }
    await persistDb()
    ok(`[Sync] ↓ ${prods.length} ürün çekildi`)
  }
}
