import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 2, // Throttle realtime events
    },
  },
})

// Admin client for server-side operations
export const createAdminClient = () => {
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!
  return createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}

// Helper to create client with telegram context
export const createTelegramClient = (telegramId: number) => {
  const adminClient = createAdminClient()
  
  // Set telegram context for RLS
  return (adminClient as any).rpc('set_config', {
    setting_name: 'app.telegram_id',
    setting_value: telegramId.toString(),
    is_local: true
  }).then(() => adminClient)
}