import { createClient } from '@supabase/supabase-js'

const url        = import.meta.env.VITE_SUPABASE_URL
const key        = import.meta.env.VITE_SUPABASE_ANON_KEY
const serviceKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY

// Single-window Electron desktop app — navigator.locks cross-tab coordination is unnecessary
// and has been observed to deadlock (getSession hangs → all subsequent auth and PostgREST
// calls block because they wait for the JWT). Pass-through lock disables cross-tab queueing.
const noLock = (_name, _acquireTimeout, fn) => fn()

// supabase is null when env vars are not configured (offline / dev without credentials)
export const supabase = url && key
  ? createClient(url, key, { auth: { lock: noLock } })
  : null
export const isSupabaseReady = !!supabase

if (import.meta.env.DEV) {
  console.log('[Supabase] config', {
    urlHost: url ? new URL(url).host : '(missing)',
    anonKeyPrefix: key ? key.slice(0, 12) + '…' : '(missing)',
    serviceKeyPresent: !!serviceKey,
    isReady: !!(url && key),
  })
}

// Admin client — uses service role key, bypasses RLS, can create/delete auth users.
// storageKey isolates this client's GoTrue instance from the user-facing `supabase` client
// to prevent session corruption from concurrent access to the same storage slot.
export const supabaseAdmin = url && serviceKey
  ? createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        storageKey: 'sb-admin-isolated',
        lock: noLock,
      },
    })
  : null

export async function createStaffUser(email, password, fullName, permissions) {
  if (!supabaseAdmin) throw new Error('Supabase admin client yapılandırılmamış. .env dosyasını kontrol edin.')
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw error
  const uid = data.user.id
  const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
    id:                  uid,
    full_name:           fullName,
    role:                'waiter',
    can_take_orders:     permissions.canTakeOrders     ?? true,
    can_close_tables:    permissions.canCloseTables     ?? false,
    can_manage_products: permissions.canManageProducts  ?? false,
  })
  if (profileError) throw profileError
  return uid
}

export async function updateStaffPermissions(supabaseUid, permissions) {
  if (!supabaseAdmin) return
  await supabaseAdmin.from('profiles').update({
    can_take_orders:     permissions.canTakeOrders,
    can_close_tables:    permissions.canCloseTables,
    can_manage_products: permissions.canManageProducts,
  }).eq('id', supabaseUid)
}

export async function deleteStaffUser(supabaseUid) {
  if (!supabaseAdmin) return
  await supabaseAdmin.auth.admin.deleteUser(supabaseUid)
  // profile auto-deletes via ON DELETE CASCADE
}

/**
 * Upload product image bytes to Supabase Storage bucket "products".
 * Returns the public URL of the uploaded file.
 * @param {ArrayBuffer} bytes - Raw image bytes
 * @param {string} filename   - Filename e.g. "1774611379896.png"
 * @returns {Promise<string>} Public URL
 */
export async function deleteProductImage(filename) {
  if (!supabase) return
  const { error } = await supabase.storage.from('product-images').remove([filename])
  if (error) console.error('[Supabase] ✗ Failed to delete image', error)
}

export async function uploadProductImage(bytes, filename) {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase.storage
    .from('product-images')
    .upload(filename, new Blob([bytes]), { upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('product-images').getPublicUrl(filename)
  return data.publicUrl
}

export async function uploadCategoryImage(bytes, filename) {
  const client = supabaseAdmin || supabase
  if (!client) throw new Error('Supabase not configured')
  const { error } = await client.storage
    .from('category-images')
    .upload(filename, new Blob([bytes]), { upsert: true })
  if (error) throw error
  const { data } = client.storage.from('category-images').getPublicUrl(filename)
  return data.publicUrl
}

export async function resetSupabaseData() {
  if (!supabase) throw new Error('Supabase not configured')
  // Delete in FK-safe order (children before parents). payment_items and
  // order_item_modifiers reference order_items — skipping them makes every
  // parent delete fail on FK and the reset silently half-completes.
  await supabase.from('payment_items').delete().gte('id', 0)
  await supabase.from('payments').delete().gte('id', 0)
  await supabase.from('order_item_modifiers').delete().gte('id', 0)
  await supabase.from('order_items').delete().gte('id', 0)
  await supabase.from('orders').delete().gte('id', 0)
  await supabase.from('product_modifier_excludes').delete().gte('product_id', 0)
  await supabase.from('modifiers').delete().gte('id', 0)
  await supabase.from('product_variants').delete().gte('id', 0)
  await supabase.from('product_ingredients').delete().gte('id', 0)
  await supabase.from('products').delete().gte('id', 0)
  await supabase.from('categories').delete().gte('id', 0)
  await supabase.from('ingredients').delete().gte('id', 0)
}

