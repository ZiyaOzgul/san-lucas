/**
 * sync.js
 * Pushes locally-created/updated records (is_synced = 0) up to Supabase.
 * Called after network reconnection or on a periodic interval.
 *
 * Only categories and products are synced — table_defs are local-only.
 */

import { supabase, isSupabaseReady } from './supabase.js'
import {
  getUnsyncedCategories, markCategorySynced,
  getUnsyncedProducts,   markProductSynced,
  getUnsyncedOrders,     markOrderSynced,
  getUnsyncedOrderItems, markOrderItemSynced,
  persistDb,
} from './localDb.js'

export async function syncToSupabase() {
  if (!isSupabaseReady) {
    console.log('[sync] Supabase not configured — skipping sync')
    return { categories: 0, products: 0, orders: 0, orderItems: 0 }
  }

  let synced = { categories: 0, products: 0, orders: 0, orderItems: 0 }

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
    } else if (error) {
      console.error('[sync] category upsert failed', error)
    }
  }

  // ── Products ───────────────────────────────────────────────────
  const prods = getUnsyncedProducts()
  for (const [id, name, price, stock, category_id, image_url, recipe] of prods) {
    const { data, error } = await supabase
      .from('products')
      .upsert(
        { local_id: String(id), name, price, stock, category_id: String(category_id), image_url, recipe },
        { onConflict: 'local_id' }
      )
      .select('id')
      .single()

    if (!error && data) {
      await markProductSynced(id, data.id)
      synced.products++
    } else if (error) {
      console.error('[sync] product upsert failed', error)
    }
  }

  // ── Orders ─────────────────────────────────────────────────────
  const orders = getUnsyncedOrders()
  for (const [id, local_id, status, payment_method, total, created_at, closed_at] of orders) {
    const { data, error } = await supabase
      .from('orders')
      .upsert(
        { local_id, status, payment_method, total, created_at, closed_at },
        { onConflict: 'local_id' }
      )
      .select('id')
      .single()

    if (!error && data) {
      await markOrderSynced(id, data.id)
      synced.orders++
    } else if (error) {
      console.error('[sync] order upsert failed', error)
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
    } else {
      console.error('[sync] order_item upsert failed', error)
    }
  }
  if (itemDirty) await persistDb()

  console.log(`[sync] done — cats:${synced.categories} prods:${synced.products} orders:${synced.orders} items:${synced.orderItems}`)
  return synced
}
