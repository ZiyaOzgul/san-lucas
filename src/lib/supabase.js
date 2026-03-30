import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// supabase is null when env vars are not configured (offline / dev without credentials)
export const supabase = url && key ? createClient(url, key) : null
export const isSupabaseReady = !!supabase

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

