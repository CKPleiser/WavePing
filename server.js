require('dotenv').config({ path: '.env.local' })

const express = require('express')
const { Telegraf, session } = require('telegraf')
const { createClient } = require('@supabase/supabase-js')
const { today } = require('./utils/time')
const { WaveScheduleScraper } = require('./lib/wave-scraper-final.js')
const DigestService = require('./services/digestService')
const BotHandler = require('./bot/index')
const logger = require('./utils/logger')
const { authenticateCron } = require('./middleware/auth')
const { errorHandler, asyncHandler } = require('./middleware/errorHandler')

// Initialize Express app
const app = express()
app.use(express.json())

// Initialize Telegram bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN)
bot.use(session())

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Initialize services
const digestService = new DigestService(supabase, bot)
const botHandler = new BotHandler(bot, supabase)
const serverLogger = logger.child('Server')

// Debug bot responses - intercept reply method to log keyboards
const originalReply = bot.telegram.sendMessage
bot.telegram.sendMessage = function(chatId, text, extra) {
  if (extra?.reply_markup) {
    serverLogger.info('🎹 Keyboard being sent:', {
      chatId,
      text: text.substring(0, 50) + '...',
      keyboard: JSON.stringify(extra.reply_markup, null, 2)
    })
  }
  return originalReply.call(this, chatId, text, extra)
}

// Homepage
app.get('/', (req, res) => {
  res.json({ 
    name: 'WavePing Bot',
    status: 'running',
    description: 'Smart Telegram bot for The Wave Bristol surf session alerts',
    bot: '@WavePingBot',
    version: '2.0.0' // Updated version with new bot system
  })
})

// Health check endpoint  
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

// Test notification endpoint for development
app.post('/api/test/notification', 
  authenticateCron,
  asyncHandler(async (req, res) => {
    const { telegramId, message } = req.body
    
    if (!telegramId || !message) {
      return res.status(400).json({ error: 'telegramId and message required' })
    }

    // Send test notification
    await bot.telegram.sendMessage(telegramId, message, { parse_mode: 'Markdown' })
    
    serverLogger.info(`Test notification sent to ${telegramId}`, { message })
    res.json({ success: true, message: 'Test notification sent' })
  })
)

// Test the full notification system with sample data
app.post('/api/test/notification-system', 
  authenticateCron,
  asyncHandler(async (req, res) => {
    serverLogger.info('Testing notification system...')
    
    // Get all users with notifications enabled
    const { data: users, error: usersError } = await supabase
      .from('profiles')
      .select(`
        id, 
        telegram_id,
        user_levels (level),
        user_sides (side),
        user_time_windows (start_time, end_time),
        user_notifications (timing)
      `)
      .eq('notification_enabled', true)
    
    if (usersError) {
      throw usersError
    }

    serverLogger.info(`Found ${users.length} users with notifications enabled`)
    
    // Get some sample sessions to test with
    const { data: sessions, error: sessionsError } = await supabase
      .from('sessions')
      .select('*')
      .gte('date', new Date().toISOString().split('T')[0])
      .limit(5)
    
    if (sessionsError) {
      throw sessionsError
    }

    serverLogger.info(`Found ${sessions.length} upcoming sessions`)
    
    // Send test notifications to each user
    const results = []
    for (const user of users) {
      const testMessage = `🧪 *Notification Test* 🧪

🌊 This is a test to make sure your WavePing notifications are working!

*Your notification settings:*
${user.user_notifications.map(n => `• ${n.timing} before sessions`).join('\\n')}

*Your level preferences:*
${user.user_levels.map(l => `• ${l.level}`).join('\\n')}

If you're seeing this, notifications are working perfectly! 🎉

Use /prefs to manage your notification settings.`

      try {
        await bot.telegram.sendMessage(user.telegram_id, testMessage, { parse_mode: 'Markdown' })
        results.push({ telegramId: user.telegram_id, status: 'sent' })
        serverLogger.debug(`Test notification sent to ${user.telegram_id}`)
      } catch (error) {
        results.push({ telegramId: user.telegram_id, status: 'failed', error: error.message })
        serverLogger.error(`Failed to send to ${user.telegram_id}`, { error: error.message })
      }
    }
    
    res.json({ 
      success: true, 
      usersFound: users.length,
      sessionsFound: sessions.length,
      results: results
    })
  })
)

// Morning digest cron endpoint (8 AM) - Refactored to use service
app.post('/api/cron/send-morning-digest', 
  authenticateCron,
  asyncHandler(async (req, res) => {
    const result = await digestService.sendMorningDigest()
    res.json(result)
  })
)

// Evening digest cron endpoint (6 PM) - Refactored to use service
app.post('/api/cron/send-evening-digest', 
  authenticateCron,
  asyncHandler(async (req, res) => {
    const result = await digestService.sendEveningDigest()
    res.json(result)
  })
)

// Session notification endpoint - for immediate notifications
app.post('/api/cron/send-session-notifications', 
  authenticateCron,
  asyncHandler(async (req, res) => {
    serverLogger.info('Checking for session notifications...')
    
    // Get all users with notifications enabled
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select(`
        id, 
        telegram_id,
        min_spots,
        user_levels (level),
        user_sides (side),
        user_days (day_of_week),
        user_time_windows (start_time, end_time),
        user_notifications (timing)
      `)
      .eq('notification_enabled', true)
    
    if (profilesError) throw profilesError

    serverLogger.info(`Found ${profiles.length} users with notifications enabled`)

    // Get upcoming sessions
    const scraper = new WaveScheduleScraper()
    const upcomingSessions = await scraper.getSessionsInRange(2).catch(() => [])
    
    const results = []
    let notificationsSent = 0

    for (const user of profiles) {
      try {
        // Get user preferences
        const userLevels = user.user_levels?.map(ul => ul.level) || []
        const userSides = user.user_sides?.map(us => us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any') || []
        const userDays = user.user_days?.map(ud => ud.day_of_week) || []
        const userTimeWindows = user.user_time_windows || []
        const userNotificationTimings = user.user_notifications?.map(n => n.timing) || []

        // Filter sessions for user
        const matchingSessions = scraper.filterSessionsForUser(
          upcomingSessions, 
          userLevels, 
          userSides, 
          userDays, 
          true, 
          userTimeWindows
        ).filter(s => {
          const availableSpots = s.spots_available || 0
          return availableSpots > 0 && availableSpots >= user.min_spots
        })

        // Check each session for notification timing
        for (const session of matchingSessions) {
          const sessionTime = new Date(`${session.dateISO}T${session.time}:00`)
          const now = new Date()
          const hoursUntilSession = (sessionTime - now) / (1000 * 60 * 60)

          // Check if we should send a notification based on user's timing preferences
          let shouldNotify = false
          let notificationTiming = ''

          if (userNotificationTimings.includes('24h') && hoursUntilSession <= 24 && hoursUntilSession > 23) {
            shouldNotify = true
            notificationTiming = '24 hours'
          } else if (userNotificationTimings.includes('12h') && hoursUntilSession <= 12 && hoursUntilSession > 11) {
            shouldNotify = true
            notificationTiming = '12 hours'
          } else if (userNotificationTimings.includes('6h') && hoursUntilSession <= 6 && hoursUntilSession > 5) {
            shouldNotify = true
            notificationTiming = '6 hours'
          } else if (userNotificationTimings.includes('3h') && hoursUntilSession <= 3 && hoursUntilSession > 2) {
            shouldNotify = true
            notificationTiming = '3 hours'
          } else if (userNotificationTimings.includes('1h') && hoursUntilSession <= 1 && hoursUntilSession > 0) {
            shouldNotify = true
            notificationTiming = '1 hour'
          }

          if (shouldNotify) {
            // Check if we've already sent this notification
            const { data: existingNotification } = await supabase
              .from('notifications_sent')
              .select('id')
              .eq('user_id', user.id)
              .eq('session_id', session.session_id)
              .eq('notification_type', notificationTiming.replace(' ', '').toLowerCase())
              .single()

            if (!existingNotification) {
              // Send notification
              const spots = session.spots_available || 0
              const bookingUrl = session.booking_url || 'https://thewave.com/bristol/book/'
              
              const message = `🌊 *Session Alert!* 🏄‍♂️\\n\\n` +
                `⏰ *${notificationTiming} reminder*\\n\\n` +
                `📅 *${session.dateLabel || 'Today'}*\\n` +
                `🕐 *${session.time}* - ${session.session_name}\\n` +
                `📍 ${spots} spot${spots === 1 ? '' : 's'} available\\n\\n` +
                `[Book Now](${bookingUrl})\\n\\n` +
                `_Use /prefs to manage your notifications_`

              await bot.telegram.sendMessage(user.telegram_id, message, { parse_mode: 'Markdown' })

              // Record notification sent
              await supabase
                .from('notifications_sent')
                .insert({
                  user_id: user.id,
                  session_id: session.session_id,
                  notification_type: notificationTiming.replace(' ', '').toLowerCase(),
                  sent_at: new Date().toISOString()
                })

              notificationsSent++
              serverLogger.debug(`Notification sent to ${user.telegram_id} for session ${session.session_id}`)
            }
          }
        }

        results.push({ telegramId: user.telegram_id, status: 'processed' })
        
      } catch (error) {
        serverLogger.error(`Failed to process notifications for ${user.telegram_id}`, { error: error.message })
        results.push({ telegramId: user.telegram_id, status: 'failed', error: error.message })
      }
    }
    
    serverLogger.info(`Session notifications complete: ${notificationsSent} sent`)
    res.json({ success: true, notificationsSent, results })
  })
)

// Telegram webhook endpoint
app.post(`/api/telegram/webhook`, asyncHandler(async (req, res) => {
  try {
    // Debug webhook requests
    serverLogger.info('🔍 Webhook received:', { 
      update_id: req.body.update_id,
      message: req.body.message ? {
        text: req.body.message.text,
        from: req.body.message.from?.first_name
      } : null,
      callback_query: req.body.callback_query ? {
        data: req.body.callback_query.data,
        from: req.body.callback_query.from?.first_name
      } : null
    })
    
    await bot.handleUpdate(req.body)
    res.status(200).send('OK')
  } catch (error) {
    serverLogger.error('Webhook error:', { 
      error: error.message,
      stack: error.stack,
      update: req.body
    })
    res.status(200).send('OK') // Still return OK to prevent Telegram retries
  }
}))

// Global error handler (must be last)
app.use(errorHandler)

// Start server
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  serverLogger.info(`Server running on port ${PORT}`)
})

// Start bot in polling mode for development (comment out for production webhook)
if (process.env.NODE_ENV !== 'production') {
  bot.launch({ polling: { timeout: 30 } })
  serverLogger.info('Bot started in polling mode for development')
  
  // Graceful shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))
} else {
  serverLogger.info('Bot configured for webhook mode (production)')
}

// Export for testing
module.exports = { app, bot }