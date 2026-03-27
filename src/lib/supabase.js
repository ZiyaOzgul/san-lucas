import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// supabase is null when env vars are not configured (offline / dev without credentials)
export const supabase = url && key ? createClient(url, key) : null
export const isSupabaseReady = !!supabase
