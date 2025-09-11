#!/usr/bin/env node

/**
 * Setup Telegram webhook with secret token for production security
 * 
 * Usage:
 *   node scripts/setup-secure-webhook.js
 * 
 * Environment variables required:
 *   TELEGRAM_BOT_TOKEN - Your bot token from @BotFather
 *   TELEGRAM_WEBHOOK_SECRET - Secret token for webhook verification (generate a random string)
 *   
 * Optional:
 *   WEBHOOK_URL - Full webhook URL (defaults to constructed Railway/Vercel URL)
 */

const https = require('https')
const crypto = require('crypto')

// Configuration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex')
const WEBHOOK_URL = process.env.WEBHOOK_URL || 
  process.env.TELEGRAM_WEBHOOK_URL || 
  (process.env.VERCEL_URL ? `${process.env.VERCEL_URL}/api/telegram/webhook` : null) ||
  (process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}/api/telegram/webhook` : null) ||
  'https://your-domain.vercel.app/api/telegram/webhook' // Replace with your domain

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN environment variable is required')
  process.exit(1)
}

if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
  console.log('🔐 Generated webhook secret:', WEBHOOK_SECRET)
  console.log('⚠️  Add this to your environment variables as TELEGRAM_WEBHOOK_SECRET')
}

async function setupWebhook() {
  const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`
  
  const payload = JSON.stringify({
    url: WEBHOOK_URL,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'], // Only handle what we need
    drop_pending_updates: true // Clear any pending updates
  })

  console.log('🚀 Setting up Telegram webhook...')
  console.log('📍 Webhook URL:', WEBHOOK_URL)
  console.log('🔐 Using secret token for security')

  return new Promise((resolve, reject) => {
    const req = https.request(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = ''
      
      res.on('data', (chunk) => {
        data += chunk
      })
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data)
          
          if (response.ok) {
            console.log('✅ Webhook set up successfully!')
            console.log('📝 Response:', response.description)
            resolve(response)
          } else {
            console.error('❌ Failed to set webhook:', response.description)
            reject(new Error(response.description))
          }
        } catch (error) {
          console.error('❌ Failed to parse response:', error.message)
          reject(error)
        }
      })
    })

    req.on('error', (error) => {
      console.error('❌ Network error:', error.message)
      reject(error)
    })

    req.write(payload)
    req.end()
  })
}

async function getWebhookInfo() {
  const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`
  
  return new Promise((resolve, reject) => {
    https.get(telegramApiUrl, (res) => {
      let data = ''
      
      res.on('data', (chunk) => {
        data += chunk
      })
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data)
          resolve(response.result)
        } catch (error) {
          reject(error)
        }
      })
    }).on('error', reject)
  })
}

async function main() {
  try {
    // Setup the webhook
    await setupWebhook()
    
    // Verify the webhook is set correctly
    console.log('\n📊 Verifying webhook info...')
    const webhookInfo = await getWebhookInfo()
    
    console.log('✅ Current webhook configuration:')
    console.log('  URL:', webhookInfo.url || 'None')
    console.log('  Has custom certificate:', webhookInfo.has_custom_certificate)
    console.log('  Pending updates:', webhookInfo.pending_update_count)
    console.log('  Max connections:', webhookInfo.max_connections)
    console.log('  Allowed updates:', webhookInfo.allowed_updates?.join(', ') || 'All')
    
    if (webhookInfo.last_error_date) {
      console.log('⚠️  Last error:', new Date(webhookInfo.last_error_date * 1000).toISOString())
      console.log('   Error message:', webhookInfo.last_error_message)
    }

    console.log('\n🎉 Webhook setup complete!')
    console.log('💡 Your bot is now ready to receive updates securely')
    
    if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
      console.log('\n⚠️  IMPORTANT: Set the following environment variable:')
      console.log(`TELEGRAM_WEBHOOK_SECRET="${WEBHOOK_SECRET}"`)
    }
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message)
    process.exit(1)
  }
}

main()