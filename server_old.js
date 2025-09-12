require('dotenv').config({ path: '.env.local' })

const express = require('express')
const { Telegraf, session } = require('telegraf')
const { createClient } = require('@supabase/supabase-js')
const { today, tomorrow } = require('./utils/time')
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



// /today command - Show today's sessions
bot.command('today', async (ctx) => {
  serverLogger.info(`/today command triggered by user ${ctx.from.id}`)
  try {
    const telegramId = ctx.from.id
    
    // Rate limiting
    if (!checkRateLimit(`today:${telegramId}`)) {
      serverLogger.info(`Rate limited user ${telegramId}`)
      return ctx.reply('⏱ Please wait a moment before requesting again...')
    }
    
    serverLogger.info(`Rate limit passed for user ${telegramId}`)
    
    // Send loading message
    const loadingMsg = await ctx.reply('🌊 Loading today\'s Wave sessions...')
    
    // Get user preferences
    serverLogger.info(`Getting user profile for ${telegramId}`)
    const userProfile = await getUserProfile(telegramId)
    if (!userProfile) {
      serverLogger.info(`No user profile found for ${telegramId}`)
      return ctx.telegram.editMessageText(
        ctx.chat.id, 
        loadingMsg.message_id, 
        undefined,
        '⚠️ Please run /setup first to set your preferences!'
      )
    }
    serverLogger.info(`User profile found for ${telegramId}`)
    
    // Get user's preferences
    const { data: userLevels } = await supabase
      .from('user_levels')
      .select('level')
      .eq('user_id', userProfile.id)
    
    const { data: userSides } = await supabase
      .from('user_sides')
      .select('side')
      .eq('user_id', userProfile.id)
    
    const { data: userDays } = await supabase
      .from('user_days')
      .select('day_of_week')
      .eq('user_id', userProfile.id)
    
    const { data: userTimeWindows } = await supabase
      .from('user_time_windows')
      .select('start_time, end_time')
      .eq('user_id', userProfile.id)

    // Get today's date
    const todayDate = today()
    serverLogger.info(`Looking for sessions on ${todayDate}`)

    // Try database first, then scraper as fallback
    let sessions = []
    
    // Get sessions from database
    const { data: dbSessions, error: dbError } = await supabase
      .from('sessions')
      .select('*')
      .eq('date', todayDate)
      .gt('spots_available', 0)
      .order('time', { ascending: true })

    if (dbError) {
      serverLogger.error('Database error fetching sessions:', { error: dbError.message })
    } else if (dbSessions && dbSessions.length > 0) {
      sessions = dbSessions
      serverLogger.info(`Found ${sessions.length} sessions in database for ${todayDate}`)
    } else {
      // Fallback to scraper
      serverLogger.info('No sessions in database, falling back to scraper')
      const scraper = new WaveScheduleScraper()
      try {
        sessions = await scraper.getTodaysSessions()
        serverLogger.info(`Scraper found ${sessions.length} sessions`)
      } catch (scraperError) {
        serverLogger.error('Scraper error:', { error: scraperError.message })
        return ctx.telegram.editMessageText(
          ctx.chat.id,
          loadingMsg.message_id,
          undefined,
          '❌ Unable to load sessions right now. Please try again later.'
        )
      }
    }

    if (sessions.length === 0) {
      return ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        '🏄‍♂️ No sessions available today. Check back tomorrow!'
      )
    }

    // Filter sessions based on user preferences
    const scraper = new WaveScheduleScraper()
    const userLevelList = userLevels?.map(ul => ul.level) || []
    const userSideList = userSides?.map(us => us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any') || []
    const userDayList = userDays?.map(ud => ud.day_of_week) || []
    
    const filteredSessions = scraper.filterSessionsForUser(
      sessions,
      userLevelList,
      userSideList, 
      userDayList,
      true, // isToday
      userTimeWindows || []
    ).filter(session => {
      const availableSpots = session.spots_available || 0
      return availableSpots > 0 && availableSpots >= (userProfile.min_spots || 1)
    })

    if (filteredSessions.length === 0) {
      const message = `🏄‍♂️ No sessions match your preferences today.

📊 *Your current filters:*
• Levels: ${userLevelList.length > 0 ? userLevelList.map(l => capitalizeLevel(l)).join(', ') : 'Any'}
• Sides: ${userSideList.length > 0 ? userSideList.join(', ') : 'Any'}
• Min spots: ${userProfile.min_spots || 1}

💡 Try adjusting your preferences with /prefs or check /tomorrow!`

      return ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        message,
        { parse_mode: 'Markdown' }
      )
    }

    // Format sessions message
    let message = `🌊 *Today's Sessions* (${filteredSessions.length} match${filteredSessions.length === 1 ? '' : 'es'})\n\n`
    
    filteredSessions.slice(0, 15).forEach(session => {
      const spots = session.spots_available || 0
      const bookingUrl = session.booking_url || 'https://thewave.com/bristol/book/'
      message += `🕐 *${session.time}* - ${session.session_name}\n`
      message += `📍 ${spots} spot${spots === 1 ? '' : 's'} available\n`
      message += `[Book Now](${bookingUrl})\n\n`
    })
    
    if (filteredSessions.length > 15) {
      message += `...and ${filteredSessions.length - 15} more sessions!\n\n`
    }
    
    message += `💡 Use /prefs to adjust your preferences`

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      message,
      { parse_mode: 'Markdown' }
    )

  } catch (error) {
    serverLogger.error('Error in /today command:', { error: error.message })
    try {
      await ctx.reply('❌ Something went wrong loading today\'s sessions. Please try again.')
    } catch (replyError) {
      serverLogger.error('Failed to send error message:', { error: replyError.message })
    }
  }
})

// /setup command - Initial user setup
bot.command('setup', async (ctx) => {
  try {
    // Create or update user profile
    const { error } = await supabase
      .from('profiles')
      .upsert({
        telegram_id: ctx.from.id,
        telegram_username: ctx.from.username || null,
        notification_enabled: true
      }, { 
        onConflict: 'telegram_id',
        ignoreDuplicates: false 
      })

    if (error) {
      serverLogger.error('Error creating profile:', { error: error.message })
      return ctx.reply('Error setting up profile. Try again later.')
    }

    await ctx.reply(`🌊 *Welcome to WavePing!* 🏄‍♂️

I'll help you get personalized Wave Bristol session alerts.

Let's set up your preferences so I can show you the sessions that match what you're looking for!

Use the commands below:
• /today - See today's matching sessions
• /prefs - Set up your detailed preferences  
• /testnotif - Test your notifications

💡 *Quick start*: Use /today to see sessions right away (I'll use default settings), or /prefs to customize everything first.`, 
      { parse_mode: 'Markdown' })

  } catch (error) {
    serverLogger.error('Error in /setup command:', { error: error.message })
    ctx.reply('Error during setup. Please try again.')
  }
})

// /prefs command - Show and manage preferences  
bot.command('prefs', async (ctx) => {
  try {
    const userProfile = await getUserProfile(ctx.from.id)
    if (!userProfile) {
      return ctx.reply("You haven't set up preferences yet. Use /setup to get started.")
    }

    // Get all user preferences
    const { data: preferences, error } = await supabase
      .from('profiles')
      .select(`
        *,
        user_levels (level),
        user_sides (side), 
        user_days (day_of_week),
        user_time_windows (start_time, end_time),
        user_notifications (timing)
      `)
      .eq('id', userProfile.id)
      .single()

    if (error) {
      serverLogger.error('Error fetching preferences:', { error: error.message })
      return ctx.reply('Error loading preferences. Try again later.')
    }

    const message = formatPreferencesMessage(preferences)
    
    await ctx.reply(`${message}

💡 *Commands*:
• /today - See today's sessions with these preferences
• /setup - Reset your preferences  
• /testnotif - Test notifications

🔧 Want to change something? Just run /setup again to reconfigure.`, 
      { parse_mode: 'Markdown' })

  } catch (error) {
    serverLogger.error('Error in /prefs command:', { error: error.message })
    ctx.reply('Error loading preferences. Try again later.')
  }
})

// /testnotif command - Test notifications
bot.command('testnotif', async (ctx) => {
  try {
    const testMessage = `🧪 *Test Notification* 🧪

🌊 Hey! This is a test notification from WavePing.

If you're seeing this, your notifications are working perfectly! 🎉

*Next steps:*
• Set your preferences with /prefs
• Check today's sessions with /today  
• Your personalized surf alerts are ready!

*Pro tip:* WavePing will automatically notify you when spots become available for sessions that match your preferences! 🤙`

    await ctx.reply(testMessage, { parse_mode: 'Markdown' })
    
  } catch (error) {
    serverLogger.error('Test notification error:', { error: error.message })
    await ctx.reply('❌ Test notification failed. Please try again.')
  }
})

// Homepage
app.get('/', (req, res) => {
  res.json({ 
    name: 'WavePing Bot',
    status: 'running',
    description: 'Smart Telegram bot for The Wave Bristol surf session alerts',
    bot: '@WavePingBot',
    version: '1.1.0' // Updated version with improvements
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
    await bot.handleUpdate(req.body)
    res.status(200).send('OK')
  } catch (error) {
    serverLogger.error('Webhook error:', { error: error.message })
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

// Export for testing
module.exports = { app, bot }