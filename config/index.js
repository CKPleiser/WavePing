/**
 * Centralized configuration management
 */
require('dotenv').config({ path: '.env.local' })

const config = {
  // Server configuration
  server: {
    port: process.env.PORT || 3000,
    environment: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'INFO'
  },

  // Telegram configuration
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
    maxMessageLength: 4096,
    rateLimitMs: 3000
  },

  // Supabase configuration
  database: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_KEY
  },

  // Security configuration
  security: {
    cronSecret: process.env.CRON_SECRET,
    sessionTTL: 15 * 60 * 1000, // 15 minutes
    maxRetries: 3
  },

  // Wave-specific configuration
  wave: {
    bookingBaseUrl: 'https://thewave.com/bristol/book/',
    scraperTimeout: 30000, // 30 seconds
    maxSessionsPerMessage: 10
  },

  // Notification configuration
  notifications: {
    morningDigestHour: 8,
    eveningDigestHour: 18,
    timings: ['24h', '12h', '6h', '3h', '1h'],
    defaultMinSpots: 1
  },

  // Feature flags
  features: {
    enableDigests: true,
    enableSessionNotifications: true,
    enableTesting: process.env.NODE_ENV === 'development',
    enableDebugLogging: process.env.DEBUG === 'true'
  }
}

// Validate required configuration
function validateConfig() {
  const required = [
    'telegram.botToken',
    'database.url',
    'database.serviceKey',
    'security.cronSecret'
  ]

  const missing = []
  for (const path of required) {
    const keys = path.split('.')
    let value = config
    for (const key of keys) {
      value = value[key]
    }
    if (!value) {
      missing.push(path)
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`)
  }
}

// Validate on startup
validateConfig()

module.exports = config