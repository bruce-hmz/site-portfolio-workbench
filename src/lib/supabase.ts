import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
function validSupabaseUrl(value: string | undefined) {
  if (!value) return false
  try { return ['http:', 'https:'].includes(new URL(value).protocol) }
  catch { return false }
}

export const supabaseConfig = {
  url,
  publishableKey,
  isValid: Boolean(validSupabaseUrl(url) && publishableKey),
}

export const supabase = supabaseConfig.isValid
  ? createClient(supabaseConfig.url!, supabaseConfig.publishableKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
