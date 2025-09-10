const express = require('express')
const { Telegraf, session, Markup } = require('telegraf')
const { createClient } = require('@supabase/supabase-js')

const app = express()
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN)

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Add session middleware
bot.use(session())

// Homepage
app.get('/', (req, res) => {
  res.json({ 
    name: 'WavePing Bot',
    status: 'running',
    description: 'Smart Telegram bot for The Wave Bristol surf session alerts',
    bot: '@WavePingBot'
  })
})

// Health check endpoint  
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() })
})

// Basic bot commands
bot.start((ctx) => {
  ctx.reply('🌊 Welcome to WavePing! Use /setup to get started.')
})

bot.command('prefs', async (ctx) => {
  try {
    const preferences = await getUserPreferences(ctx.from.id)
    
    if (!preferences) {
      return ctx.reply("You haven't set up preferences yet. Use /setup to get started.")
    }

    const message = formatPreferencesMessage(preferences)
    
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('⚙️ Edit Levels', 'edit_levels')],
        [Markup.button.callback('🏄 Edit Sides', 'edit_sides')],
        [Markup.button.callback('📅 Edit Days', 'edit_days')],
        [Markup.button.callback('🕐 Edit Times', 'edit_times')],
        [Markup.button.callback('🔔 Edit Notifications', 'edit_notifications')]
      ]).reply_markup
    })
  } catch (error) {
    console.error('Error showing preferences:', error)
    ctx.reply('Error loading preferences. Try again later.')
  }
})

bot.command('today', async (ctx) => {
  ctx.reply('🔍 Getting today\'s sessions...')
  // Implementation for today's sessions
})

bot.command('setup', async (ctx) => {
  ctx.reply('🚀 Let\'s set up your preferences! Use /prefs after setup.')
  // Implementation for setup flow
})

// Callback handlers
bot.action('edit_levels', async (ctx) => {
  await ctx.answerCbQuery('Loading levels...')
  await ctx.editMessageText('⚙️ *Edit Session Levels*\n\nSelect your session levels:', {
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('🟢 Beginner', 'level_beginner')],
      [Markup.button.callback('🔵 Improver', 'level_improver')],
      [Markup.button.callback('🟡 Intermediate', 'level_intermediate')],
      [Markup.button.callback('🟠 Advanced', 'level_advanced')],
      [Markup.button.callback('🔴 Expert', 'level_expert')],
      [Markup.button.callback('💾 Save', 'save_levels')]
    ]).reply_markup
  })
})

// Helper functions
async function getUserPreferences(telegramId) {
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

function formatPreferencesMessage(preferences) {
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

// Start server and bot
const PORT = process.env.PORT || 3000

if (process.env.NODE_ENV === 'production') {
  // Production: use webhook
  app.use(express.json())
  app.post('/webhook', (req, res) => {
    bot.handleUpdate(req.body, res)
  })
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`)
    
    // Set webhook
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL || `https://waveping-production.up.railway.app/webhook`
    bot.telegram.setWebhook(webhookUrl).then(() => {
      console.log(`📱 Webhook set to: ${webhookUrl}`)
    }).catch(console.error)
  })
} else {
  // Development: use polling
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`)
    bot.launch()
    console.log('🤖 Bot started with polling')
  })
}

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))