/**
 * sync.js
 * Pushes locally-created/updated records (is_synced = 0) up to Supabase.
 * Called after network reconnection or on a periodic interval.
 *
 * Only categories and products are synced — table_defs are local-only.
 */

import { supabase, isSupabaseReady, uploadProductImage, uploadCategoryImage } from './supabase.js'
import {
  getUnsyncedCategories, markCategorySynced,
  getUnsyncedProducts,   markProductSynced,
  getUnsyncedOrders,     markOrderSynced,
  getUnsyncedOrderItems, markOrderItemSynced,
  upsertCategoryFromRemote, upsertProductFromRemote, upsertIngredientFromRemote,
  upsertModifierFromRemote, upsertProductModifierExcludeFromRemote,
  getAllIngredients, upsertIngredient, markIngredientSynced,
  getUnsyncedVariants, markVariantSynced,
  getUnsyncedModifiers, markModifierSynced,
  getUnsyncedProductModifierExcludes, markProductModifierExcludeSynced,
  getUnsyncedOrderItemModifiers, markOrderItemModifierSynced,
  getPendingDeletes, clearPendingDelete,
  getCategoryRemoteId,
  getUnsyncedPayments, markPaymentSynced,
  getUnsyncedPaymentItems, markPaymentItemSynced,
  setOrderItemRemoteId,
  persistDb,
} from './localDb.js'

function fmtErr(e) {
  if (!e) return '(boş hata)'
  // Supabase / PostgREST error shape: { code, message, details, hint }
  const parts = []
  if (e.code) parts.push(`code=${e.code}`)
  if (e.message) parts.push(`msg=${e.message}`)
  if (e.details) parts.push(`details=${e.details}`)
  if (e.hint) parts.push(`hint=${e.hint}`)
  if (e.status) parts.push(`status=${e.status}`)
  return parts.length ? parts.join(' | ') : String(e)
}

export async function syncToSupabase(log = null) {
  const ok  = (msg) => { console.log(msg);        log?.('success', msg) }
  const inf = (msg) => { console.log(msg);        log?.('info',    msg) }
  const err = (msg, e) => { console.error(msg, fmtErr(e), e); log?.('error',  `${msg} — ${fmtErr(e)}`) }

  if (!isSupabaseReady) {
    inf('[Sync] Supabase yapılandırılmamış — senkronizasyon atlandı')
    return { categories: 0, products: 0, orders: 0, orderItems: 0 }
  }

  let synced = { categories: 0, products: 0, ingredients: 0, variants: 0, orders: 0, orderItems: 0, payments: 0, paymentItems: 0 }

  // Snapshot unsynced counts so we know what we *think* needs pushing before we start
  const _preCats   = getUnsyncedCategories().length
  const _preIngs   = getAllIngredients().filter(i => !i.is_synced).length
  const _preProds  = getUnsyncedProducts().length
  const _preVars   = getUnsyncedVariants().length
  const _preOrders = getUnsyncedOrders().length
  const _preItems  = getUnsyncedOrderItems().length
  const _prePays   = getUnsyncedPayments().length
  const _preDel    = getPendingDeletes().length
  inf(`[Sync] ⇧ push başlıyor — kat:${_preCats} malz:${_preIngs} ürün:${_preProds} varyant:${_preVars} sipariş:${_preOrders} kalem:${_preItems} ödeme:${_prePays} sil:${_preDel}`)

  // ── Pending deletes ────────────────────────────────────────────
  const pendingDeletes = getPendingDeletes()
  for (const pd of pendingDeletes) {
    const tableMap = { product: 'products', category: 'categories', ingredient: 'ingredients', modifier: 'modifiers' }
    const table = tableMap[pd.entity_type]
    if (!table) { await clearPendingDelete(pd.id); continue }
    const { error } = await supabase.from(table).delete().eq('id', pd.remote_id)
    if (!error) {
      await clearPendingDelete(pd.id)
      ok(`[Sync] ✓ Silindi: ${pd.entity_type} remote:${pd.remote_id}`)
    } else if (error.code === '23503' && pd.entity_type === 'product') {
      // Product is referenced by order_items — soft-delete instead of hard delete
      const { error: softErr } = await supabase
        .from('products')
        .update({ is_active: false })
        .eq('id', pd.remote_id)
      if (!softErr) {
        await clearPendingDelete(pd.id)
        ok(`[Sync] ✓ Ürün deaktive edildi (siparişlerde kullanıldığı için): remote:${pd.remote_id}`)
      } else {
        err(`[Sync] ✗ Ürün deaktive edilemedi: remote:${pd.remote_id}`, softErr)
      }
    } else {
      err(`[Sync] ✗ Silinemedi: ${pd.entity_type} remote:${pd.remote_id}`, error)
    }
  }

  // ── Categories ─────────────────────────────────────────────────
  const cats = getUnsyncedCategories()
  for (const [id, name, color, icon, image_url] of cats) {
    let supabaseCatImageUrl = image_url
    if (image_url && image_url.startsWith('/products/')) {
      try {
        const filename = image_url.replace('/products/', '')
        const bytes = await window.electronAPI?.images?.readFileBytes(image_url)
        if (bytes) {
          supabaseCatImageUrl = await uploadCategoryImage(bytes, filename)
          inf(`[Sync] ↑ Kategori görseli yüklendi: ${filename}`)
        }
      } catch (imgErr) {
        err('[Sync] ✗ Kategori görseli yüklenemedi — görselsiz devam ediliyor', imgErr)
        supabaseCatImageUrl = null
      }
    }
    const { data, error } = await supabase
      .from('categories')
      .upsert({ local_id: String(id), name, color, icon, image_url: supabaseCatImageUrl ?? null }, { onConflict: 'local_id' })
      .select('id')
      .single()

    if (!error && data) {
      await markCategorySynced(id, data.id)
      synced.categories++
      ok(`[Sync] ✓ Kategori: "${name}" (local:${id} → remote:${data.id})`)
    } else if (error) {
      err(`[Sync] ✗ Kategori yüklenemedi: "${name}" (local:${id})`, error)
    } else {
      err(`[Sync] ✗ Kategori beklenmedik yanıt: "${name}" (local:${id}) data=null`, { message: 'data ve error ikisi de boş' })
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
  for (const [id, name, price, stock, category_id, image_url, recipe, points_value, remoteId] of prods) {
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
    if (!remoteCatId) {
      console.warn(`[Sync] ⚠ Ürün "${name}" (local:${id}) için kategori henüz yüklenmemiş — category_id null gönderiliyor (local cat:${category_id}). FK varsa Supabase reddedebilir.`)
    }
    let data, error

    if (remoteId) {
      // Product already exists in Supabase — UPDATE by remote id to avoid creating duplicates
      // when local_id doesn't match (e.g. product was created in Supabase dashboard)
      ;({ data, error } = await supabase
        .from('products')
        .update({ name, price, stock, category_id: remoteCatId ? Number(remoteCatId) : null, image_url: supabaseImageUrl, recipe, points_value: points_value ?? 0 })
        .eq('id', Number(remoteId))
        .select('id')
        .single())
    } else {
      // New product — upsert by local_id
      ;({ data, error } = await supabase
        .from('products')
        .upsert(
          { local_id: String(id), name, price, stock, category_id: remoteCatId ? Number(remoteCatId) : null, image_url: supabaseImageUrl, recipe, points_value: points_value ?? 0 },
          { onConflict: 'local_id' }
        )
        .select('id')
        .single())
    }

    if (!error && data) {
      await markProductSynced(id, data.id)
      synced.products++
      ok(`[Sync] ✓ Ürün: "${name}" ₺${price} (local:${id} → remote:${data.id})`)
    } else if (error) {
      err(`[Sync] ✗ Ürün yüklenemedi: "${name}" (local:${id}, remoteCat:${remoteCatId ?? 'null'})`, error)
    } else {
      err(`[Sync] ✗ Ürün beklenmedik yanıt: "${name}" (local:${id}) data=null`, { message: 'data ve error ikisi de boş' })
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

  // ── Modifiers ──────────────────────────────────────────────────
  // Each modifier belongs to EITHER a category OR a product (CHECK
  // constraint enforces). Skip rows whose parent isn't synced yet —
  // they'll be pushed on the next pass once the parent has a remote_id.
  const mods = getUnsyncedModifiers()
  for (const [id, local_id, category_id, product_id, name, price_delta, sort_order, is_active, _remote_id, category_remote_id, product_remote_id] of mods) {
    if (category_id != null && !category_remote_id) continue
    if (product_id  != null && !product_remote_id)  continue
    const { data, error } = await supabase
      .from('modifiers')
      .upsert(
        {
          local_id,
          category_id: category_remote_id ? Number(category_remote_id) : null,
          product_id:  product_remote_id  ? Number(product_remote_id)  : null,
          name,
          price_delta,
          sort_order,
          is_active: !!is_active,
        },
        { onConflict: 'local_id' }
      )
      .select('id')
      .single()
    if (!error && data) {
      await markModifierSynced(id, data.id)
      ok(`[Sync] ✓ Modifier: "${name}" ₺${price_delta} (local:${id} → remote:${data.id})`)
    } else if (error) {
      err(`[Sync] ✗ Modifier yüklenemedi: "${name}"`, error)
    }
  }

  // ── Product modifier excludes ─────────────────────────────────
  // Junction (product_id, modifier_id) — both must have remote_ids.
  const exRows = getUnsyncedProductModifierExcludes()
  const exPayload = []
  const exKeys = []
  for (const [product_id, modifier_id, product_remote_id, modifier_remote_id] of exRows) {
    if (!product_remote_id || !modifier_remote_id) continue
    exPayload.push({
      product_id:  Number(product_remote_id),
      modifier_id: Number(modifier_remote_id),
    })
    exKeys.push([product_id, modifier_id])
  }
  if (exPayload.length > 0) {
    const { error } = await supabase
      .from('product_modifier_excludes')
      .upsert(exPayload, { onConflict: 'product_id,modifier_id', ignoreDuplicates: true })
    if (!error) {
      for (const [pid, mid] of exKeys) await markProductModifierExcludeSynced(pid, mid)
      ok(`[Sync] ✓ Modifier-exclude: ${exPayload.length} satır`)
    } else {
      err('[Sync] ✗ Modifier-exclude yüklenemedi', error)
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
  for (const [id, local_id, order_remote_id, quantity, unit_price, product_remote_id, variant_remote_id, note, added_at] of items) {
    if (!order_remote_id) continue

    const { data, error } = await supabase
      .from('order_items')
      .upsert(
        { local_id, order_id: order_remote_id, quantity, unit_price,
          product_id: product_remote_id ? Number(product_remote_id) : null,
          variant_id: variant_remote_id ? Number(variant_remote_id) : null,
          note: note ?? null,
          added_at: added_at ?? null },
        { onConflict: 'local_id' }
      )
      .select('id')
      .single()

    if (!error && data) {
      await setOrderItemRemoteId(id, data.id)
      synced.orderItems++
      ok(`[Sync] ✓ Sipariş kalemi: ${quantity}× ₺${unit_price}${note ? ' (' + note + ')' : ''} → sipariş:${order_remote_id} (remote:${data.id})`)
    } else if (error) {
      err('[Sync] ✗ Sipariş kalemi yüklenemedi', error)
    }
  }

  // ── Order item modifiers ──────────────────────────────────────
  // Each row attaches to a specific order_items row. Skip until that
  // parent item has been pushed (and thus has a remote_id).
  const itemMods = getUnsyncedOrderItemModifiers()
  for (const [oimId, oim_local_id, order_item_remote_id, modifier_remote_id, mod_name, mod_price_delta, mod_quantity] of itemMods) {
    if (!order_item_remote_id) continue
    const { data, error } = await supabase
      .from('order_item_modifiers')
      .upsert(
        {
          local_id: oim_local_id,
          order_item_id: Number(order_item_remote_id),
          modifier_id: modifier_remote_id ? Number(modifier_remote_id) : null,
          name: mod_name,
          price_delta: mod_price_delta,
          quantity: mod_quantity,
        },
        { onConflict: 'local_id' }
      )
      .select('id')
      .single()
    if (!error && data) {
      await markOrderItemModifierSynced(oimId, data.id)
      ok(`[Sync] ✓ Sipariş-modifier: "${mod_name}" ×${mod_quantity} → kalem:${order_item_remote_id} (remote:${data.id})`)
    } else if (error) {
      err('[Sync] ✗ Sipariş-modifier yüklenemedi', error)
    }
  }

  // ── Payments ──────────────────────────────────────────────────
  const payments = getUnsyncedPayments()
  for (const [id, local_id, order_remote_id, amount, payment_method, payer_label, processed_by, device, created_at] of payments) {
    if (!order_remote_id) continue
    const { data, error } = await supabase
      .from('payments')
      .upsert(
        { local_id, order_id: Number(order_remote_id), amount, payment_method,
          payer_label: payer_label || null,
          processed_by: processed_by || null,
          device: device || 'desktop',
          created_at: created_at || new Date().toISOString() },
        { onConflict: 'local_id' }
      )
      .select('id')
      .single()
    if (!error && data) {
      await markPaymentSynced(id, data.id)
      synced.payments++
      ok(`[Sync] ✓ Ödeme: ₺${amount} ${payment_method} → sipariş:${order_remote_id} (remote:${data.id})`)
    } else if (error) {
      err('[Sync] ✗ Ödeme yüklenemedi', error)
    }
  }

  // ── Payment items (junction) ──────────────────────────────────
  // Each row already has BOTH a payment.remote_id AND an order_item.remote_id at this point
  // because payments + order_items were just pushed above.
  const paymentItems = getUnsyncedPaymentItems()
  const junctionPayload = []
  const junctionIds = []
  for (const [pid, payment_remote_id, order_item_remote_id /* , raw_payment_id, raw_order_item_id */] of paymentItems) {
    if (!payment_remote_id || !order_item_remote_id) continue
    junctionPayload.push({
      payment_id: Number(payment_remote_id),
      order_item_id: Number(order_item_remote_id),
    })
    junctionIds.push(pid)
  }
  if (junctionPayload.length > 0) {
    const { error } = await supabase
      .from('payment_items')
      .upsert(junctionPayload, { onConflict: 'order_item_id', ignoreDuplicates: true })
    if (!error) {
      for (const pid of junctionIds) await markPaymentItemSynced(pid)
      synced.paymentItems += junctionPayload.length
      ok(`[Sync] ✓ Ödeme-kalem eşleşmesi: ${junctionPayload.length} satır`)
    } else {
      err('[Sync] ✗ Ödeme-kalem eşleşmesi yüklenemedi', error)
    }
  }

  await persistDb()

  const anyWork = synced.categories + synced.products + synced.ingredients + synced.variants
                + synced.orders + synced.orderItems + synced.payments + synced.paymentItems
  if (anyWork > 0) {
    inf(`[Sync] ── Yükleme tamamlandı ── kat:${synced.categories} ürün:${synced.products} malz:${synced.ingredients} varyant:${synced.variants} sipariş:${synced.orders} kalem:${synced.orderItems} ödeme:${synced.payments} öd-kalem:${synced.paymentItems}`)
  } else {
    inf('[Sync] Yüklenecek yeni kayıt yok')
  }
  return synced
}

export async function pullFromSupabase(log = null) {
  const ok  = (msg) => { console.log(msg);        log?.('success', msg) }
  const err = (msg, e) => { console.error(msg, fmtErr(e), e); log?.('error',  `${msg} — ${fmtErr(e)}`) }

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
    .select('id, name, color, icon, image_url')

  if (catErr) {
    err('[Sync] ✗ Kategoriler çekilemedi', catErr)
  } else if (cats) {
    for (const c of cats) {
      if (pendingCatIds.has(c.id)) continue
      await upsertCategoryFromRemote({ remoteId: c.id, name: c.name, color: c.color, icon: c.icon, imageUrl: c.image_url ?? null })
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
    .select('id, name, price, stock, category_id, image_url, points_value')
    .eq('is_active', true)

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
        pointsValue: p.points_value ?? 0,
      })
    }
    await persistDb()
    ok(`[Sync] ↓ ${prods.length} ürün çekildi`)
  }

  // ── Pull modifiers ─────────────────────────────────────────────
  const { data: mods, error: modErr } = await supabase
    .from('modifiers')
    .select('id, category_id, product_id, name, price_delta, sort_order, is_active')
  if (modErr) {
    err('[Sync] ✗ Modifier\'lar çekilemedi', modErr)
  } else if (mods) {
    for (const m of mods) {
      await upsertModifierFromRemote({
        remoteId: m.id,
        remoteCategoryId: m.category_id,
        remoteProductId: m.product_id,
        name: m.name,
        priceDelta: m.price_delta,
        sortOrder: m.sort_order ?? 0,
        isActive: m.is_active !== false,
      })
    }
    await persistDb()
    ok(`[Sync] ↓ ${mods.length} modifier çekildi`)
  }

  // ── Pull product modifier excludes ─────────────────────────────
  const { data: exs, error: exErr } = await supabase
    .from('product_modifier_excludes')
    .select('product_id, modifier_id')
  if (exErr) {
    err('[Sync] ✗ Modifier-exclude çekilemedi', exErr)
  } else if (exs) {
    for (const e of exs) {
      await upsertProductModifierExcludeFromRemote({
        remoteProductId: e.product_id,
        remoteModifierId: e.modifier_id,
      })
    }
    await persistDb()
    ok(`[Sync] ↓ ${exs.length} modifier-exclude çekildi`)
  }
}
