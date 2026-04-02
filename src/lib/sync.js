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
  upsertCategoryFromRemote, upsertProductFromRemote,
  getAllIngredients, upsertIngredient,
  getPendingDeletes, clearPendingDelete,
  persistDb,
} from './localDb.js'

export async function syncToSupabase() {
  if (!isSupabaseReady) {
    console.log('[sync] Supabase not configured — skipping sync')
    return { categories: 0, products: 0, orders: 0, orderItems: 0 }
  }

  let synced = { categories: 0, products: 0, ingredients: 0, orders: 0, orderItems: 0 }

  // ── Pending deletes ────────────────────────────────────────────
  const pendingDeletes = getPendingDeletes()
  for (const pd of pendingDeletes) {
    const table = pd.entity_type === 'product' ? 'products' : 'categories'
    const { error } = await supabase.from(table).delete().eq('id', pd.remote_id)
    if (!error) {
      await clearPendingDelete(pd.id)
      console.log(`[Sync] ✓ Deleted ${pd.entity_type} remote:${pd.remote_id} from Supabase`)
    } else {
      console.error(`[Sync] ✗ Failed to delete ${pd.entity_type} remote:${pd.remote_id}`, error)
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
      console.log(`[Sync] ✓ Category synced: "${name}" (local:${id} → remote:${data.id})`)
    } else if (error) {
      console.error('[Sync] ✗ Category upsert failed', error)
    }
  }

  // ── Ingredients ────────────────────────────────────────────────
  const allIngredients = getAllIngredients()
  const unsyncedIngredients = allIngredients.filter(i => !i.is_synced)
  for (const ing of unsyncedIngredients) {
    const { data, error } = await supabase
      .from('ingredients')
      .upsert(
        { local_id: String(ing.id), name: ing.name, unit: ing.unit, stock_amount: ing.stockAmount, min_stock_alert: ing.minStockAlert },
        { onConflict: 'local_id' }
      )
      .select('id')
      .single()

    if (!error && data) {
      synced.ingredients++
      console.log(`[Sync] ✓ Ingredient synced: "${ing.name}" (local:${ing.id} → remote:${data.id})`)
    } else if (error) {
      console.error('[Sync] ✗ Ingredient upsert failed', error)
    }
  }

  // ── Products ───────────────────────────────────────────────────
  const prods = getUnsyncedProducts()
  for (const [id, name, price, stock, category_id, image_url, recipe] of prods) {
    // If image is a local path, upload to Supabase Storage and get public URL
    let supabaseImageUrl = image_url
    if (image_url && image_url.startsWith('/products/')) {
      try {
        const filename = image_url.replace('/products/', '')
        const bytes = await window.electronAPI?.images?.readFileBytes(image_url)
        if (bytes) {
          supabaseImageUrl = await uploadProductImage(bytes, filename)
          console.log(`[Sync] ↑ Image uploaded: ${filename} → ${supabaseImageUrl}`)
        }
      } catch (imgErr) {
        console.error('[Sync] ✗ Image upload failed — syncing without image', imgErr)
        supabaseImageUrl = null
      }
    }

    const { data, error } = await supabase
      .from('products')
      .upsert(
        { local_id: String(id), name, price, stock, category_id: String(category_id), image_url: supabaseImageUrl, recipe },
        { onConflict: 'local_id' }
      )
      .select('id')
      .single()

    if (!error && data) {
      await markProductSynced(id, data.id)
      synced.products++
      console.log(`[Sync] ✓ Product synced: "${name}" ₺${price} (local:${id} → remote:${data.id})`)
    } else if (error) {
      console.error('[Sync] ✗ Product upsert failed', error)
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
      console.log(`[Sync] ✓ Order synced: local_id=${local_id} | ₺${total} | ${payment_method} | ${status} (remote:${data.id})`)
    } else if (error) {
      console.error('[Sync] ✗ Order upsert failed', error)
    }
  }

  // ── Order items (only after parent order has a remote_id) ──────
  const items = getUnsyncedOrderItems()
  let itemDirty = false
  for (const [id, local_id, order_remote_id, quantity, unit_price] of items) {
    if (!order_remote_id) continue  // parent order not yet synced — skip

    const { error } = await supabase
      .from('order_items')
      .upsert(
        { local_id, order_id: order_remote_id, quantity, unit_price },
        { onConflict: 'local_id' }
      )

    if (!error) {
      markOrderItemSynced(id)
      itemDirty = true
      synced.orderItems++
      console.log(`[Sync] ✓ Order item synced: local_id=${local_id} | qty:${quantity} × ₺${unit_price} → order:${order_remote_id}`)
    } else {
      console.error('[Sync] ✗ Order item upsert failed', error)
    }
  }
  if (itemDirty) await persistDb()

  const anyWork = synced.categories + synced.products + synced.ingredients + synced.orders + synced.orderItems
  if (anyWork > 0) {
    console.log(`[Sync] ── Sync complete ── cats:${synced.categories} prods:${synced.products} ings:${synced.ingredients} orders:${synced.orders} items:${synced.orderItems}`)
  }
  return synced
}

export async function pullFromSupabase() {
  if (!isSupabaseReady) {
    console.log('[Sync] Supabase not configured — skipping pull')
    return
  }

  // Build sets of remote IDs that are pending deletion — skip these during pull
  const pendingDeletes = getPendingDeletes()
  const pendingCatIds  = new Set(pendingDeletes.filter(p => p.entity_type === 'category').map(p => p.remote_id))
  const pendingProdIds = new Set(pendingDeletes.filter(p => p.entity_type === 'product').map(p => p.remote_id))

  // ── Pull categories ────────────────────────────────────────────
  const { data: cats, error: catErr } = await supabase
    .from('categories')
    .select('id, name, color, icon')

  if (catErr) {
    console.error('[Sync] ✗ Failed to pull categories', catErr)
  } else if (cats) {
    for (const c of cats) {
      if (pendingCatIds.has(c.id)) continue  // locally deleted — skip
      await upsertCategoryFromRemote({ remoteId: c.id, name: c.name, color: c.color, icon: c.icon })
    }
    await persistDb()
    console.log(`[Sync] ↓ Pulled ${cats.length} categories from Supabase`)
  }

  // ── Pull ingredients ───────────────────────────────────────────
  const { data: ings, error: ingErr } = await supabase
    .from('ingredients')
    .select('id, name, unit, stock_amount, min_stock_alert')

  if (ingErr) {
    console.error('[Sync] ✗ Failed to pull ingredients', ingErr)
  } else if (ings) {
    for (const ing of ings) {
      await upsertIngredient({
        id:            ing.id,
        name:          ing.name,
        unit:          ing.unit,
        stockAmount:   ing.stock_amount,
        minStockAlert: ing.min_stock_alert,
      })
    }
    await persistDb()
    console.log(`[Sync] ↓ Pulled ${ings.length} ingredients from Supabase`)
  }

  // ── Pull products ──────────────────────────────────────────────
  const { data: prods, error: prodErr } = await supabase
    .from('products')
    .select('id, name, price, stock, category_id, image_url')

  if (prodErr) {
    console.error('[Sync] ✗ Failed to pull products', prodErr)
  } else if (prods) {
    for (const p of prods) {
      if (pendingProdIds.has(p.id)) continue  // locally deleted — skip
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
    console.log(`[Sync] ↓ Pulled ${prods.length} products from Supabase`)
  }
}
