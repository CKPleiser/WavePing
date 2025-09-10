import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../lib/supabase/client'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Test Supabase connection
    const supabase = createAdminClient()
    const { error: dbError } = await supabase.from('profiles').select('id').limit(1)
    
    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`)
    }

    // Check environment variables
    const requiredEnvVars = [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_KEY',
      'TELEGRAM_BOT_TOKEN',
      'CRON_SECRET'
    ]

    const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar])

    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.VERCEL_ENV || 'development',
      database: 'connected',
      missing_env_vars: missingEnvVars,
      services: {
        supabase: '✅',
        telegram: process.env.TELEGRAM_BOT_TOKEN ? '✅' : '❌',
        weather_api: process.env.OPENWEATHERMAP_API_KEY ? '✅' : '⚠️'
      }
    })

  } catch (error) {
    console.error('Health check failed:', error)
    
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}