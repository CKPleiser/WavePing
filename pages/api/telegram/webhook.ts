import type { VercelRequest, VercelResponse } from '@vercel/node'
import { WavePingBot } from '../../../lib/telegram/bot'

const botToken = process.env.TELEGRAM_BOT_TOKEN || ''
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '' // set this when you call setWebhook

// Single bot instance across invocations (avoids reinitialization on warm invocations)
const bot = new WavePingBot(botToken)

// Simple in-memory dedupe for retries (good enough on a single serverless instance)
const seen = new Set<number>()
const SEEN_TTL_MS = 5 * 60 * 1000 // 5 minutes

// Clear seen set periodically to prevent memory leaks
setInterval(() => {
  seen.clear()
  console.log('Cleared webhook deduplication cache')
}, SEEN_TTL_MS).unref()

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle different HTTP methods
  if (req.method !== 'POST') {
    if (req.method === 'GET') {
      // Healthcheck endpoint
      return res.status(200).send('WavePing Telegram webhook is running')
    }
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // 1) Verify Telegram secret header (set when you registered the webhook)
    // Telegram sends it as: X-Telegram-Bot-Api-Secret-Token
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'] as string || ''
    
    if (!webhookSecret || secretHeader !== webhookSecret) {
      console.warn('Webhook secret verification failed', {
        hasSecret: !!webhookSecret,
        hasHeader: !!secretHeader,
        timestamp: new Date().toISOString()
      })
      // Don't leak info about what went wrong
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // 2) Validate request body shape quickly
    const update: any = req.body
    if (!update || typeof update.update_id !== 'number') {
      console.warn('Invalid webhook payload', {
        hasBody: !!update,
        hasUpdateId: update && typeof update.update_id === 'number',
        timestamp: new Date().toISOString()
      })
      return res.status(400).json({ error: 'Bad request' })
    }

    // 3) Idempotency: drop duplicate update_id to handle Telegram retries
    if (seen.has(update.update_id)) {
      console.log(`Deduped webhook update ${update.update_id}`)
      return res.status(200).json({ ok: true, deduped: true })
    }
    seen.add(update.update_id)

    // 4) ACK FAST — return 200 immediately to prevent Telegram retries
    res.status(200).json({ ok: true })

    // 5) Process in the background (errors are logged, not thrown to prevent 500s)
    // This happens after the response is sent, so Telegram won't retry on slow processing
    setImmediate(async () => {
      try {
        console.log(`Processing webhook update ${update.update_id}`, {
          type: update.message ? 'message' : update.callback_query ? 'callback_query' : 'other',
          user_id: update.message?.from?.id || update.callback_query?.from?.id,
          timestamp: new Date().toISOString()
        })
        
        await bot.getBot().handleUpdate(update)
        
        console.log(`Successfully processed update ${update.update_id}`)
      } catch (error) {
        // Swallow errors - Telegram already got 200 OK
        // Log structured error data for monitoring
        console.error('Webhook processing error:', {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          update_id: update.update_id,
          update_type: update.message ? 'message' : update.callback_query ? 'callback_query' : 'other',
          user_id: update.message?.from?.id || update.callback_query?.from?.id,
          timestamp: new Date().toISOString()
        })
      }
    })

  } catch (error) {
    // This catches errors in the synchronous part (validation, etc.)
    // We still return 200 to prevent Telegram retries, but log the issue
    console.error('Webhook handler error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      method: req.method,
      timestamp: new Date().toISOString()
    })
    
    // Return 200 anyway to prevent Telegram retries on our bugs
    return res.status(200).json({ ok: false, error: 'Processing failed' })
  }
}

// Configure body parser limits for webhook payload
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb', // Increase if you expect large updates (usually not needed)
    },
  },
}