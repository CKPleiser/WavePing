import type { VercelRequest, VercelResponse } from '@vercel/node'
import { WavePingBot } from '../../lib/telegram/bot'

const bot = new WavePingBot(process.env.TELEGRAM_BOT_TOKEN || '')

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Process the update with Telegraf
    await bot.getBot().handleUpdate(req.body)
    res.status(200).json({ ok: true })
  } catch (error) {
    console.error('Telegram webhook error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}