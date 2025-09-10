import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client
const supabase = createClient(
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_KEY
)

// Import bot logic (we'll need to adapt from the current bot.ts)
class WavePingWorker {
  constructor() {
    this.botToken = TELEGRAM_BOT_TOKEN
    this.webhookUrl = `https://api.telegram.org/bot${this.botToken}`
  }

  async handleWebhook(request) {
    try {
      const update = await request.json()
      console.log('Received update:', update)

      if (update.message) {
        await this.handleMessage(update.message)
      } else if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query)
      }

      return new Response('OK', { status: 200 })
    } catch (error) {
      console.error('Webhook error:', error)
      return new Response('Error', { status: 500 })
    }
  }

  async handleMessage(message) {
    const chatId = message.chat.id
    const text = message.text

    if (text?.startsWith('/')) {
      const command = text.split(' ')[0].slice(1)
      
      switch (command) {
        case 'start':
          await this.sendMessage(chatId, '🌊 Welcome to WavePing! Use /setup to get started.')
          break
        case 'prefs':
          await this.showPreferences(chatId, message.from.id)
          break
        case 'today':
          await this.showTodaySessions(chatId, message.from.id)
          break
        case 'setup':
          await this.startSetup(chatId, message.from.id)
          break
        default:
          await this.sendMessage(chatId, 'Unknown command. Try /start, /setup, /prefs, or /today')
      }
    }
  }

  async handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id
    const userId = callbackQuery.from.id
    const data = callbackQuery.data

    console.log('Callback data:', data)

    if (data.startsWith('edit_')) {
      const editType = data.split('_')[1]
      await this.handleEditPreferences(chatId, userId, editType, callbackQuery.id)
    } else if (data.startsWith('level_')) {
      await this.handleLevelSelection(chatId, userId, data, callbackQuery.id)
    } else if (data.startsWith('save_')) {
      await this.handleSavePreferences(chatId, userId, data, callbackQuery.id)
    }

    // Always answer callback query
    await this.answerCallbackQuery(callbackQuery.id)
  }

  async showPreferences(chatId, userId) {
    try {
      const preferences = await this.getUserPreferences(userId)
      
      if (!preferences) {
        return await this.sendMessage(chatId, "You haven't set up preferences yet. Use /setup to get started.")
      }

      const message = this.formatPreferencesMessage(preferences)
      
      await this.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚙️ Edit Levels', callback_data: 'edit_levels' }],
            [{ text: '🏄 Edit Sides', callback_data: 'edit_sides' }],
            [{ text: '📅 Edit Days', callback_data: 'edit_days' }],
            [{ text: '🕐 Edit Times', callback_data: 'edit_times' }],
            [{ text: '🔔 Edit Notifications', callback_data: 'edit_notifications' }]
          ]
        }
      })
    } catch (error) {
      console.error('Error showing preferences:', error)
      await this.sendMessage(chatId, 'Error loading preferences. Try again later.')
    }
  }

  async getUserPreferences(telegramId) {
    const { data, error } = await supabase
      .from('profiles')
      .select(`
        *,
        user_levels (level),
        user_sides (side), 
        user_days (day_of_week),
        user_time_windows (start_time, end_time),
        user_notifications (timing)
      `)
      .eq('telegram_id', telegramId)
      .single()
    
    if (error) {
      console.error('Error fetching user preferences:', error)
      return null
    }
    
    return data
  }

  formatPreferencesMessage(preferences) {
    const levels = preferences.user_levels?.map(ul => ul.level).join(', ') || 'None set'
    const sides = preferences.user_sides?.map(us => us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any').join(', ') || 'Any'
    const days = preferences.user_days?.map(ud => {
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      return dayNames[ud.day_of_week]
    }).join(', ') || 'Any day'
    const times = preferences.user_time_windows?.map(utw => `${utw.start_time}-${utw.end_time}`).join(', ') || 'Any time'
    const notifications = preferences.user_notifications?.map(un => un.timing).join(', ') || '24h'

    return `⚙️ *Your Current Preferences*

📊 *Levels*: ${levels}
🏄 *Sides*: ${sides}
📅 *Days*: ${days}
🕐 *Times*: ${times}
👥 *Min spots*: ${preferences.min_spots || 1}
🔔 *Notifications*: ${notifications}`
  }

  async handleEditPreferences(chatId, userId, editType, callbackQueryId) {
    // This would implement the edit UI for each preference type
    console.log(`Editing ${editType} for user ${userId}`)
    await this.answerCallbackQuery(callbackQueryId, `Editing ${editType}...`)
  }

  async sendMessage(chatId, text, options = {}) {
    const url = `${this.webhookUrl}/sendMessage`
    const payload = {
      chat_id: chatId,
      text: text,
      ...options
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      console.error('Failed to send message:', await response.text())
    }

    return response.json()
  }

  async answerCallbackQuery(callbackQueryId, text = '') {
    const url = `${this.webhookUrl}/answerCallbackQuery`
    const payload = {
      callback_query_id: callbackQueryId,
      text: text
    }

    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  }

  // Cron job handler for scraping sessions
  async handleCron() {
    console.log('Running cron job - scraping sessions...')
    // Implement session scraping logic here
    // This would call The Wave API and update the sessions table
  }
}

export default {
  async fetch(request, env, ctx) {
    // Set environment variables
    global.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN
    global.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
    global.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY  
    global.SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY

    const worker = new WavePingWorker()
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/webhook') {
      return await worker.handleWebhook(request)
    }

    return new Response('WavePing Bot Worker', { status: 200 })
  },

  async scheduled(controller, env, ctx) {
    // Set environment variables
    global.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN
    global.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
    global.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    global.SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY

    const worker = new WavePingWorker()
    await worker.handleCron()
  }
}