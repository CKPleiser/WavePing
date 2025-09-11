require('dotenv').config({ path: '.env.local' })

const express = require('express')
const { Telegraf, session, Markup } = require('telegraf')
const { createClient } = require('@supabase/supabase-js')
const { WaveScheduleScraper } = require('./lib/wave-scraper-final.js')
const { today, tomorrow } = require('./utils/time')
const { toHTML, safeEdit, checkRateLimit } = require('./utils/helpers')

const app = express()
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN)

// Add middleware for parsing JSON
app.use(express.json())

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Add session middleware
bot.use(session())

// Helper function to capitalize level names for display
function capitalizeLevel(level) {
  return level.charAt(0).toUpperCase() + level.slice(1)
}

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
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() })
})

// Test notification endpoint for development
app.post('/api/test/notification', async (req, res) => {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { telegramId, message } = req.body
    
    if (!telegramId || !message) {
      return res.status(400).json({ error: 'telegramId and message required' })
    }

    // Send test notification
    await bot.telegram.sendMessage(telegramId, message, { parse_mode: 'Markdown' })
    
    console.log(`📱 Test notification sent to ${telegramId}: ${message}`)
    res.json({ success: true, message: 'Test notification sent' })
    
  } catch (error) {
    console.error('❌ Test notification error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Test the full notification system with sample data
app.post('/api/test/notification-system', async (req, res) => {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    console.log('🧪 Testing notification system...')
    
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

    console.log(`Found ${users.length} users with notifications enabled`)
    
    // Get some sample sessions to test with
    const { data: sessions, error: sessionsError } = await supabase
      .from('sessions')
      .select('*')
      .gte('date', new Date().toISOString().split('T')[0])
      .limit(5)
    
    if (sessionsError) {
      throw sessionsError
    }

    console.log(`Found ${sessions.length} upcoming sessions`)
    
    // Send test notifications to each user
    const results = []
    for (const user of users) {
      const testMessage = `🧪 *Notification Test* 🧪

🌊 This is a test to make sure your WavePing notifications are working!

*Your notification settings:*
${user.user_notifications.map(n => `• ${n.timing} before sessions`).join('\n')}

*Your level preferences:*
${user.user_levels.map(l => `• ${l.level}`).join('\n')}

If you're seeing this, notifications are working perfectly! 🎉

Use /prefs to manage your notification settings.`

      try {
        await bot.telegram.sendMessage(user.telegram_id, testMessage, { parse_mode: 'Markdown' })
        results.push({ telegramId: user.telegram_id, status: 'sent' })
        console.log(`✅ Test notification sent to ${user.telegram_id}`)
      } catch (error) {
        results.push({ telegramId: user.telegram_id, status: 'failed', error: error.message })
        console.error(`❌ Failed to send to ${user.telegram_id}:`, error.message)
      }
    }
    
    res.json({ 
      success: true, 
      usersFound: users.length,
      sessionsFound: sessions.length,
      results: results
    })
    
  } catch (error) {
    console.error('❌ Notification system test error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Morning digest cron endpoint (8 AM)
app.post('/api/cron/send-morning-digest', async (req, res) => {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    console.log('🌅 Sending morning digest notifications...')
    
    // Get users who want morning digest
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

    // Get users who have morning digest preference
    const { data: morningDigestUsers, error: digestError } = await supabase
      .from('user_digest_preferences')
      .select('user_id')
      .eq('digest_type', 'morning')
    
    if (digestError) throw digestError
    
    const morningUserIds = new Set(morningDigestUsers?.map(u => u.user_id) || [])
    
    // Filter profiles to only those who want morning digest AND have notification timing preferences
    const users = profiles?.filter(user => 
      morningUserIds.has(user.id) && 
      user.user_notifications && 
      user.user_notifications.length > 0
    ) || []

    console.log(`Found ${users.length} users subscribed to morning digest`)

    // Get today's and tomorrow's sessions
    const scraper = new WaveScheduleScraper()
    const todaySessions = await scraper.getTodaysSessions().catch(() => [])
    const tomorrowSessions = await scraper.getTomorrowsSessions().catch(() => [])
    
    const results = []
    
    for (const user of users) {
      try {
        // Get user preferences
        const userLevels = user.user_levels?.map(ul => ul.level) || []
        const userSides = user.user_sides?.map(us => us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any') || []
        const userDays = user.user_days?.map(ud => ud.day_of_week) || []
        const userTimeWindows = user.user_time_windows || []
        
        // Filter sessions for user (including day preferences and availability)
        const todayFiltered = scraper.filterSessionsForUser(todaySessions, userLevels, userSides, userDays, true, userTimeWindows)
          .filter(s => {
            const availableSpots = s.spots_available || 0
            return availableSpots > 0 && availableSpots >= user.min_spots
          })
        const tomorrowFiltered = scraper.filterSessionsForUser(tomorrowSessions, userLevels, userSides, userDays, true, userTimeWindows)
          .filter(s => {
            const availableSpots = s.spots_available || 0
            return availableSpots > 0 && availableSpots >= user.min_spots
          })

        if (todayFiltered.length === 0 && tomorrowFiltered.length === 0) {
          continue // Skip if no matching sessions
        }

        // Create morning digest message
        let message = `🌅 *Good Morning, Wave Rider!* ☀️\n\n`
        
        if (todayFiltered.length > 0) {
          message += `🌊 *TODAY'S SESSIONS* (${todayFiltered.length} match${todayFiltered.length === 1 ? '' : 'es'})\n\n`
          
          todayFiltered.slice(0, 5).forEach(session => {
            const spots = session.spots_available || 0
            const bookingUrl = session.booking_url || 'https://thewave.com/bristol/book/'
            message += `*${session.time}* - ${session.session_name}\n`
            message += `${spots} spot${spots === 1 ? '' : 's'} available\n`
            message += `[Book Now](${bookingUrl})\n\n`
          })
          
          if (todayFiltered.length > 5) {
            message += `...and ${todayFiltered.length - 5} more! Use /today for the full list.\n\n`
          }
        }
        
        if (tomorrowFiltered.length > 0) {
          message += `🌅 *TOMORROW'S PREVIEW* (${tomorrowFiltered.length} session${tomorrowFiltered.length === 1 ? '' : 's'})\n\n`
          
          tomorrowFiltered.slice(0, 3).forEach(session => {
            const spots = session.spots_available || 0
            const bookingUrl = session.booking_url || 'https://thewave.com/bristol/book/'
            message += `*${session.time}* - ${session.session_name}\n`
            message += `${spots} spot${spots === 1 ? '' : 's'} available\n`
            message += `[Book Now](${bookingUrl})\n\n`
          })
        }

        message += `💡 *Quick Commands:*\n`
        message += `• /today - See all today's sessions\n`  
        message += `• /tomorrow - Check tomorrow's lineup\n`
        message += `• /prefs - Update your preferences\n\n`
        message += `🌊 Ready to catch some waves? 🤙`

        await bot.telegram.sendMessage(user.telegram_id, message, { parse_mode: 'Markdown' })
        results.push({ telegramId: user.telegram_id, status: 'sent', sessionsToday: todayFiltered.length, sessionsTomorrow: tomorrowFiltered.length })
        
      } catch (error) {
        console.error(`Failed to send morning digest to ${user.telegram_id}:`, error.message)
        results.push({ telegramId: user.telegram_id, status: 'failed', error: error.message })
      }
    }
    
    console.log(`Morning digest complete: ${results.filter(r => r.status === 'sent').length} sent, ${results.filter(r => r.status === 'failed').length} failed`)
    res.json({ success: true, results })
    
  } catch (error) {
    console.error('Morning digest error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Evening digest cron endpoint (6 PM)
app.post('/api/cron/send-evening-digest', async (req, res) => {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    console.log('🌇 Sending evening digest notifications...')
    
    // Get users who want evening digest
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

    // Get users who have evening digest preference
    const { data: eveningDigestUsers, error: digestError } = await supabase
      .from('user_digest_preferences')
      .select('user_id')
      .eq('digest_type', 'evening')
    
    if (digestError) throw digestError
    
    const eveningUserIds = new Set(eveningDigestUsers?.map(u => u.user_id) || [])
    
    // Filter profiles to only those who want evening digest AND have notification timing preferences
    const users = profiles?.filter(user => 
      eveningUserIds.has(user.id) && 
      user.user_notifications && 
      user.user_notifications.length > 0
    ) || []

    console.log(`Found ${users.length} users subscribed to evening digest`)

    // Get tomorrow's sessions and next few days for weekend preview
    const scraper = new WaveScheduleScraper()
    const tomorrowSessions = await scraper.getTomorrowsSessions().catch(() => [])
    const upcomingSessions = await scraper.getSessionsInRange(3, new Date(Date.now() + 24*60*60*1000)).catch(() => []) // Next 3 days from tomorrow
    
    const results = []
    
    for (const user of users) {
      try {
        // Get user preferences
        const userLevels = user.user_levels?.map(ul => ul.level) || []
        const userSides = user.user_sides?.map(us => us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any') || []
        const userDays = user.user_days?.map(ud => ud.day_of_week) || []
        const userTimeWindows = user.user_time_windows || []
        
        // Filter sessions for user (including day preferences and availability)
        const tomorrowFiltered = scraper.filterSessionsForUser(tomorrowSessions, userLevels, userSides, userDays, true, userTimeWindows)
          .filter(s => {
            const availableSpots = s.spots_available || 0
            return availableSpots > 0 && availableSpots >= user.min_spots
          })
        const upcomingFiltered = scraper.filterSessionsForUser(upcomingSessions, userLevels, userSides, userDays, true, userTimeWindows)
          .filter(s => {
            const availableSpots = s.spots_available || 0
            return availableSpots > 0 && availableSpots >= user.min_spots
          })

        if (tomorrowFiltered.length === 0 && upcomingFiltered.length === 0) {
          continue // Skip if no matching sessions
        }

        // Create evening digest message  
        let message = `🌇 *Evening Wave Report* 🌊\n\n`
        
        if (tomorrowFiltered.length > 0) {
          message += `🌅 *TOMORROW'S SESSIONS* (${tomorrowFiltered.length} match${tomorrowFiltered.length === 1 ? '' : 'es'})\n\n`
          
          tomorrowFiltered.slice(0, 6).forEach(session => {
            const spots = session.spots_available || 0
            const bookingUrl = session.booking_url || 'https://thewave.com/bristol/book/'
            message += `*${session.time}* - ${session.session_name}\n`
            message += `${spots} spot${spots === 1 ? '' : 's'} available\n`
            message += `[Book Now](${bookingUrl})\n\n`
          })
          
          if (tomorrowFiltered.length > 6) {
            message += `...and ${tomorrowFiltered.length - 6} more! Use /tomorrow for the full list.\n\n`
          }
        }
        
        // Weekend preview (if upcoming sessions)
        if (upcomingFiltered.length > tomorrowFiltered.length) {
          const weekendSessions = upcomingFiltered.filter(s => !tomorrowSessions.some(t => t.dateISO === s.dateISO && t.time === s.time))
          if (weekendSessions.length > 0) {
            message += `🗓️ *COMING UP* (Next few days)\n\n`
            
            weekendSessions.slice(0, 3).forEach(session => {
              const spots = session.spots_available || 0
              const bookingUrl = session.booking_url || 'https://thewave.com/bristol/book/'
              message += `*${session.dateLabel}* ${session.time} - ${session.session_name}\n`
              message += `${spots} spot${spots === 1 ? '' : 's'}\n`
              message += `[Book Now](${bookingUrl})\n\n`
            })
          }
        }

        message += `💡 *Plan Your Sessions:*\n`
        message += `• /tomorrow - Full tomorrow schedule\n`  
        message += `• /prefs - Update preferences\n`
        message += `• Book at [The Wave Ticketing](https://ticketing.thewave.com/)\n\n`
        message += `May tomorrow bring perfect waves to you! 🤙`

        await bot.telegram.sendMessage(user.telegram_id, message, { parse_mode: 'Markdown' })
        results.push({ telegramId: user.telegram_id, status: 'sent', sessionsTomorrow: tomorrowFiltered.length, sessionsUpcoming: upcomingFiltered.length })
        
      } catch (error) {
        console.error(`Failed to send evening digest to ${user.telegram_id}:`, error.message)
        results.push({ telegramId: user.telegram_id, status: 'failed', error: error.message })
      }
    }
    
    console.log(`Evening digest complete: ${results.filter(r => r.status === 'sent').length} sent, ${results.filter(r => r.status === 'failed').length} failed`)
    res.json({ success: true, results })
    
  } catch (error) {
    console.error('Evening digest error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Cron endpoint for scraping schedule - improved with UPSERT strategy
app.post('/api/cron/scrape-schedule', async (req, res) => {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const scraper = new WaveScheduleScraper()
    const DAYS = 14

    console.log(`Starting efficient scrape for next ${DAYS} days...`)
    
    // 1) Pull whole window (2–3 HTTP requests under the hood)
    const sessions = await scraper.getSessionsInRange(DAYS)
    console.log(`Scraped ${sessions.length} sessions efficiently`)

    // 2) Map to DB rows
    const rows = sessions.map(s => ({
      id: `${s.dateISO}_${s.time24}_${s.session_name}`.replace(/[^a-zA-Z0-9-_]/g, '_'),
      date: s.dateISO,
      start_time: s.time24,
      end_time: null,
      session_name: s.session_name,
      level: s.level,
      side: s.side === 'Left' ? 'L' : s.side === 'Right' ? 'R' : 'A',
      total_spots: s.spots,
      spots_available: s.spots_available,
      book_url: s.booking_url,
      instructor: null,
      is_active: true,
      last_updated: new Date().toISOString()
    }))

    // 3) UPSERT only (on id). This updates spot counts without nuking the table.
    console.log(`Upserting ${rows.length} sessions...`)
    const { error: upsertErr } = await supabase
      .from('sessions')
      .upsert(rows, { onConflict: 'id' })
    if (upsertErr) throw upsertErr

    // 4) Mark sessions "stale" if they vanished from this scrape (within window)
    const todayISO = new Date().toISOString().slice(0,10)
    const endISO = new Date(Date.now() + DAYS*24*3600*1000).toISOString().slice(0,10)
    const idsNow = rows.map(r => r.id)

    console.log(`Deactivating missing sessions in range ${todayISO} to ${endISO}`)
    
    // Set is_active=false for any row in window that wasn't seen this run
    const { data: existingSessions } = await supabase
      .from('sessions')
      .select('id')
      .gte('date', todayISO)
      .lte('date', endISO)
      .eq('is_active', true)
    
    if (existingSessions) {
      const existingIds = existingSessions.map(s => s.id)
      const missingIds = existingIds.filter(id => !idsNow.includes(id))
      
      if (missingIds.length > 0) {
        console.log(`Deactivating ${missingIds.length} missing sessions`)
        const { error: deactivateErr } = await supabase
          .from('sessions')
          .update({ is_active: false })
          .in('id', missingIds)
        if (deactivateErr) console.error('Deactivation error:', deactivateErr)
      }
    }

    res.json({ 
      ok: true, 
      upserted: rows.length, 
      window: `${todayISO} to ${endISO}`,
      timestamp: new Date().toISOString()
    })

  } catch (e) {
    console.error('Scraping error:', e)
    res.status(500).json({ error: e.message })
  }
})

// Tiered polling endpoints for different time horizons
// Near: next 48h (poll every 2 min)
app.post('/api/cron/scrape-schedule/near', async (req, res) => {
  return handleTieredScrape(req, res, 2, 'next 48h (high frequency)')
})

// Mid: days 3-7 (poll every 10 min) 
app.post('/api/cron/scrape-schedule/mid', async (req, res) => {
  const dayjs = require('dayjs')
  const tz = require('dayjs/plugin/timezone')
  dayjs.extend(tz)
  const startDate = dayjs().tz('Europe/London').add(3, 'day')
  return handleTieredScrape(req, res, 5, 'days 3-7 (medium frequency)', startDate)
})

// Far: days 8-14 (poll every 30-60 min)
app.post('/api/cron/scrape-schedule/far', async (req, res) => {
  const dayjs = require('dayjs')
  const tz = require('dayjs/plugin/timezone')
  dayjs.extend(tz)
  const startDate = dayjs().tz('Europe/London').add(8, 'day')
  return handleTieredScrape(req, res, 7, 'days 8-14 (low frequency)', startDate)
})

async function handleTieredScrape(req, res, days, description, startDate = null) {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const scraper = new WaveScheduleScraper()
    
    console.log(`Starting tiered scrape: ${description}`)
    
    // Pull sessions for the specified window
    const sessions = await scraper.getSessionsInRange(days, startDate)
    console.log(`Scraped ${sessions.length} sessions for ${description}`)

    if (sessions.length === 0) {
      return res.json({ ok: true, upserted: 0, window: description, note: 'No sessions in range' })
    }

    // Map to DB rows with same format as main endpoint
    const rows = sessions.map(s => ({
      id: `${s.dateISO}_${s.time24}_${s.session_name}`.replace(/[^a-zA-Z0-9-_]/g, '_'),
      date: s.dateISO,
      start_time: s.time24,
      end_time: null,
      session_name: s.session_name,
      level: s.level,
      side: s.side === 'Left' ? 'L' : s.side === 'Right' ? 'R' : 'A',
      total_spots: s.spots,
      spots_available: s.spots_available,
      book_url: s.booking_url,
      instructor: null,
      is_active: true,
      last_updated: new Date().toISOString()
    }))

    // UPSERT with conflict resolution
    const { error: upsertErr } = await supabase
      .from('sessions')
      .upsert(rows, { onConflict: 'id' })
    if (upsertErr) throw upsertErr

    // Calculate the actual date range covered
    const dates = [...new Set(rows.map(r => r.date))].sort()
    const dateRange = dates.length > 1 ? `${dates[0]} to ${dates[dates.length-1]}` : dates[0] || 'none'

    res.json({ 
      ok: true, 
      upserted: rows.length,
      window: description,
      dateRange,
      timestamp: new Date().toISOString()
    })

  } catch (e) {
    console.error(`Tiered scraping error (${description}):`, e)
    res.status(500).json({ error: e.message, window: description })
  }
}

// Notification cron endpoint
app.post('/api/cron/send-notifications', async (req, res) => {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const dayjs = require('dayjs')
    const utc = require('dayjs/plugin/utc')
    const timezone = require('dayjs/plugin/timezone')
    dayjs.extend(utc)
    dayjs.extend(timezone)

    console.log('🔔 Starting notification check...')
    const notificationsSent = []

    // Check for each notification timing
    const timings = ['1w', '48h', '24h', '12h', '2h']
    
    for (const timing of timings) {
      const now = dayjs().tz('Europe/London')
      let targetTime

      // Calculate when to send notifications for each timing
      switch (timing) {
        case '1w':
          targetTime = now.add(7, 'day')
          break
        case '48h':
          targetTime = now.add(48, 'hour')
          break
        case '24h':
          targetTime = now.add(24, 'hour')
          break
        case '12h':
          targetTime = now.add(12, 'hour')
          break
        case '2h':
          targetTime = now.add(2, 'hour')
          break
        default:
          continue
      }

      // Find sessions that match the timing window (within 15 minutes tolerance)
      const windowStart = targetTime.subtract(15, 'minute')
      const windowEnd = targetTime.add(15, 'minute')

      const { data: sessions, error: sessionsError } = await supabase
        .from('sessions')
        .select('*')
        .gte('date', windowStart.format('YYYY-MM-DD'))
        .lte('date', windowEnd.format('YYYY-MM-DD'))
        .eq('is_active', true)
        .gt('spots_available', 0)

      if (sessionsError) {
        console.error('Error fetching sessions:', sessionsError)
        continue
      }

      // Filter sessions by actual date/time within window
      const filteredSessions = sessions.filter(session => {
        const sessionDateTime = dayjs.tz(`${session.date} ${session.start_time}`, 'Europe/London')
        return sessionDateTime.isBetween(windowStart, windowEnd, null, '[]')
      })

      console.log(`Found ${filteredSessions.length} sessions for ${timing} timing`)

      // For each session, find eligible users and send notifications
      for (const session of filteredSessions) {
        // Use the database function to get users who should be notified
        const { data: eligibleUsers, error: usersError } = await supabase
          .rpc('get_users_for_session_notification', {
            session_record: {
              level: session.level,
              side: session.side,
              date: session.date,
              start_time: session.start_time,
              spots_available: session.spots_available
            }
          })

        if (usersError) {
          console.error('Error getting eligible users:', usersError)
          continue
        }

        for (const user of eligibleUsers) {
          // Check if we already sent this notification
          const { data: alreadySent, error: checkError } = await supabase
            .from('notifications_sent')
            .select('id')
            .eq('user_id', user.id)
            .eq('session_id', session.id)
            .eq('timing', timing)
            .single()

          if (checkError && checkError.code !== 'PGRST116') {
            console.error('Error checking notifications_sent:', checkError)
            continue
          }

          if (alreadySent) {
            continue // Already sent this notification
          }

          // Check if user has this timing preference
          if (!user.notification_timings || !user.notification_timings.includes(timing)) {
            continue
          }

          try {
            // Send Telegram notification
            const sessionDateTime = dayjs.tz(`${session.date} ${session.start_time}`, 'Europe/London')
            const timeDescription = timing === '1w' ? 'next week' : timing === '48h' ? 'in 2 days' : timing === '24h' ? 'tomorrow' : timing === '12h' ? 'in 12 hours' : 'in 2 hours'
            
            const message = `🌊 *Wave Session Alert!*

📅 ${sessionDateTime.format('ddd Do MMM')} at ${sessionDateTime.format('h:mm A')}
🏄 *${session.session_name}*
📊 Level: ${capitalizeLevel(session.level)}
🏄‍♂️ Side: ${session.side === 'L' ? 'Left' : session.side === 'R' ? 'Right' : 'Any'}
👥 ${session.spots_available} spots available

⏰ This session starts ${timeDescription}!

[Book now](${session.book_url})`

            await bot.telegram.sendMessage(user.telegram_id, message, { 
              parse_mode: 'Markdown',
              disable_web_page_preview: true 
            })

            // Record that we sent this notification
            await supabase
              .from('notifications_sent')
              .insert({
                user_id: user.id,
                session_id: session.id,
                timing: timing,
                sent_at: new Date().toISOString()
              })

            notificationsSent.push({
              telegram_id: user.telegram_id,
              session: session.session_name,
              timing: timing
            })

            console.log(`✅ Sent ${timing} notification to user ${user.telegram_id} for ${session.session_name}`)

          } catch (error) {
            console.error(`❌ Failed to send notification to user ${user.telegram_id}:`, error)
          }
        }
      }
    }

    res.json({
      ok: true,
      notifications_sent: notificationsSent.length,
      details: notificationsSent,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Notification system error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Basic bot commands
bot.start((ctx) => {
  const welcomeMessage = `🌊 *Welcome to WavePing!* 🏄‍♂️

Hey there, fellow wave rider! 👋 

*WavePing* is your personal surf session assistant for The Wave Bristol. Here's what I can do for you:

🔔 *Smart Notifications* - Get alerts for sessions that match your level, preferred side, and times
⏰ *Perfect Timing* - Choose when to be notified (1 week, 24 hours, 2 hours before, etc.)
🎯 *Personalized Filtering* - Only see sessions for your skill level and preferences
🌅 *Time Windows* - Set your preferred surf times (early morning, evening sessions, etc.)
📅 *Quick Checks* - Instantly see what's available today or tomorrow

*Ready to catch some waves?* 🏄‍♀️

Let's get you set up with your surf preferences so I can find the perfect sessions for you!`

  ctx.reply(welcomeMessage, { 
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('🏄‍♂️ Let\'s Get Started!', 'start_setup')]
    ]).reply_markup
  })
})

// Handle the "Let's Get Started!" button
bot.action('start_setup', async (ctx) => {
  await ctx.answerCbQuery('🏄‍♂️ Starting setup...')
  
  const setupMessage = `🏄‍♂️ *Let's Set Up Your Wave Profile!*

I'll walk you through a quick setup to personalize your surf experience. This will help me:

✨ Show you only the sessions that match your skill level
🎯 Filter by your preferred wave side (left, right, or any)
⏰ Send notifications at the perfect times for you
🌅 Match your preferred surf times

*First up: What's your surf level?*

Choose all levels you're comfortable with - you can always change this later! 🤙`

  // Initialize session and redirect to existing setup
  ctx.session = { 
    setup: true,
    step: 'levels',
    selectedLevels: []
  }

  await ctx.editMessageText(setupMessage, {
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('🌱 Beginner', 'level_beginner'), Markup.button.callback('📈 Improver', 'level_improver')],
      [Markup.button.callback('🌊 Intermediate', 'level_intermediate'), Markup.button.callback('🚀 Advanced', 'level_advanced')],
      [Markup.button.callback('🔥 Expert', 'level_expert')],
      [Markup.button.callback('✅ Continue', 'save_levels')]
    ]).reply_markup
  })
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
        [Markup.button.callback('🔔 Edit Notifications', 'edit_notifications')],
        [Markup.button.callback('📬 Edit Digest Settings', 'edit_digests')]
      ]).reply_markup
    })
  } catch (error) {
    console.error('Error showing preferences:', error)
    ctx.reply('Error loading preferences. Try again later.')
  }
})

bot.command('testnotif', async (ctx) => {
  try {
    // Send a test notification to the user
    const testMessage = `🧪 *Test Notification* 🧪

🌊 Hey! This is a test notification from WavePing.

If you're seeing this, your notifications are working perfectly! 🎉

*Next steps:*
• Set your notification preferences with /prefs
• Check today's sessions with /today
• Set up notification timing in preferences

*Pro tip:* WavePing will automatically notify you when spots become available for sessions that match your preferences! 🤙`

    await ctx.reply(testMessage, { parse_mode: 'Markdown' })
    
  } catch (error) {
    console.error('Test notification error:', error)
    await ctx.reply('❌ Test notification failed. Please try again.')
  }
})

bot.command('today', async (ctx) => {
  console.log(`📊 /today command triggered by user ${ctx.from.id}`)
  try {
    const telegramId = ctx.from.id
    
    // Rate limiting
    if (!checkRateLimit(`today:${telegramId}`)) {
      console.log(`⏱ Rate limited user ${telegramId}`)
      return ctx.reply('⏱ Please wait a moment before requesting again...')
    }
    
    console.log(`✅ Rate limit passed for user ${telegramId}`)
    
    // Send loading message
    const loadingMsg = await ctx.reply('🌊 Loading today\'s Wave sessions...')
    
    // Get user preferences
    console.log(`🔍 Getting user profile for ${telegramId}`)
    const userProfile = await getUserProfile(telegramId)
    if (!userProfile) {
      console.log(`❌ No user profile found for ${telegramId}`)
      return ctx.telegram.editMessageText(
        ctx.chat.id, 
        loadingMsg.message_id, 
        undefined,
        '⚠️ Please run /setup first to set your preferences!'
      )
    }
    console.log(`✅ User profile found for ${telegramId}`)
    
    // Get user's selected levels and sides
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
    
    const selectedLevels = userLevels?.map(ul => ul.level) || []
    const selectedSides = userSides?.map(us => us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any') || []
    const selectedDays = userDays?.map(ud => ud.day_of_week) || []
    const selectedTimeWindows = userTimeWindows || []
    
    // Get today's sessions - try database first, fallback to scraper
    const todayStr = today()
    const currentTime = new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Europe/London' }).slice(0, 5) // HH:MM format
    console.log(`🗓️ Getting sessions for ${todayStr}, current time: ${currentTime}`)
    let sessionsFormatted = []
    const scraper = new WaveScheduleScraper() // Create once, reuse
    
    try {
      // Try database first
      const { data: allSessions, error: sessionError } = await supabase
        .from('sessions')
        .select('*')
        .eq('date', todayStr)
        .eq('is_active', true)
        .gte('start_time', currentTime) // Only future sessions
        .order('start_time')
      
      if (!sessionError && allSessions && allSessions.length > 0) {
        console.log(`📊 Found ${allSessions.length} database sessions`)
        // Convert database format to scraper format for compatibility
        sessionsFormatted = allSessions.map(session => ({
          session_name: session.session_name,
          level: session.level,
          side: session.side === 'L' ? 'Left' : session.side === 'R' ? 'Right' : 'Any',
          time: session.start_time,
          time24: session.start_time,
          spots_available: session.spots_available,
          booking_url: session.book_url || 'https://ticketing.thewave.com/'
        }))
      } else {
        // Fallback to scraper if no database sessions
        console.log('📡 No database sessions, falling back to scraper')
        const scrapedSessions = await scraper.getTodaysSessions()
        console.log(`🔍 Scraper found ${scrapedSessions.length} sessions`)
        // Filter out past sessions like we do with database
        sessionsFormatted = scrapedSessions.filter(session => session.time24 >= currentTime)
        console.log(`⏰ After time filtering: ${sessionsFormatted.length} sessions`)
      }
    } catch (error) {
      console.error('Error getting sessions:', error)
      // Final fallback to scraper
      try {
        const scrapedSessions = await scraper.getTodaysSessions()
        sessionsFormatted = scrapedSessions.filter(session => session.time24 >= currentTime)
      } catch (scraperError) {
        console.error('Scraper also failed:', scraperError)
        sessionsFormatted = []
      }
    }
    
    if (!sessionsFormatted || sessionsFormatted.length === 0) {
      return ctx.telegram.editMessageText(
        ctx.chat.id, 
        loadingMsg.message_id, 
        undefined,
        '🏄‍♂️ *No sessions found for today*\n\nThe Wave might be closed or no sessions are available.', 
        { parse_mode: 'Markdown' }
      )
    }
    
    // Filter sessions based on user preferences (skip day filter for /today)
    let sessions = sessionsFormatted
    if (selectedLevels.length > 0 || selectedSides.length > 0 || selectedDays.length > 0 || selectedTimeWindows.length > 0) {
      sessions = scraper.filterSessionsForUser(sessionsFormatted, selectedLevels, selectedSides, selectedDays, true, selectedTimeWindows)
    }
    
    if (sessions.length === 0) {
      let noSessionsMsg = `📅 *No matching sessions for today*\n\n`
      
      const hasFilters = selectedLevels.length > 0 || selectedSides.length > 0 || selectedDays.length > 0 || selectedTimeWindows.length > 0
      if (hasFilters) {
        noSessionsMsg += `🔍 *Your filters:*\n`
        if (selectedLevels.length > 0) noSessionsMsg += `📊 Levels: ${selectedLevels.join(', ')}\n`
        if (selectedSides.length > 0) noSessionsMsg += `🏄 Sides: ${selectedSides.join(', ')}\n`
        if (selectedTimeWindows.length > 0) {
          const timeRanges = selectedTimeWindows.map(tw => `${tw.start_time}-${tw.end_time}`).join(', ')
          noSessionsMsg += `⏰ Times: ${timeRanges}\n`
        }
        if (selectedDays.length > 0) noSessionsMsg += `📅 Days: ${selectedDays.map(d => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]).join(', ')}\n`
        
        // Show available sessions with booking links
        const availableSessions = sessionsFormatted.filter(s => s.spots_available > 0)
        
        if (availableSessions.length > 0) {
          noSessionsMsg += `\n🌊 *Available sessions today:*\n\n`
          
          availableSessions.slice(0, 8).forEach(session => {
            noSessionsMsg += `⏰ *${session.time}* - ${session.session_name}\n`
            noSessionsMsg += `   📊 ${capitalizeLevel(session.level)} • 🏄 ${session.side} • 🎯 ${session.spots_available} spot${session.spots_available === 1 ? '' : 's'}\n`
            if (session.booking_url) {
              noSessionsMsg += `   🔗 [Book Now](${session.booking_url})\n`
            }
            noSessionsMsg += '\n'
          })
          
          if (availableSessions.length > 8) {
            noSessionsMsg += `... and ${availableSessions.length - 8} more! Use /today all to see everything.\n\n`
          }
        }
        
        noSessionsMsg += `Try adjusting your preferences with /prefs or /settime`
      } else {
        noSessionsMsg += `⚠️ You haven't set any preferences!\n`
        noSessionsMsg += `Use /setup to select your surf levels and preferences.`
      }
      
      return ctx.telegram.editMessageText(
        ctx.chat.id, 
        loadingMsg.message_id, 
        undefined,
        noSessionsMsg, 
        { parse_mode: 'Markdown' }
      )
    }
    
    // Get weather data for today
    const { data: weather } = await supabase
      .from('weather_cache')
      .select('*')
      .eq('date', todayStr)
      .maybeSingle()
    
    let message = `🏄‍♂️ <b>Today's Wave Sessions</b>\n`
    
    // Add weather info at the top if available
    if (weather) {
      message += `🌡️ <b>Weather:</b> ${toHTML(weather.air_temp)}°C | 💧 Water: ${toHTML(weather.water_temp)}°C | 💨 Wind: ${toHTML(weather.wind_speed)}mph ${toHTML(weather.wind_direction)}\n\n`
    }
    
    const hasFilters = selectedLevels.length > 0 || selectedSides.length > 0 || selectedDays.length > 0
    if (hasFilters) {
      message += `🔍 <b>Your filters:</b> `
      const filters = []
      if (selectedLevels.length > 0) filters.push(selectedLevels.join(', '))
      if (selectedSides.length > 0) filters.push(selectedSides.join(', '))
      message += toHTML(filters.join(' | ')) + '\n\n'
    } else {
      message += `📋 <b>All available sessions</b>\n\n`
    }
    
    // Filter out sessions with 0 spots
    const availableSessions = sessions.filter(s => s.spots_available > 0)
    
    if (availableSessions.length === 0) {
      message += `😔 All sessions matching your filters are fully booked.\n`
    } else {
      availableSessions.forEach(session => {
        const levelEmoji = {
          'beginner': '🟢',
          'improver': '🔵', 
          'intermediate': '🟡',
          'advanced': '🟠',
          'expert': '🔴'
        }[session.level] || '⚪'
        
        // Clean format without repeated weather
        message += `${levelEmoji} <b>${toHTML(session.session_name)}</b>\n`
        message += `⏰ ${toHTML(session.time)} | 🎫 ${session.spots_available} spots\n`
        if (session.booking_url) {
          message += `🔗 <a href="${session.booking_url}">Book Now</a>\n`
        }
        message += `\n`
      })
    }
    
    message += `📱 <i>Live from The Wave</i>`
    
    ctx.telegram.editMessageText(
      ctx.chat.id, 
      loadingMsg.message_id, 
      undefined,
      message, 
      { 
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }
    )
    
  } catch (error) {
    console.error('Error in today command:', error)
    try {
      await ctx.reply('❌ Error loading sessions. Try again later.')
    } catch (replyError) {
      console.error('Failed to send error message:', replyError)
    }
  }
})

bot.command('tomorrow', async (ctx) => {
  try {
    const telegramId = ctx.from.id
    
    // Rate limiting
    if (!checkRateLimit(`tomorrow:${telegramId}`)) {
      return ctx.reply('⏱ Please wait a moment before requesting again...')
    }
    
    // Send loading message
    const loadingMsg = await ctx.reply('🌊 Loading tomorrow\'s Wave sessions...')
    
    // Get user preferences
    const userProfile = await getUserProfile(telegramId)
    if (!userProfile) {
      return ctx.telegram.editMessageText(
        ctx.chat.id, 
        loadingMsg.message_id, 
        undefined,
        '⚠️ Please run /setup first to set your preferences!'
      )
    }
    
    // Get user's selected levels and sides
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
    
    const selectedLevels = userLevels?.map(ul => ul.level) || []
    const selectedSides = userSides?.map(us => us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any') || []
    const selectedDays = userDays?.map(ud => ud.day_of_week) || []
    const selectedTimeWindows = userTimeWindows || []
    
    // Get tomorrow's sessions - try database first, fallback to scraper
    const tomorrowStr = tomorrow()
    let sessionsFormatted = []
    const scraper = new WaveScheduleScraper() // Create once, reuse
    
    try {
      // Try database first
      const { data: allSessions, error: sessionError } = await supabase
        .from('sessions')
        .select('*')
        .eq('date', tomorrowStr)
        .eq('is_active', true)
        .order('start_time')
      
      if (!sessionError && allSessions && allSessions.length > 0) {
        // Convert database format to scraper format for compatibility
        sessionsFormatted = allSessions.map(session => ({
          session_name: session.session_name,
          level: session.level,
          side: session.side === 'L' ? 'Left' : session.side === 'R' ? 'Right' : 'Any',
          time: session.start_time,
          time24: session.start_time,
          spots_available: session.spots_available,
          booking_url: session.book_url || 'https://ticketing.thewave.com/'
        }))
      } else {
        // Fallback to scraper if no database sessions
        console.log('No database sessions for tomorrow, falling back to scraper')
        sessionsFormatted = await scraper.getTomorrowsSessions()
      }
    } catch (error) {
      console.error('Error getting tomorrow sessions:', error)
      // Final fallback to scraper
      try {
        sessionsFormatted = await scraper.getTomorrowsSessions()
      } catch (scraperError) {
        console.error('Scraper also failed for tomorrow:', scraperError)
        sessionsFormatted = []
      }
    }
    
    if (!sessionsFormatted || sessionsFormatted.length === 0) {
      return ctx.telegram.editMessageText(
        ctx.chat.id, 
        loadingMsg.message_id, 
        undefined,
        '🏄‍♂️ *No sessions found for tomorrow*\n\nThe Wave might be closed or no sessions are scheduled yet.', 
        { parse_mode: 'Markdown' }
      )
    }
    
    // Filter sessions based on user preferences (skip day filter for /tomorrow)
    let sessions = sessionsFormatted
    if (selectedLevels.length > 0 || selectedSides.length > 0 || selectedDays.length > 0 || selectedTimeWindows.length > 0) {
      sessions = scraper.filterSessionsForUser(sessionsFormatted, selectedLevels, selectedSides, selectedDays, true, selectedTimeWindows)
    }
    
    if (sessions.length === 0) {
      let noSessionsMsg = `📅 *No matching sessions for tomorrow*\n\n`
      
      const hasFilters = selectedLevels.length > 0 || selectedSides.length > 0 || selectedDays.length > 0 || selectedTimeWindows.length > 0
      if (hasFilters) {
        noSessionsMsg += `🔍 *Your filters:*\n`
        if (selectedLevels.length > 0) noSessionsMsg += `📊 Levels: ${selectedLevels.join(', ')}\n`
        if (selectedSides.length > 0) noSessionsMsg += `🏄 Sides: ${selectedSides.join(', ')}\n`
        if (selectedTimeWindows.length > 0) {
          const timeRanges = selectedTimeWindows.map(tw => `${tw.start_time}-${tw.end_time}`).join(', ')
          noSessionsMsg += `⏰ Times: ${timeRanges}\n`
        }
        if (selectedDays.length > 0) noSessionsMsg += `📅 Days: ${selectedDays.map(d => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]).join(', ')}\n`
        
        const availableLevels = sessionsFormatted.map(s => s.level).filter((v, i, a) => a.indexOf(v) === i)
        const availableTimes = sessionsFormatted.map(s => s.time24).filter((v, i, a) => a.indexOf(v) === i).sort()
        
        noSessionsMsg += `\n💡 *Available tomorrow:*\n`
        if (availableLevels.length > 0) noSessionsMsg += `📊 Levels: ${availableLevels.map(l => capitalizeLevel(l)).join(', ')}\n`
        if (availableTimes.length > 0) noSessionsMsg += `⏰ Times: ${availableTimes.join(', ')}\n`
        noSessionsMsg += `\nTry adjusting your preferences with /prefs or /settime`
      } else {
        noSessionsMsg += `⚠️ You haven't set any preferences!\n`
        noSessionsMsg += `Use /setup to select your surf levels and preferences.`
      }
      
      return ctx.telegram.editMessageText(
        ctx.chat.id, 
        loadingMsg.message_id, 
        undefined,
        noSessionsMsg, 
        { parse_mode: 'Markdown' }
      )
    }
    
    // Get weather data for tomorrow
    const { data: weather } = await supabase
      .from('weather_cache')
      .select('*')
      .eq('date', tomorrowStr)
      .maybeSingle()
    
    let message = `🏄‍♂️ <b>Tomorrow's Wave Sessions</b>\n`
    
    // Add weather info at the top if available
    if (weather) {
      message += `🌡️ <b>Weather:</b> ${toHTML(weather.air_temp)}°C | 💧 Water: ${toHTML(weather.water_temp)}°C | 💨 Wind: ${toHTML(weather.wind_speed)}mph ${toHTML(weather.wind_direction)}\n\n`
    }
    
    const hasFilters = selectedLevels.length > 0 || selectedSides.length > 0 || selectedDays.length > 0
    if (hasFilters) {
      message += `🔍 <b>Your filters:</b> `
      const filters = []
      if (selectedLevels.length > 0) filters.push(selectedLevels.join(', '))
      if (selectedSides.length > 0) filters.push(selectedSides.join(', '))
      message += toHTML(filters.join(' | ')) + '\n\n'
    } else {
      message += `📋 <b>All scheduled sessions</b>\n\n`
    }
    
    // Filter out sessions with 0 spots
    const availableSessions = sessions.filter(s => s.spots_available > 0)
    
    if (availableSessions.length === 0) {
      message += `😔 All sessions matching your filters are fully booked.\n`
    } else {
      availableSessions.forEach(session => {
        const levelEmoji = {
          'beginner': '🟢',
          'improver': '🔵',
          'intermediate': '🟡',
          'advanced': '🟠',
          'expert': '🔴'
        }[session.level] || '⚪'
        
        // Clean format without repeated weather
        message += `${levelEmoji} <b>${toHTML(session.session_name)}</b>\n`
        message += `⏰ ${toHTML(session.time)} | 🎫 ${session.spots_available} spots\n`
        if (session.booking_url) {
          message += `🔗 <a href="${session.booking_url}">Book Now</a>\n`
        }
        message += `\n`
      })
    }
    
    message += `📱 <i>Live from The Wave</i>`
    
    ctx.telegram.editMessageText(
      ctx.chat.id, 
      loadingMsg.message_id, 
      undefined,
      message, 
      { 
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }
    )
    
  } catch (error) {
    console.error('Error in tomorrow command:', error)
    try {
      await ctx.reply('❌ Error loading sessions. Try again later.')
    } catch (replyError) {
      console.error('Failed to send error message:', replyError)
    }
  }
})


bot.command('setup', async (ctx) => {
  try {
    // Create user profile if doesn't exist
    const { error } = await supabase
      .from('profiles')
      .upsert({
        telegram_id: ctx.from.id,
        telegram_username: ctx.from.username || null
      }, { 
        onConflict: 'telegram_id',
        ignoreDuplicates: false 
      })

    if (error) {
      console.error('Error creating profile:', error)
      return ctx.reply('Error setting up profile. Try again later.')
    }

    // Start with level selection
    await ctx.reply('⚙️ *Let\'s set up your preferences!*\n\nFirst, select your session levels:', {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('🟢 Beginner', 'level_beginner')],
        [Markup.button.callback('🔵 Improver', 'level_improver')],
        [Markup.button.callback('🟡 Intermediate', 'level_intermediate')],
        [Markup.button.callback('🟠 Advanced', 'level_advanced')],
        [Markup.button.callback('🔴 Expert', 'level_expert')],
        [Markup.button.callback('💾 Save Levels', 'save_levels')]
      ]).reply_markup
    })
  } catch (error) {
    console.error('Error in setup:', error)
    ctx.reply('Error starting setup. Try again later.')
  }
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

// Level selection handlers - just save directly to database
bot.action(/level_(.+)/, async (ctx) => {
  try {
    const level = ctx.match[1]
    const telegramId = ctx.from.id
    
    try {
      await ctx.answerCbQuery(`Selected: ${level}`)
    } catch (cbError) {
      // Handle case where callback query has expired
      if (cbError.response?.error_code === 400 && cbError.response?.description?.includes('query is too old')) {
        console.log('Callback query expired, but continuing with level selection')
      } else {
        console.error('Callback query error:', cbError)
        throw cbError // Re-throw if it's a different error
      }
    }
    
    // Check if we're in setup mode - if so, just update session
    if (ctx.session && ctx.session.setup === true) {
      // Initialize selectedLevels array if not exists
      if (!ctx.session.selectedLevels) {
        ctx.session.selectedLevels = []
      }
      
      // Toggle level in session
      if (ctx.session.selectedLevels.includes(level)) {
        ctx.session.selectedLevels = ctx.session.selectedLevels.filter(l => l !== level)
      } else {
        ctx.session.selectedLevels.push(level)
      }
      
      // Update UI with session selections
      const selectedText = ctx.session.selectedLevels.length > 0 
        ? `\n\n*Currently selected*: ${ctx.session.selectedLevels.join(', ')}`
        : ''
      
      await ctx.editMessageText(`🏄‍♂️ *Let's Set Up Your Wave Profile!*\n\nChoose all levels you're comfortable with:${selectedText}`, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(`${ctx.session.selectedLevels.includes('beginner') ? '✅ ' : ''}🌱 Beginner`, 'level_beginner'), 
           Markup.button.callback(`${ctx.session.selectedLevels.includes('improver') ? '✅ ' : ''}📈 Improver`, 'level_improver')],
          [Markup.button.callback(`${ctx.session.selectedLevels.includes('intermediate') ? '✅ ' : ''}🌊 Intermediate`, 'level_intermediate'), 
           Markup.button.callback(`${ctx.session.selectedLevels.includes('advanced') ? '✅ ' : ''}🚀 Advanced`, 'level_advanced')],
          [Markup.button.callback(`${ctx.session.selectedLevels.includes('expert') ? '✅ ' : ''}🔥 Expert`, 'level_expert')],
          [Markup.button.callback('✅ Continue', 'save_levels')]
        ]).reply_markup
      })
      return
    }
    
    // Regular level editing (not in setup mode) - write to database directly
    // Get or create user profile
    let userProfile = await getUserProfile(telegramId)
    if (!userProfile) {
      console.log('Creating new profile for telegram user:', telegramId)
      const { data, error } = await supabase
        .from('profiles')
        .insert({ telegram_id: telegramId, telegram_username: ctx.from.username })
        .select()
        .single()
      
      if (error) {
        console.error('Error creating profile:', error)
        return ctx.answerCbQuery('Error creating profile. Try again.')
      }
      userProfile = data
    }
    
    if (!userProfile) {
      console.error('No user profile available')
      return ctx.answerCbQuery('Profile error. Try /start first.')
    }
    
    // Check if level already exists
    const { data: existingLevel, error: checkError } = await supabase
      .from('user_levels')
      .select('*')
      .eq('user_id', userProfile.id)
      .eq('level', level)
      .single()
    
    // Note: single() returns error when no rows found, which is expected behavior
    if (existingLevel) {
      // Remove level
      console.log(`Removing level ${level} for user ${userProfile.id}`)
      const { error: deleteError } = await supabase
        .from('user_levels')
        .delete()
        .eq('user_id', userProfile.id)
        .eq('level', level)
      
      if (deleteError) {
        console.error('Error deleting level:', deleteError)
        return ctx.answerCbQuery('Error removing level. Try again.')
      }
    } else {
      // Add level
      console.log(`Adding level ${level} for user ${userProfile.id}`)
      const { error: insertError } = await supabase
        .from('user_levels')
        .insert({ user_id: userProfile.id, level: level })
      
      if (insertError) {
        console.error('Error inserting level:', insertError)
        return ctx.answerCbQuery('Error adding level. Try again.')
      }
    }
    
    // Get current levels and update message
    const { data: userLevels, error: fetchError } = await supabase
      .from('user_levels')
      .select('level')
      .eq('user_id', userProfile.id)
    
    if (fetchError) {
      console.error('Error fetching user levels:', fetchError)
      return ctx.answerCbQuery('Error loading levels. Try again.')
    }
    
    const currentLevels = userLevels?.map(ul => ul.level) || []
    const selectedText = currentLevels.length > 0 
      ? `\n\n*Currently selected*: ${currentLevels.join(', ')}`
      : ''
    
    console.log('Current levels from DB:', currentLevels)
    
    // Check if we're in setup mode
    const isSetupMode = ctx.session && ctx.session.setup === true
    const continueButton = isSetupMode 
      ? [Markup.button.callback('✅ Continue', 'save_levels')]
      : [Markup.button.callback('✅ Done', 'levels_done')]
    
    await ctx.editMessageText(`⚙️ *Edit Session Levels*\n\nClick levels to toggle them:${selectedText}`, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`${currentLevels.includes('beginner') ? '✅ ' : ''}🟢 Beginner`, 'level_beginner')],
        [Markup.button.callback(`${currentLevels.includes('improver') ? '✅ ' : ''}🔵 Improver`, 'level_improver')],
        [Markup.button.callback(`${currentLevels.includes('intermediate') ? '✅ ' : ''}🟡 Intermediate`, 'level_intermediate')],
        [Markup.button.callback(`${currentLevels.includes('advanced') ? '✅ ' : ''}🟠 Advanced`, 'level_advanced')],
        [Markup.button.callback(`${currentLevels.includes('expert') ? '✅ ' : ''}🔴 Expert`, 'level_expert')],
        continueButton
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error in level selection:', error)
    try {
      await ctx.answerCbQuery('Error. Try again.')
    } catch (cbError) {
      // Ignore callback query errors in error handler
      if (cbError.response?.error_code === 400 && cbError.response?.description?.includes('query is too old')) {
        console.log('Cannot answer expired callback query in error handler')
      } else {
        console.error('Callback error in error handler:', cbError)
      }
    }
  }
})

// Done with levels
bot.action('levels_done', async (ctx) => {
  try {
    await ctx.answerCbQuery('✅ Saved successfully!')
    
    // Get user's saved levels for confirmation
    const userProfile = await getUserProfile(ctx.from.id)
    const { data: userLevels } = await supabase
      .from('user_levels')
      .select('level')
      .eq('user_id', userProfile.id)
    
    const savedLevels = userLevels?.map(ul => ul.level) || []
    
    let confirmationMsg = '✅ *Preferences Saved Successfully!*\n\n'
    confirmationMsg += '📊 *Your selected levels:*\n'
    
    if (savedLevels.length > 0) {
      savedLevels.forEach(level => {
        const emoji = {
          'beginner': '🟢',
          'improver': '🔵',
          'intermediate': '🟡',
          'advanced': '🟠',
          'expert': '🔴'
        }[level] || '⚪'
        confirmationMsg += `${emoji} ${capitalizeLevel(level)}\n`
      })
    } else {
      confirmationMsg += '_No levels selected_\n'
    }
    
    confirmationMsg += '\n📱 *Next steps:*\n'
    confirmationMsg += '• Use /today to see matching sessions\n'
    confirmationMsg += '• Use /tomorrow for tomorrow\'s sessions\n'
    confirmationMsg += '• Use /prefs to adjust preferences\n'
    confirmationMsg += '\n🔔 You\'ll be notified when spots open up!'
    
    await ctx.editMessageText(confirmationMsg, { parse_mode: 'Markdown' })
    
  } catch (error) {
    console.error('Error in levels_done:', error)
    await ctx.editMessageText('✅ Levels saved! Use /prefs to view.')
  }
})

// Edit sides handler
bot.action('edit_sides', async (ctx) => {
  try {
    await ctx.answerCbQuery('Loading sides...')
    
    const userProfile = await getUserProfile(ctx.from.id)
    if (!userProfile) {
      return ctx.editMessageText('⚠️ Please run /setup first!')
    }
    
    // Get current sides
    const { data: userSides } = await supabase
      .from('user_sides')
      .select('side')
      .eq('user_id', userProfile.id)
    
    // Convert database values to display names
    const currentSidesDb = userSides?.map(us => us.side) || [] // ['L', 'R', 'A']
    const currentSidesDisplay = currentSidesDb.map(s => s === 'L' ? 'Left' : s === 'R' ? 'Right' : 'Any')
    
    const selectedText = currentSidesDisplay.length > 0 
      ? `\n\n*Currently selected*: ${currentSidesDisplay.join(', ')}`
      : ''
    
    await ctx.editMessageText(`🏄 *Edit Preferred Sides*\n\nClick sides to toggle them:${selectedText}`, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`${currentSidesDb.includes('L') ? '✅ ' : ''}🏄‍♂️ Left Side`, 'side_Left')],
        [Markup.button.callback(`${currentSidesDb.includes('R') ? '✅ ' : ''}🏄‍♀️ Right Side`, 'side_Right')],
        [Markup.button.callback(`${currentSidesDb.includes('A') ? '✅ ' : ''}🤙 Any Side`, 'side_Any')],
        [Markup.button.callback('✅ Done', 'sides_done')]
      ]).reply_markup
    })
  } catch (error) {
    console.error('Error in edit_sides:', error)
    await ctx.answerCbQuery('Error loading sides.')
  }
})

// Side selection handler
bot.action(/side_(.+)/, async (ctx) => {
  try {
    const sideDisplay = ctx.match[1] // 'Left', 'Right', 'Any'
    const telegramId = ctx.from.id
    
    // Convert display name to database value
    const sideDbValue = sideDisplay === 'Left' ? 'L' : sideDisplay === 'Right' ? 'R' : 'A'
    
    await ctx.answerCbQuery(`Selected: ${sideDisplay}`)
    
    const userProfile = await getUserProfile(telegramId)
    if (!userProfile) return
    
    // Check if side already exists
    const { data: existingSide } = await supabase
      .from('user_sides')
      .select('*')
      .eq('user_id', userProfile.id)
      .eq('side', sideDbValue)
      .single()
    
    if (existingSide) {
      // Remove side
      await supabase
        .from('user_sides')
        .delete()
        .eq('user_id', userProfile.id)
        .eq('side', sideDbValue)
    } else {
      // Add side
      await supabase
        .from('user_sides')
        .insert({ user_id: userProfile.id, side: sideDbValue })
    }
    
    // Get current sides and update message
    const { data: userSides } = await supabase
      .from('user_sides')
      .select('side')
      .eq('user_id', userProfile.id)
    
    // Convert database values to display names
    const currentSidesDb = userSides?.map(us => us.side) || [] // ['L', 'R', 'A']
    const currentSidesDisplay = currentSidesDb.map(s => s === 'L' ? 'Left' : s === 'R' ? 'Right' : 'Any')
    
    const selectedText = currentSidesDisplay.length > 0 
      ? `\n\n*Currently selected*: ${currentSidesDisplay.join(', ')}`
      : ''
    
    await ctx.editMessageText(`🏄 *Edit Preferred Sides*\n\nClick sides to toggle them:${selectedText}`, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`${currentSidesDb.includes('L') ? '✅ ' : ''}🏄‍♂️ Left Side`, 'side_Left')],
        [Markup.button.callback(`${currentSidesDb.includes('R') ? '✅ ' : ''}🏄‍♀️ Right Side`, 'side_Right')],
        [Markup.button.callback(`${currentSidesDb.includes('A') ? '✅ ' : ''}🤙 Any Side`, 'side_Any')],
        [Markup.button.callback('✅ Done', 'sides_done')]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error in side selection:', error)
    await ctx.answerCbQuery('Error. Try again.')
  }
})

// Done with sides
bot.action('sides_done', async (ctx) => {
  await ctx.answerCbQuery('✅ Sides saved!')
  await ctx.editMessageText('✅ *Sides Saved!*\n\nUse /prefs to see all your preferences.', { parse_mode: 'Markdown' })
})

// Edit days handler
bot.action('edit_days', async (ctx) => {
  try {
    await ctx.answerCbQuery('Loading days...')
    
    const userProfile = await getUserProfile(ctx.from.id)
    if (!userProfile) {
      return ctx.editMessageText('⚠️ Please run /setup first!')
    }
    
    // Get current days
    const { data: userDays } = await supabase
      .from('user_days')
      .select('day_of_week')
      .eq('user_id', userProfile.id)
    
    const currentDays = userDays?.map(ud => ud.day_of_week) || []
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const selectedDayNames = currentDays.map(d => dayNames[d])
    const selectedText = currentDays.length > 0 
      ? `\n\n*Currently selected*: ${selectedDayNames.join(', ')}`
      : ''
    
    await ctx.editMessageText(`📅 *Edit Preferred Days*\n\nClick days to toggle them:${selectedText}`, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`${currentDays.includes(0) ? '✅ ' : ''}Mon`, 'day_0'), Markup.button.callback(`${currentDays.includes(1) ? '✅ ' : ''}Tue`, 'day_1')],
        [Markup.button.callback(`${currentDays.includes(2) ? '✅ ' : ''}Wed`, 'day_2'), Markup.button.callback(`${currentDays.includes(3) ? '✅ ' : ''}Thu`, 'day_3')],
        [Markup.button.callback(`${currentDays.includes(4) ? '✅ ' : ''}Fri`, 'day_4'), Markup.button.callback(`${currentDays.includes(5) ? '✅ ' : ''}Sat`, 'day_5')],
        [Markup.button.callback(`${currentDays.includes(6) ? '✅ ' : ''}Sun`, 'day_6')],
        [Markup.button.callback('✅ Done', 'days_done')]
      ]).reply_markup
    })
  } catch (error) {
    console.error('Error in edit_days:', error)
    await ctx.answerCbQuery('Error loading days.')
  }
})

// Day selection handler
bot.action(/day_(\d)/, async (ctx) => {
  try {
    const dayOfWeek = parseInt(ctx.match[1])
    const telegramId = ctx.from.id
    
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    await ctx.answerCbQuery(`Selected: ${dayNames[dayOfWeek]}`)
    
    const userProfile = await getUserProfile(telegramId)
    if (!userProfile) return
    
    // Check if day already exists
    const { data: existingDay } = await supabase
      .from('user_days')
      .select('*')
      .eq('user_id', userProfile.id)
      .eq('day_of_week', dayOfWeek)
      .single()
    
    if (existingDay) {
      // Remove day
      await supabase
        .from('user_days')
        .delete()
        .eq('user_id', userProfile.id)
        .eq('day_of_week', dayOfWeek)
    } else {
      // Add day
      await supabase
        .from('user_days')
        .insert({ user_id: userProfile.id, day_of_week: dayOfWeek })
    }
    
    // Get current days and update message
    const { data: userDays } = await supabase
      .from('user_days')
      .select('day_of_week')
      .eq('user_id', userProfile.id)
    
    const currentDays = userDays?.map(ud => ud.day_of_week) || []
    const fullDayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const selectedDayNames = currentDays.map(d => fullDayNames[d])
    const selectedText = currentDays.length > 0 
      ? `\n\n*Currently selected*: ${selectedDayNames.join(', ')}`
      : ''
    
    await ctx.editMessageText(`📅 *Edit Preferred Days*\n\nClick days to toggle them:${selectedText}`, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`${currentDays.includes(0) ? '✅ ' : ''}Mon`, 'day_0'), Markup.button.callback(`${currentDays.includes(1) ? '✅ ' : ''}Tue`, 'day_1')],
        [Markup.button.callback(`${currentDays.includes(2) ? '✅ ' : ''}Wed`, 'day_2'), Markup.button.callback(`${currentDays.includes(3) ? '✅ ' : ''}Thu`, 'day_3')],
        [Markup.button.callback(`${currentDays.includes(4) ? '✅ ' : ''}Fri`, 'day_4'), Markup.button.callback(`${currentDays.includes(5) ? '✅ ' : ''}Sat`, 'day_5')],
        [Markup.button.callback(`${currentDays.includes(6) ? '✅ ' : ''}Sun`, 'day_6')],
        [Markup.button.callback('✅ Done', 'days_done')]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error in day selection:', error)
    await ctx.answerCbQuery('Error. Try again.')
  }
})

// Done with days
bot.action('days_done', async (ctx) => {
  await ctx.answerCbQuery('✅ Days saved!')
  await ctx.editMessageText('✅ *Days Saved!*\n\nUse /prefs to see all your preferences.', { parse_mode: 'Markdown' })
})

// Edit times handler
bot.action('edit_times', async (ctx) => {
  try {
    await ctx.answerCbQuery('Loading times...')
    
    const userProfile = await getUserProfile(ctx.from.id)
    if (!userProfile) {
      return ctx.editMessageText('⚠️ Please run /setup first!')
    }
    
    // Get current time preferences
    const { data: userTimeWindows } = await supabase
      .from('user_time_windows')
      .select('start_time, end_time')
      .eq('user_id', userProfile.id)
    
    const currentTimes = userTimeWindows || []
    
    // Helper function to check if a time window exists
    const hasTimeWindow = (startTime, endTime) => {
      return currentTimes.some(tw => tw.start_time === startTime && tw.end_time === endTime)
    }
    
    let message = '🕐 *Time Preferences*\n\n'
    message += 'Click to toggle your preferred time windows:\n\n'
    
    if (currentTimes.length > 0) {
      message += '✅ *Currently selected:*\n'
      currentTimes.forEach((tw, i) => {
        message += `   ${tw.start_time} - ${tw.end_time}\n`
      })
      message += '\n'
    }
    
    const timeButtons = [
      [
        Markup.button.callback(`${hasTimeWindow('07:00', '10:00') ? '✅ ' : ''}🌅 Early (7-10am)`, 'time_early'),
        Markup.button.callback(`${hasTimeWindow('10:00', '13:00') ? '✅ ' : ''}🌞 Morning (10am-1pm)`, 'time_morning')
      ],
      [
        Markup.button.callback(`${hasTimeWindow('13:00', '17:00') ? '✅ ' : ''}☀️ Afternoon (1-5pm)`, 'time_afternoon'),
        Markup.button.callback(`${hasTimeWindow('17:00', '20:00') ? '✅ ' : ''}🌇 Evening (5-8pm)`, 'time_evening')
      ],
      [
        Markup.button.callback(`${hasTimeWindow('20:00', '23:00') ? '✅ ' : ''}🌙 Late (8-11pm)`, 'time_late'),
        Markup.button.callback('🔧 Custom Times', 'time_custom')
      ],
      [
        Markup.button.callback('🗑️ Clear All', 'time_clear'),
        Markup.button.callback('✅ Done', 'times_done')
      ]
    ]
    
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard(timeButtons).reply_markup
    })
    
  } catch (error) {
    console.error('Error in edit_times:', error)
    await ctx.answerCbQuery('Error loading times.')
  }
})

// Time preference handlers - now with toggle functionality
bot.action('time_early', async (ctx) => {
  await toggleTimeWindow(ctx, '07:00', '10:00', '🌅 Early (7-10am)')
})

bot.action('time_morning', async (ctx) => {
  await toggleTimeWindow(ctx, '10:00', '13:00', '🌞 Morning (10am-1pm)')
})

bot.action('time_afternoon', async (ctx) => {
  await toggleTimeWindow(ctx, '13:00', '17:00', '☀️ Afternoon (1-5pm)')
})

bot.action('time_evening', async (ctx) => {
  await toggleTimeWindow(ctx, '17:00', '20:00', '🌇 Evening (5-8pm)')
})

bot.action('time_late', async (ctx) => {
  await toggleTimeWindow(ctx, '20:00', '23:00', '🌙 Late (8-11pm)')
})

bot.action('time_custom', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.editMessageText(
    '🔧 *Custom Time Window*\n\n' +
    'To set custom times, use this format:\n' +
    '`/settime 09:30 12:30`\n\n' +
    'This will add 9:30am-12:30pm to your preferences.\n\n' +
    'Multiple time windows are supported!',
    { parse_mode: 'Markdown' }
  )
})

bot.action('time_clear', async (ctx) => {
  await ctx.answerCbQuery('Clearing time preferences...')
  
  try {
    // Get user
    const { data: user } = await supabase
      .from('profiles')
      .select('id')
      .eq('telegram_id', ctx.from.id)
      .single()
    
    if (user) {
      // Clear all time windows
      await supabase
        .from('user_time_windows')
        .delete()
        .eq('user_id', user.id)
    }
    
    await ctx.editMessageText('🗑️ *Time preferences cleared!*\n\nYou\'ll now see sessions at any time of day.', { parse_mode: 'Markdown' })
    
  } catch (error) {
    console.error('Error clearing time preferences:', error)
    await ctx.editMessageText('❌ Error clearing preferences. Try again later.')
  }
})

bot.action('times_done', async (ctx) => {
  await ctx.answerCbQuery('✅ Times saved!')
  await ctx.editMessageText('✅ *Time Preferences Saved!*\n\nUse /prefs to see all your preferences.', { parse_mode: 'Markdown' })
})

// Custom time command
bot.command('settime', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1)
  if (args.length !== 2) {
    return ctx.reply('Usage: /settime 09:30 12:30\n\nThis adds a time window from 9:30am to 12:30pm.')
  }
  
  const [startTime, endTime] = args
  
  // Validate time format
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/
  if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
    return ctx.reply('❌ Invalid time format. Use HH:MM format (24-hour).\n\nExample: /settime 09:30 17:00')
  }
  
  // Validate time logic
  if (startTime >= endTime) {
    return ctx.reply('❌ Start time must be before end time.')
  }
  
  try {
    // Get or create user
    const { data: user } = await supabase
      .from('profiles')
      .select('id')
      .eq('telegram_id', ctx.from.id)
      .single()
    
    if (!user) {
      return ctx.reply('❌ User not found. Please use /setup first.')
    }
    
    // Add time window
    const { error } = await supabase
      .from('user_time_windows')
      .insert({
        user_id: user.id,
        start_time: startTime,
        end_time: endTime
      })
    
    if (error) throw error
    
    ctx.reply(`✅ *Custom time window added!*\n\n🕐 ${startTime} - ${endTime}\n\nUse /prefs to see all your preferences.`, { parse_mode: 'Markdown' })
    
  } catch (error) {
    console.error('Error saving custom time:', error)
    ctx.reply('❌ Error saving time preference. Try again later.')
  }
})

// Edit notifications handler  
bot.action('edit_notifications', async (ctx) => {
  try {
    await ctx.answerCbQuery('Loading notifications...')
    
    const userProfile = await getUserProfile(ctx.from.id)
    if (!userProfile) {
      return ctx.editMessageText('⚠️ Please run /setup first!')
    }
    
    // Get current notification preferences
    const { data: userNotifications } = await supabase
      .from('user_notifications')
      .select('timing')
      .eq('user_id', userProfile.id)
    
    const currentTimings = userNotifications?.map(un => un.timing) || []
    const selectedText = currentTimings.length > 0 
      ? `\n\n*Currently selected*: ${currentTimings.join(', ')}`
      : ''
    
    await ctx.editMessageText(`🔔 *Edit Notification Preferences*\n\nSelect when you want to be notified about matching sessions:${selectedText}`, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`${currentTimings.includes('1w') ? '✅ ' : ''}📅 1 week before`, 'notif_1w')],
        [Markup.button.callback(`${currentTimings.includes('48h') ? '✅ ' : ''}⏰ 2 days before`, 'notif_48h')],
        [Markup.button.callback(`${currentTimings.includes('24h') ? '✅ ' : ''}📆 24 hours before`, 'notif_24h')],
        [Markup.button.callback(`${currentTimings.includes('12h') ? '✅ ' : ''}🌅 12 hours before`, 'notif_12h')],
        [Markup.button.callback(`${currentTimings.includes('2h') ? '✅ ' : ''}⚡ 2 hours before`, 'notif_2h')],
        [Markup.button.callback('✅ Done', 'notifications_done')]
      ]).reply_markup
    })
  } catch (error) {
    console.error('Error in edit_notifications:', error)
    await ctx.answerCbQuery('Error loading notifications.')
  }
})

// Notification timing selection handler
bot.action(/notif_(.+)/, async (ctx) => {
  try {
    const timing = ctx.match[1]
    const telegramId = ctx.from.id
    
    await ctx.answerCbQuery(`Selected: ${timing}`)
    
    const userProfile = await getUserProfile(telegramId)
    if (!userProfile) return
    
    // Check if timing already exists
    const { data: existingTiming } = await supabase
      .from('user_notifications')
      .select('*')
      .eq('user_id', userProfile.id)
      .eq('timing', timing)
      .single()
    
    if (existingTiming) {
      // Remove timing
      await supabase
        .from('user_notifications')
        .delete()
        .eq('user_id', userProfile.id)
        .eq('timing', timing)
    } else {
      // Add timing
      await supabase
        .from('user_notifications')
        .insert({ user_id: userProfile.id, timing: timing })
    }
    
    // Get current timings and update message
    const { data: userNotifications } = await supabase
      .from('user_notifications')
      .select('timing')
      .eq('user_id', userProfile.id)
    
    const currentTimings = userNotifications?.map(un => un.timing) || []
    const selectedText = currentTimings.length > 0 
      ? `\n\n*Currently selected*: ${currentTimings.join(', ')}`
      : ''
    
    await ctx.editMessageText(`🔔 *Edit Notification Preferences*\n\nSelect when you want to be notified about matching sessions:${selectedText}`, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`${currentTimings.includes('1w') ? '✅ ' : ''}📅 1 week before`, 'notif_1w')],
        [Markup.button.callback(`${currentTimings.includes('48h') ? '✅ ' : ''}⏰ 2 days before`, 'notif_48h')],
        [Markup.button.callback(`${currentTimings.includes('24h') ? '✅ ' : ''}📆 24 hours before`, 'notif_24h')],
        [Markup.button.callback(`${currentTimings.includes('12h') ? '✅ ' : ''}🌅 12 hours before`, 'notif_12h')],
        [Markup.button.callback(`${currentTimings.includes('2h') ? '✅ ' : ''}⚡ 2 hours before`, 'notif_2h')],
        [Markup.button.callback('✅ Done', 'notifications_done')]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error in notification selection:', error)
    await ctx.answerCbQuery('Error. Try again.')
  }
})

// Done with notifications - now ask for digest delivery preferences
bot.action('notifications_done', async (ctx) => {
  await ctx.answerCbQuery('Moving to digest preferences...')
  
  try {
    const userProfile = await getUserProfile(ctx.from.id)
    if (!userProfile) return
    
    // Get current digest preferences
    const { data: digestPrefs } = await supabase
      .from('user_digest_preferences')
      .select('digest_type')
      .eq('user_id', userProfile.id)
    
    const currentDigests = digestPrefs?.map(dp => dp.digest_type) || []
    
    await ctx.editMessageText('📬 *Digest Delivery*\n\nYour notification timing is saved! Now choose when to receive digest messages with your matching sessions:', {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(`${currentDigests.includes('morning') ? '✅ ' : ''}🌅 Morning Digest (8 AM)`, 'digest_morning'),
          Markup.button.callback(`${currentDigests.includes('evening') ? '✅ ' : ''}🌇 Evening Digest (6 PM)`, 'digest_evening')
        ],
        [
          Markup.button.callback('✅ All Done', 'digest_done'),
          Markup.button.callback('🔙 Back to Timings', 'edit_notifications')
        ]
      ]).reply_markup
    })
  } catch (error) {
    console.error('Error showing digest preferences:', error)
    await ctx.editMessageText('✅ *Notifications Saved!*\n\nYou\'ll receive alerts for sessions matching your preferences.\n\nUse /prefs to see all your preferences.', { parse_mode: 'Markdown' })
  }
})

// Digest delivery preference handlers
bot.action(/digest_(morning|evening)/, async (ctx) => {
  try {
    const digestType = ctx.match[1]
    const userProfile = await getUserProfile(ctx.from.id)
    if (!userProfile) return
    
    await ctx.answerCbQuery(`${digestType === 'morning' ? 'Morning' : 'Evening'} digest toggled`)
    
    // Check if preference exists
    const { data: existingPref } = await supabase
      .from('user_digest_preferences')
      .select('*')
      .eq('user_id', userProfile.id)
      .eq('digest_type', digestType)
      .single()
    
    if (existingPref) {
      // Remove preference
      await supabase
        .from('user_digest_preferences')
        .delete()
        .eq('user_id', userProfile.id)
        .eq('digest_type', digestType)
    } else {
      // Add preference
      await supabase
        .from('user_digest_preferences')
        .insert({ user_id: userProfile.id, digest_type: digestType })
    }
    
    // Refresh the UI
    const { data: digestPrefs } = await supabase
      .from('user_digest_preferences')
      .select('digest_type')
      .eq('user_id', userProfile.id)
    
    const currentDigests = digestPrefs?.map(dp => dp.digest_type) || []
    
    await ctx.editMessageText('📬 *Digest Delivery*\n\nYour notification timing is saved! Now choose when to receive digest messages with your matching sessions:', {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(`${currentDigests.includes('morning') ? '✅ ' : ''}🌅 Morning Digest (8 AM)`, 'digest_morning'),
          Markup.button.callback(`${currentDigests.includes('evening') ? '✅ ' : ''}🌇 Evening Digest (6 PM)`, 'digest_evening')
        ],
        [
          Markup.button.callback('✅ All Done', 'digest_done'),
          Markup.button.callback('🔙 Back to Timings', 'edit_notifications')
        ]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error updating digest preferences:', error)
    await ctx.answerCbQuery('Error updating digest preferences')
  }
})

// Digest preferences done
bot.action('digest_done', async (ctx) => {
  await ctx.answerCbQuery('✅ All preferences saved!')
  await ctx.editMessageText('✅ *All Preferences Saved!*\n\nYou\'ll receive digest messages for sessions matching your preferences.\n\nUse /prefs to see all your preferences.', { parse_mode: 'Markdown' })
})

// Save levels handler
bot.action('save_levels', async (ctx) => {
  await ctx.answerCbQuery('Saving levels...')
  
  if (!ctx.session.selectedLevels || ctx.session.selectedLevels.length === 0) {
    return ctx.editMessageText('❌ Please select at least one level first!')
  }
  
  try {
    // Delete existing levels
    await supabase
      .from('user_levels')
      .delete()
      .eq('user_id', (await getUserProfile(ctx.from.id))?.id)
    
    // Insert new levels
    const userProfile = await getUserProfile(ctx.from.id)
    if (userProfile) {
      const levelInserts = ctx.session.selectedLevels.map(level => ({
        user_id: userProfile.id,
        level: level
      }))
      
      await supabase.from('user_levels').insert(levelInserts)
    }

    // Check if this is initial setup or just editing levels
    const isInitialSetup = ctx.session.setup === true
    
    if (isInitialSetup) {
      // Continue to next setup step: sides
      ctx.session.step = 'sides'
      ctx.session.selectedSides = [] // Initialize sides selection
      
      const sidesMessage = `✅ *Great! Levels saved: ${ctx.session.selectedLevels.join(', ')}*

🏄‍♂️ *Step 2: Choose Your Preferred Wave Side*

The Wave has both **Left** and **Right** breaking waves. Most surfers have a preference based on their stance:

🏄‍♂️ **Left waves**: Better for regular foot surfers (left foot forward)
🏄‍♀️ **Right waves**: Better for goofy foot surfers (right foot forward) 
🌊 **Any side**: No preference, show me everything!

*What's your preference?* (You can select multiple or choose Any) 🤙`

      await ctx.editMessageText(sidesMessage, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(`${ctx.session.selectedSides?.includes('Left') ? '✅ ' : ''}🏄‍♂️ Left Waves`, 'setup_side_Left')],
          [Markup.button.callback(`${ctx.session.selectedSides?.includes('Right') ? '✅ ' : ''}🏄‍♀️ Right Waves`, 'setup_side_Right')],
          [Markup.button.callback(`${ctx.session.selectedSides?.includes('Any') ? '✅ ' : ''}🌊 Any Side`, 'setup_side_Any')],
          [Markup.button.callback('✅ Continue', 'save_sides')]
        ]).reply_markup
      })
    } else {
      // Regular edit mode
      await ctx.editMessageText(`✅ *Levels saved!*\n\nYour selected levels: ${ctx.session.selectedLevels.join(', ')}\n\nUse /prefs to continue setting up other preferences.`, { parse_mode: 'Markdown' })
    }
    
    // Clear session
    ctx.session.selectedLevels = []
    ctx.session.setup = false
    
  } catch (error) {
    console.error('Error saving levels:', error)
    ctx.editMessageText('❌ Error saving levels. Try again later.')
  }
})

// Helper functions
async function getUserProfile(telegramId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('telegram_id', telegramId)
    .single()
  
  if (error) {
    console.error('Error fetching user profile:', error)
    return null
  }
  
  return data
}

async function toggleTimeWindow(ctx, startTime, endTime, description) {
  try {
    const userProfile = await getUserProfile(ctx.from.id)
    if (!userProfile) return
    
    // Check if this time window already exists
    const { data: existing } = await supabase
      .from('user_time_windows')
      .select('*')
      .eq('user_id', userProfile.id)
      .eq('start_time', startTime)
      .eq('end_time', endTime)
      .single()
    
    if (existing) {
      // Remove time window
      await ctx.answerCbQuery(`Removed ${description}`)
      await supabase
        .from('user_time_windows')
        .delete()
        .eq('user_id', userProfile.id)
        .eq('start_time', startTime)
        .eq('end_time', endTime)
    } else {
      // Add time window
      await ctx.answerCbQuery(`Added ${description}`)
      await supabase
        .from('user_time_windows')
        .insert({
          user_id: userProfile.id,
          start_time: startTime,
          end_time: endTime
        })
    }
    
    // Refresh the UI with updated selections
    const { data: userTimeWindows } = await supabase
      .from('user_time_windows')
      .select('start_time, end_time')
      .eq('user_id', userProfile.id)
    
    const currentTimes = userTimeWindows || []
    
    // Helper function to check if a time window exists
    const hasTimeWindow = (startTime, endTime) => {
      return currentTimes.some(tw => tw.start_time === startTime && tw.end_time === endTime)
    }
    
    let message = '🕐 *Time Preferences*\n\n'
    message += 'Click to toggle your preferred time windows:\n\n'
    
    if (currentTimes.length > 0) {
      message += '✅ *Currently selected:*\n'
      currentTimes.forEach((tw, i) => {
        message += `   ${tw.start_time} - ${tw.end_time}\n`
      })
      message += '\n'
    }
    
    const timeButtons = [
      [
        Markup.button.callback(`${hasTimeWindow('07:00', '10:00') ? '✅ ' : ''}🌅 Early (7-10am)`, 'time_early'),
        Markup.button.callback(`${hasTimeWindow('10:00', '13:00') ? '✅ ' : ''}🌞 Morning (10am-1pm)`, 'time_morning')
      ],
      [
        Markup.button.callback(`${hasTimeWindow('13:00', '17:00') ? '✅ ' : ''}☀️ Afternoon (1-5pm)`, 'time_afternoon'),
        Markup.button.callback(`${hasTimeWindow('17:00', '20:00') ? '✅ ' : ''}🌇 Evening (5-8pm)`, 'time_evening')
      ],
      [
        Markup.button.callback(`${hasTimeWindow('20:00', '23:00') ? '✅ ' : ''}🌙 Late (8-11pm)`, 'time_late'),
        Markup.button.callback('🔧 Custom Times', 'time_custom')
      ],
      [
        Markup.button.callback('🗑️ Clear All', 'time_clear'),
        Markup.button.callback('✅ Done', 'times_done')
      ]
    ]
    
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard(timeButtons).reply_markup
    })
    
  } catch (error) {
    console.error('Error toggling time window:', error)
    await ctx.answerCbQuery('Error. Try again.')
  }
}

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

// Setup-specific side handlers (for guided setup flow)
bot.action(/setup_side_(.+)/, async (ctx) => {
  try {
    const side = ctx.match[1]
    await ctx.answerCbQuery(`Selected: ${side}`)
    
    if (!ctx.session.selectedSides) {
      ctx.session.selectedSides = []
    }
    
    // Toggle side selection
    if (ctx.session.selectedSides.includes(side)) {
      ctx.session.selectedSides = ctx.session.selectedSides.filter(s => s !== side)
    } else {
      // If "Any" is selected, clear other selections
      if (side === 'Any') {
        ctx.session.selectedSides = ['Any']
      } else {
        // If selecting Left/Right, remove "Any" first
        ctx.session.selectedSides = ctx.session.selectedSides.filter(s => s !== 'Any')
        ctx.session.selectedSides.push(side)
      }
    }
    
    // Update UI
    const selectedText = ctx.session.selectedSides.length > 0 
      ? `\n\n*Currently selected*: ${ctx.session.selectedSides.join(', ')}`
      : ''
    
    const sidesMessage = `✅ *Great! Levels saved: ${ctx.session.selectedLevels.join(', ')}*

🏄‍♂️ *Step 2: Choose Your Preferred Wave Side*

The Wave has both **Left** and **Right** breaking waves. Most surfers have a preference based on their stance:

🏄‍♂️ **Left waves**: Better for regular foot surfers (left foot forward)
🏄‍♀️ **Right waves**: Better for goofy foot surfers (right foot forward) 
🌊 **Any side**: No preference, show me everything!

*What's your preference?* (You can select multiple or choose Any) 🤙${selectedText}`

    await ctx.editMessageText(sidesMessage, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`${ctx.session.selectedSides?.includes('Left') ? '✅ ' : ''}🏄‍♂️ Left Waves`, 'setup_side_Left')],
        [Markup.button.callback(`${ctx.session.selectedSides?.includes('Right') ? '✅ ' : ''}🏄‍♀️ Right Waves`, 'setup_side_Right')],
        [Markup.button.callback(`${ctx.session.selectedSides?.includes('Any') ? '✅ ' : ''}🌊 Any Side`, 'setup_side_Any')],
        [Markup.button.callback('✅ Continue', 'save_sides')]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error in setup side selection:', error)
    await ctx.answerCbQuery('Error. Try again.')
  }
})

bot.action('save_sides', async (ctx) => {
  try {
    await ctx.answerCbQuery('Saving sides...')
    
    // Use "Any" as default if nothing selected
    const selectedSides = ctx.session.selectedSides?.length > 0 ? ctx.session.selectedSides : ['Any']
    
    // Save to database
    const userProfile = await getUserProfile(ctx.from.id)
    if (userProfile) {
      // Delete existing sides
      await supabase
        .from('user_sides')
        .delete()
        .eq('user_id', userProfile.id)
      
      // Insert new sides (convert display names to database values)
      const sideInserts = selectedSides.map(side => ({
        user_id: userProfile.id,
        side: side === 'Left' ? 'L' : side === 'Right' ? 'R' : 'A'
      }))
      
      await supabase.from('user_sides').insert(sideInserts)
    }
    
    // Continue to next step: minimum spots
    ctx.session.step = 'min_spots'
    ctx.session.selectedMinSpots = 1 // Default to 1
    
    const minSpotsMessage = `✅ *Sides saved: ${selectedSides.join(', ')}*

🎯 *Step 3: How Many Available Spots Do You Need?*

Sessions fill up fast! Choose the minimum number of available spots you need to be interested:

🤷 **I don't care**: Show me any session with spots
🔟 **10+ spots**: Only sessions with plenty of availability  
5️⃣ **5+ spots**: Sessions with good availability
2️⃣ **2+ spots**: Sessions with at least a few spots

💡 *Pro tip*: Lower numbers = more session opportunities, but they might fill up faster! 🤙`

    await ctx.editMessageText(minSpotsMessage, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(`${ctx.session.selectedMinSpots === 1 ? '✅ ' : ''}🤷 I don't care`, 'setup_min_spots_1'),
          Markup.button.callback(`${ctx.session.selectedMinSpots === 10 ? '✅ ' : ''}🔟 10+ spots`, 'setup_min_spots_10')
        ],
        [
          Markup.button.callback(`${ctx.session.selectedMinSpots === 5 ? '✅ ' : ''}5️⃣ 5+ spots`, 'setup_min_spots_5'),
          Markup.button.callback(`${ctx.session.selectedMinSpots === 2 ? '✅ ' : ''}2️⃣ 2+ spots`, 'setup_min_spots_2')
        ],
        [Markup.button.callback('✅ Continue', 'save_min_spots')]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error saving sides:', error)
    await ctx.editMessageText('❌ Error saving sides. Try /setup again.')
  }
})

// Setup day handlers
bot.action(/setup_day_(\d)/, async (ctx) => {
  try {
    const day = parseInt(ctx.match[1])
    await ctx.answerCbQuery(`Selected: ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][day]}`)
    
    if (!ctx.session.selectedDays) {
      ctx.session.selectedDays = []
    }
    
    // Toggle day
    if (ctx.session.selectedDays.includes(day)) {
      ctx.session.selectedDays = ctx.session.selectedDays.filter(d => d !== day)
    } else {
      ctx.session.selectedDays.push(day)
    }
    
    // Update UI
    const selectedText = ctx.session.selectedDays.length > 0 
      ? `\n\n*Currently selected*: ${ctx.session.selectedDays.map(d => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][d]).join(', ')}`
      : ''
    
    const daysMessage = `✅ *Sides saved: ${ctx.session.selectedSides?.join(', ') || 'Any'}*

📅 *Step 3: Choose Your Surf Days*

When are you typically free to surf? Select the days you'd like to receive notifications for:

💡 *Pro tip*: You can always check sessions for any day using /today and /tomorrow, but notifications will only be sent for your selected days! 🤙${selectedText}`

    await ctx.editMessageText(daysMessage, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(`${ctx.session.selectedDays?.includes(0) ? '✅ ' : ''}Mon`, 'setup_day_0'),
          Markup.button.callback(`${ctx.session.selectedDays?.includes(1) ? '✅ ' : ''}Tue`, 'setup_day_1'),
          Markup.button.callback(`${ctx.session.selectedDays?.includes(2) ? '✅ ' : ''}Wed`, 'setup_day_2')
        ],
        [
          Markup.button.callback(`${ctx.session.selectedDays?.includes(3) ? '✅ ' : ''}Thu`, 'setup_day_3'),
          Markup.button.callback(`${ctx.session.selectedDays?.includes(4) ? '✅ ' : ''}Fri`, 'setup_day_4')
        ],
        [
          Markup.button.callback(`${ctx.session.selectedDays?.includes(5) ? '✅ ' : ''}Sat`, 'setup_day_5'),
          Markup.button.callback(`${ctx.session.selectedDays?.includes(6) ? '✅ ' : ''}Sun`, 'setup_day_6')
        ],
        [
          Markup.button.callback('📅 All Days', 'setup_all_days'),
          Markup.button.callback('⏭️ Skip', 'save_days')
        ],
        [Markup.button.callback('✅ Continue', 'save_days')]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error in setup day selection:', error)
    await ctx.answerCbQuery('Error. Try again.')
  }
})

bot.action('setup_all_days', async (ctx) => {
  try {
    await ctx.answerCbQuery('Selected all days')
    ctx.session.selectedDays = [0, 1, 2, 3, 4, 5, 6]
    
    const daysMessage = `✅ *Sides saved: ${ctx.session.selectedSides?.join(', ') || 'Any'}*

📅 *Step 3: Choose Your Surf Days*

When are you typically free to surf? Select the days you'd like to receive notifications for:

💡 *Pro tip*: You can always check sessions for any day using /today and /tomorrow, but notifications will only be sent for your selected days! 🤙

*Currently selected*: All days`

    await ctx.editMessageText(daysMessage, {
      parse_mode: 'Markdown', 
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Mon', 'setup_day_0'),
          Markup.button.callback('✅ Tue', 'setup_day_1'),
          Markup.button.callback('✅ Wed', 'setup_day_2')
        ],
        [
          Markup.button.callback('✅ Thu', 'setup_day_3'),
          Markup.button.callback('✅ Fri', 'setup_day_4')
        ],
        [
          Markup.button.callback('✅ Sat', 'setup_day_5'),
          Markup.button.callback('✅ Sun', 'setup_day_6')
        ],
        [
          Markup.button.callback('📅 All Days', 'setup_all_days'),
          Markup.button.callback('⏭️ Skip', 'save_days')
        ],
        [Markup.button.callback('✅ Continue', 'save_days')]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error selecting all days:', error)
    await ctx.answerCbQuery('Error. Try again.')
  }
})

// Setup min spots handlers
bot.action(/setup_min_spots_(\d+)/, async (ctx) => {
  try {
    const minSpots = parseInt(ctx.match[1])
    await ctx.answerCbQuery(`Selected: ${minSpots === 1 ? "I don't care" : `${minSpots}+ spots`}`)
    
    ctx.session.selectedMinSpots = minSpots
    
    const minSpotsMessage = `✅ *Sides saved: ${ctx.session.selectedSides?.join(', ') || 'Any'}*

🎯 *Step 3: How Many Available Spots Do You Need?*

Sessions fill up fast! Choose the minimum number of available spots you need to be interested:

🤷 **I don't care**: Show me any session with spots
🔟 **10+ spots**: Only sessions with plenty of availability  
5️⃣ **5+ spots**: Sessions with good availability
2️⃣ **2+ spots**: Sessions with at least a few spots

💡 *Pro tip*: Lower numbers = more session opportunities, but they might fill up faster! 🤙

*Currently selected*: ${minSpots === 1 ? "I don't care" : `${minSpots}+ spots`}`

    await ctx.editMessageText(minSpotsMessage, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(`${ctx.session.selectedMinSpots === 1 ? '✅ ' : ''}🤷 I don't care`, 'setup_min_spots_1'),
          Markup.button.callback(`${ctx.session.selectedMinSpots === 10 ? '✅ ' : ''}🔟 10+ spots`, 'setup_min_spots_10')
        ],
        [
          Markup.button.callback(`${ctx.session.selectedMinSpots === 5 ? '✅ ' : ''}5️⃣ 5+ spots`, 'setup_min_spots_5'),
          Markup.button.callback(`${ctx.session.selectedMinSpots === 2 ? '✅ ' : ''}2️⃣ 2+ spots`, 'setup_min_spots_2')
        ],
        [Markup.button.callback('✅ Continue', 'save_min_spots')]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error in setup min spots selection:', error)
    await ctx.answerCbQuery('Error. Try again.')
  }
})

bot.action('save_min_spots', async (ctx) => {
  try {
    await ctx.answerCbQuery('Saving minimum spots...')
    
    const selectedMinSpots = ctx.session.selectedMinSpots || 1
    
    // Save to database
    const userProfile = await getUserProfile(ctx.from.id)
    if (userProfile) {
      await supabase
        .from('profiles')
        .update({ min_spots: selectedMinSpots })
        .eq('id', userProfile.id)
    }
    
    // Continue to next step: days
    ctx.session.step = 'days'
    ctx.session.selectedDays = [] // Initialize days selection
    
    const daysMessage = `✅ *Minimum spots saved: ${selectedMinSpots === 1 ? "I don't care" : `${selectedMinSpots}+ spots`}*

📅 *Step 4: Choose Your Surf Days*

When are you typically free to surf? Select the days you'd like to receive notifications for:

💡 *Pro tip*: You can always check sessions for any day using /today and /tomorrow, but notifications will only be sent for your selected days! 🤙`

    await ctx.editMessageText(daysMessage, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(`${ctx.session.selectedDays?.includes(0) ? '✅ ' : ''}Mon`, 'setup_day_0'),
          Markup.button.callback(`${ctx.session.selectedDays?.includes(1) ? '✅ ' : ''}Tue`, 'setup_day_1'),
          Markup.button.callback(`${ctx.session.selectedDays?.includes(2) ? '✅ ' : ''}Wed`, 'setup_day_2')
        ],
        [
          Markup.button.callback(`${ctx.session.selectedDays?.includes(3) ? '✅ ' : ''}Thu`, 'setup_day_3'),
          Markup.button.callback(`${ctx.session.selectedDays?.includes(4) ? '✅ ' : ''}Fri`, 'setup_day_4')
        ],
        [
          Markup.button.callback(`${ctx.session.selectedDays?.includes(5) ? '✅ ' : ''}Sat`, 'setup_day_5'),
          Markup.button.callback(`${ctx.session.selectedDays?.includes(6) ? '✅ ' : ''}Sun`, 'setup_day_6')
        ],
        [
          Markup.button.callback('📅 All Days', 'setup_all_days'),
          Markup.button.callback('⏭️ Skip', 'save_days')
        ],
        [Markup.button.callback('✅ Continue', 'save_days')]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error saving min spots:', error)
    await ctx.editMessageText('❌ Error saving minimum spots. Try /setup again.')
  }
})

bot.action('save_days', async (ctx) => {
  try {
    await ctx.answerCbQuery('Saving days...')
    
    const selectedDays = ctx.session.selectedDays || []
    
    // Save to database
    const userProfile = await getUserProfile(ctx.from.id)
    if (userProfile) {
      // Delete existing days
      await supabase
        .from('user_days')
        .delete()
        .eq('user_id', userProfile.id)
      
      // Insert new days if any selected
      if (selectedDays.length > 0) {
        const dayInserts = selectedDays.map(day => ({
          user_id: userProfile.id,
          day_of_week: day
        }))
        
        await supabase.from('user_days').insert(dayInserts)
      }
    }
    
    // Continue to next step: times
    ctx.session.step = 'times'
    ctx.session.selectedTimeWindows = [] // Initialize time selection
    
    const timesMessage = `✅ *Days saved: ${selectedDays.length > 0 ? selectedDays.map(d => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][d]).join(', ') : 'Any day'}*

🕐 *Step 5: Choose Your Preferred Surf Times*

When do you prefer to surf? Select your ideal time windows:

🌅 **Early**: Perfect for those dawn patrol sessions
🌞 **Morning**: Classic mid-morning surf  
☀️ **Afternoon**: Post-lunch wave sessions
🌇 **Evening**: After-work surf sessions
🌙 **Late**: Night surfing under the lights

💡 *Pro tip*: You can select multiple time windows or skip this to see all sessions! 🤙`

    await ctx.editMessageText(timesMessage, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(`${ctx.session.selectedTimeWindows?.some(tw => tw.start_time === '07:00' && tw.end_time === '10:00') ? '✅ ' : ''}🌅 Early (7-10am)`, 'setup_time_early'),
          Markup.button.callback(`${ctx.session.selectedTimeWindows?.some(tw => tw.start_time === '10:00' && tw.end_time === '13:00') ? '✅ ' : ''}🌞 Morning (10am-1pm)`, 'setup_time_morning')
        ],
        [
          Markup.button.callback(`${ctx.session.selectedTimeWindows?.some(tw => tw.start_time === '13:00' && tw.end_time === '17:00') ? '✅ ' : ''}☀️ Afternoon (1-5pm)`, 'setup_time_afternoon'),
          Markup.button.callback(`${ctx.session.selectedTimeWindows?.some(tw => tw.start_time === '17:00' && tw.end_time === '20:00') ? '✅ ' : ''}🌇 Evening (5-8pm)`, 'setup_time_evening')
        ],
        [
          Markup.button.callback(`${ctx.session.selectedTimeWindows?.some(tw => tw.start_time === '20:00' && tw.end_time === '23:00') ? '✅ ' : ''}🌙 Late (8-11pm)`, 'setup_time_late')
        ],
        [
          Markup.button.callback('⏭️ Skip', 'save_times'),
          Markup.button.callback('✅ Continue', 'save_times')
        ]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error saving days:', error)
    await ctx.editMessageText('❌ Error saving days. Try /setup again.')
  }
})

// Setup time handlers
bot.action(/setup_time_(.+)/, async (ctx) => {
  try {
    const timeSlot = ctx.match[1]
    
    // Define time windows
    const timeWindows = {
      early: { start_time: '07:00', end_time: '10:00', description: '🌅 Early (7-10am)' },
      morning: { start_time: '10:00', end_time: '13:00', description: '🌞 Morning (10am-1pm)' },
      afternoon: { start_time: '13:00', end_time: '17:00', description: '☀️ Afternoon (1-5pm)' },
      evening: { start_time: '17:00', end_time: '20:00', description: '🌇 Evening (5-8pm)' },
      late: { start_time: '20:00', end_time: '23:00', description: '🌙 Late (8-11pm)' }
    }
    
    const selectedWindow = timeWindows[timeSlot]
    if (!selectedWindow) return
    
    await ctx.answerCbQuery(`Selected: ${selectedWindow.description}`)
    
    if (!ctx.session.selectedTimeWindows) {
      ctx.session.selectedTimeWindows = []
    }
    
    // Toggle time window
    const existingIndex = ctx.session.selectedTimeWindows.findIndex(tw => 
      tw.start_time === selectedWindow.start_time && tw.end_time === selectedWindow.end_time
    )
    
    if (existingIndex !== -1) {
      ctx.session.selectedTimeWindows.splice(existingIndex, 1)
    } else {
      ctx.session.selectedTimeWindows.push(selectedWindow)
    }
    
    // Update UI
    const selectedText = ctx.session.selectedTimeWindows.length > 0 
      ? `\n\n*Currently selected*: ${ctx.session.selectedTimeWindows.map(tw => tw.description).join(', ')}`
      : ''
    
    const timesMessage = `✅ *Days saved: ${ctx.session.selectedDays?.length > 0 ? ctx.session.selectedDays.map(d => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][d]).join(', ') : 'Any day'}*

🕐 *Step 5: Choose Your Preferred Surf Times*

When do you prefer to surf? Select your ideal time windows:

🌅 **Early**: Perfect for those dawn patrol sessions
🌞 **Morning**: Classic mid-morning surf  
☀️ **Afternoon**: Post-lunch wave sessions
🌇 **Evening**: After-work surf sessions
🌙 **Late**: Night surfing under the lights

💡 *Pro tip*: You can select multiple time windows or skip this to see all sessions! 🤙${selectedText}`

    await ctx.editMessageText(timesMessage, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(`${ctx.session.selectedTimeWindows?.some(tw => tw.start_time === '07:00' && tw.end_time === '10:00') ? '✅ ' : ''}🌅 Early (7-10am)`, 'setup_time_early'),
          Markup.button.callback(`${ctx.session.selectedTimeWindows?.some(tw => tw.start_time === '10:00' && tw.end_time === '13:00') ? '✅ ' : ''}🌞 Morning (10am-1pm)`, 'setup_time_morning')
        ],
        [
          Markup.button.callback(`${ctx.session.selectedTimeWindows?.some(tw => tw.start_time === '13:00' && tw.end_time === '17:00') ? '✅ ' : ''}☀️ Afternoon (1-5pm)`, 'setup_time_afternoon'),
          Markup.button.callback(`${ctx.session.selectedTimeWindows?.some(tw => tw.start_time === '17:00' && tw.end_time === '20:00') ? '✅ ' : ''}🌇 Evening (5-8pm)`, 'setup_time_evening')
        ],
        [
          Markup.button.callback(`${ctx.session.selectedTimeWindows?.some(tw => tw.start_time === '20:00' && tw.end_time === '23:00') ? '✅ ' : ''}🌙 Late (8-11pm)`, 'setup_time_late')
        ],
        [
          Markup.button.callback('⏭️ Skip', 'save_times'),
          Markup.button.callback('✅ Continue', 'save_times')
        ]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error in setup time selection:', error)
    await ctx.answerCbQuery('Error. Try again.')
  }
})

bot.action('save_times', async (ctx) => {
  try {
    await ctx.answerCbQuery('Saving times...')
    
    const selectedTimeWindows = ctx.session.selectedTimeWindows || []
    
    // Save to database
    const userProfile = await getUserProfile(ctx.from.id)
    if (userProfile) {
      // Delete existing time windows
      await supabase
        .from('user_time_windows')
        .delete()
        .eq('user_id', userProfile.id)
      
      // Insert new time windows if any selected
      if (selectedTimeWindows.length > 0) {
        const timeInserts = selectedTimeWindows.map(tw => ({
          user_id: userProfile.id,
          start_time: tw.start_time,
          end_time: tw.end_time
        }))
        
        await supabase.from('user_time_windows').insert(timeInserts)
      }
    }
    
    // Final step: notifications  
    ctx.session.step = 'notifications'
    ctx.session.selectedNotifications = ['morning'] // Default to morning digest
    
    const notificationsMessage = `✅ *Times saved: ${selectedTimeWindows.length > 0 ? selectedTimeWindows.map(tw => tw.description).join(', ') : 'Any time'}*

🔔 *Step 6: Set Up Notifications* (Final Step!)

Get daily surf digests sent to you! Choose when you want to receive your personalized surf reports:

🌅 **Morning Digest (8 AM)**: Perfect for planning your day
- Today's matching sessions
- Tomorrow's upcoming sessions  
- Spot availability updates

🌇 **Evening Digest (6 PM)**: Great for next-day planning
- Tomorrow's matching sessions
- Weekend sessions preview
- Last-minute spot openings

💡 *Pro tip: Get both digests to never miss perfect waves!* 🌊`

    await ctx.editMessageText(notificationsMessage, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(`${ctx.session.selectedNotifications?.includes('morning') ? '✅ ' : ''}🌅 Morning Digest (8 AM)`, 'setup_notification_morning'),
          Markup.button.callback(`${ctx.session.selectedNotifications?.includes('evening') ? '✅ ' : ''}🌇 Evening Digest (6 PM)`, 'setup_notification_evening')
        ],
        [Markup.button.callback('🎉 Finish Setup', 'finish_setup')]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error saving times:', error)
    await ctx.editMessageText('❌ Error saving times. Try /setup again.')
  }
})

// Setup notification handlers
bot.action(/setup_notification_(.+)/, async (ctx) => {
  try {
    const timing = ctx.match[1]
    const labels = {
      'morning': '🌅 Morning Digest (8 AM)',
      'evening': '🌇 Evening Digest (6 PM)'
    }
    
    await ctx.answerCbQuery(`Selected: ${labels[timing] || timing}`)
    
    if (!ctx.session.selectedNotifications) {
      ctx.session.selectedNotifications = []
    }
    
    // Toggle notification timing
    if (ctx.session.selectedNotifications.includes(timing)) {
      ctx.session.selectedNotifications = ctx.session.selectedNotifications.filter(n => n !== timing)
    } else {
      ctx.session.selectedNotifications.push(timing)
    }
    
    // Update UI
    const selectedText = ctx.session.selectedNotifications.length > 0 
      ? `\n\n*Currently selected*: ${ctx.session.selectedNotifications.map(n => labels[n] || n).join(', ')}`
      : ''
    
    const notificationsMessage = `✅ *Times saved: ${ctx.session.selectedTimeWindows?.length > 0 ? ctx.session.selectedTimeWindows.map(tw => tw.description).join(', ') : 'Any time'}*

🔔 *Step 6: Set Up Notifications* (Final Step!)

Get daily surf digests sent to you! Choose when you want to receive your personalized surf reports:

🌅 **Morning Digest (8 AM)**: Perfect for planning your day
- Today's matching sessions
- Tomorrow's upcoming sessions  
- Spot availability updates

🌇 **Evening Digest (6 PM)**: Great for next-day planning
- Tomorrow's matching sessions
- Weekend sessions preview
- Last-minute spot openings

💡 *Pro tip: Get both digests to never miss perfect waves!* 🌊${selectedText}`

    await ctx.editMessageText(notificationsMessage, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(`${ctx.session.selectedNotifications?.includes('morning') ? '✅ ' : ''}🌅 Morning Digest (8 AM)`, 'setup_notification_morning'),
          Markup.button.callback(`${ctx.session.selectedNotifications?.includes('evening') ? '✅ ' : ''}🌇 Evening Digest (6 PM)`, 'setup_notification_evening')
        ],
        [Markup.button.callback('🎉 Finish Setup', 'finish_setup')]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error in setup notification selection:', error)
    await ctx.answerCbQuery('Error. Try again.')
  }
})

bot.action('finish_setup', async (ctx) => {
  try {
    await ctx.answerCbQuery('Finishing setup...')
    
    const selectedNotifications = ctx.session.selectedNotifications?.length > 0 ? ctx.session.selectedNotifications : ['morning']
    
    // Save notifications to database
    const userProfile = await getUserProfile(ctx.from.id)
    if (userProfile) {
      // Delete existing notifications
      await supabase
        .from('user_notifications')
        .delete()
        .eq('user_id', userProfile.id)
      
      // Insert new notifications
      const notificationInserts = selectedNotifications.map(timing => ({
        user_id: userProfile.id,
        timing: timing
      }))
      
      await supabase.from('user_notifications').insert(notificationInserts)
    }
    
    // Clear setup session
    ctx.session.setup = false
    ctx.session.step = null
    
    // Show completion message with summary
    const completionMessage = `🎉 *Setup Complete! You're Ready to Surf!* 🏄‍♂️

*Here's your WavePing profile:*

📊 **Levels**: ${ctx.session.selectedLevels?.join(', ') || 'Not set'}
🏄 **Sides**: ${ctx.session.selectedSides?.join(', ') || 'Any'}
🎯 **Min Spots**: ${ctx.session.selectedMinSpots === 1 ? "I don't care" : `${ctx.session.selectedMinSpots}+ spots`}
📅 **Days**: ${ctx.session.selectedDays?.length > 0 ? ctx.session.selectedDays.map(d => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][d]).join(', ') : 'Any day'}
🕐 **Times**: ${ctx.session.selectedTimeWindows?.length > 0 ? ctx.session.selectedTimeWindows.map(tw => tw.description).join(', ') : 'Any time'}
🔔 **Notifications**: ${selectedNotifications.map(n => ({ 'morning': '🌅 Morning Digest (8 AM)', 'evening': '🌇 Evening Digest (6 PM)' }[n] || n)).join(', ')}

*Ready to ride some waves?* Here's what you can do now:

🌊 */today* - Check today's sessions that match your preferences
🌅 */tomorrow* - See what's coming up tomorrow  
⚙️ */prefs* - Fine-tune your preferences anytime
🧪 */testnotif* - Test your notifications

*Pro tip*: I'll automatically notify you when spots become available for sessions that match your preferences! 🔔

*Let's see what waves are waiting for you...* 🤙`

    await ctx.editMessageText(completionMessage, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('🌊 Check Today\'s Sessions', 'quick_today')],
        [Markup.button.callback('⚙️ Edit Preferences', 'quick_prefs')],
        [Markup.button.callback('🧪 Test Notifications', 'test_notifications_inline')]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error finishing setup:', error)
    await ctx.editMessageText('❌ Error finishing setup. Your preferences may have been partially saved. Try /prefs to check.')
  }
})

bot.action('test_notifications_inline', async (ctx) => {
  try {
    await ctx.answerCbQuery('Sending test notification...')
    
    const testMessage = `🧪 *Test Notification* 🧪

🌊 Hey! This is a test notification from WavePing.

If you're seeing this, your notifications are working perfectly! 🎉

*Next steps:*
• Your setup is complete and notifications are active
• I'll ping you when spots become available for sessions matching your preferences
• Use /today to check what's available right now

*Happy surfing!* 🤙`

    await bot.telegram.sendMessage(ctx.from.id, testMessage, { parse_mode: 'Markdown' })
    
    await ctx.editMessageText('✅ *Test notification sent!* Check your messages above.\n\nYour WavePing setup is complete and ready to go! 🌊', {
      parse_mode: 'Markdown'
    })
    
  } catch (error) {
    console.error('Error sending test notification:', error)
    await ctx.editMessageText('❌ *Setup complete* but test notification failed.\n\nDon\'t worry - your preferences are saved and notifications should still work! Use /testnotif to try again.', {
      parse_mode: 'Markdown'
    })
  }
})

// Quick action handlers for post-onboarding
bot.action('quick_today', async (ctx) => {
  try {
    await ctx.answerCbQuery()
    
    const scraper = new WaveScheduleScraper()
    const sessions = await scraper.getTodaysSessions()
    
    const userProfile = await getUserPreferences(ctx.from.id)
    if (!userProfile) {
      await ctx.editMessageText('❌ Please run /start first to set up your preferences.')
      return
    }
    
    const userLevels = userProfile.user_levels?.map(ul => ul.level) || []
    const userSides = userProfile.user_sides?.map(us => us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any') || []
    const userTimeWindows = userProfile.user_time_windows || []
    
    const filtered = scraper.filterSessionsForUser(sessions, userLevels, userSides, [], true, userTimeWindows)
    
    let message = '🌊 *Today\'s Sessions*\n\n'
    
    if (filtered.length === 0) {
      message += '😔 No sessions match your preferences today.\n\n'
      message += 'Try:\n'
      message += '• /tomorrow - Check tomorrow\'s sessions\n'
      message += '• /prefs - Adjust your preferences\n'
      message += '• /today all - See all sessions'
    } else {
      message += `Found ${filtered.length} session${filtered.length === 1 ? '' : 's'} for you! 🏄‍♂️\n\n`
      
      filtered.slice(0, 8).forEach((session) => {
        const spots = session.spots_available || session.spots || 0
        const spotsText = spots > 0 ? `${spots} spot${spots === 1 ? '' : 's'}` : 'Full'
        
        message += `📊 ${session.time} - ${session.session_name}\n`
        message += `   🏄 ${capitalizeLevel(session.level)} • ${session.side} • 🎯 ${spotsText}\n\n`
      })
      
      if (filtered.length > 8) {
        message += `... and ${filtered.length - 8} more! Use /today for the full list.\n\n`
      }
      
      message += '🎯 Want to book? Visit [The Wave Ticketing](https://ticketing.thewave.com/)'
    }
    
    const backButtons = [
      [Markup.button.callback('🔙 Back to Setup', 'start_setup')],
      [Markup.button.callback('⚙️ Edit Preferences', 'quick_prefs')]
    ]
    
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard(backButtons).reply_markup
    })
    
  } catch (error) {
    console.error('Error in quick_today:', error)
    await ctx.editMessageText('❌ Sorry, there was an error getting today\'s sessions. Try /today')
  }
})

bot.action('quick_prefs', async (ctx) => {
  try {
    await ctx.answerCbQuery()
    
    const userPrefs = await getUserPreferences(ctx.from.id)
    if (!userPrefs) {
      await ctx.editMessageText('❌ Please run /start first to set up your preferences.')
      return
    }
    
    const prefsMessage = formatPreferencesMessage(userPrefs)
    
    const prefButtons = [
      [
        Markup.button.callback('📊 Edit Levels', 'edit_levels'),
        Markup.button.callback('🏄 Edit Sides', 'edit_sides')
      ],
      [
        Markup.button.callback('📅 Edit Days', 'edit_days'),
        Markup.button.callback('🕐 Edit Times', 'edit_times')
      ],
      [
        Markup.button.callback('🔔 Edit Notifications', 'edit_notifications'),
        Markup.button.callback('📬 Edit Digests', 'edit_digests')
      ],
      [
        Markup.button.callback('🔙 Back to Welcome', 'start_setup')
      ]
    ]
    
    await ctx.editMessageText(`${prefsMessage}\n\n*What would you like to change?*`, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard(prefButtons).reply_markup
    })
    
  } catch (error) {
    console.error('Error in quick_prefs:', error)
    await ctx.editMessageText('❌ Sorry, there was an error loading preferences. Try /prefs')
  }
})

bot.action('quick_notifications', async (ctx) => {
  try {
    await ctx.answerCbQuery()
    
    // Redirect to the full notification setup
    const userProfile = await getOrCreateUserProfile(ctx.from.id, ctx.from.username)
    
    // Get current notification preferences
    const { data: userNotifications } = await supabase
      .from('user_notifications')
      .select('timing')
      .eq('user_id', userProfile.id)
    
    const currentNotifications = userNotifications?.map(un => un.timing) || []
    
    // Helper function to check if notification timing exists
    const hasNotification = (timing) => currentNotifications.includes(timing)
    
    let message = '🔔 *Notification Preferences*\n\n'
    message += 'Choose how far in advance you want to know about sessions that match your preferences:\n\n'
    
    if (currentNotifications.length > 0) {
      message += '✅ *Currently enabled:*\n'
      currentNotifications.forEach(timing => {
        const labels = {
          '1w': '1 week before',
          '48h': '48 hours before', 
          '24h': '24 hours before',
          '12h': '12 hours before',
          '2h': '2 hours before'
        }
        message += `   • ${labels[timing]}\n`
      })
      message += '\n'
    }
    
    const notificationButtons = [
      [
        Markup.button.callback(`${hasNotification('1w') ? '✅ ' : ''}1 week before`, 'notification_1w'),
        Markup.button.callback(`${hasNotification('48h') ? '✅ ' : ''}48h before`, 'notification_48h')
      ],
      [
        Markup.button.callback(`${hasNotification('24h') ? '✅ ' : ''}24h before`, 'notification_24h'),
        Markup.button.callback(`${hasNotification('12h') ? '✅ ' : ''}12h before`, 'notification_12h')
      ],
      [
        Markup.button.callback(`${hasNotification('2h') ? '✅ ' : ''}2h before`, 'notification_2h')
      ],
      [
        Markup.button.callback('✅ Done', 'notifications_done'),
        Markup.button.callback('🔙 Back', 'start_setup')
      ]
    ]
    
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard(notificationButtons).reply_markup
    })
    
  } catch (error) {
    console.error('Error in quick_notifications:', error)
    await ctx.editMessageText('❌ Sorry, there was an error setting up notifications. Try /notifications')
  }
})

// Webhook endpoint
app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body, res)
})

// Edit digest preferences handler
bot.action('edit_digests', async (ctx) => {
  try {
    await ctx.answerCbQuery('Loading digest settings...')
    
    const userProfile = await getUserProfile(ctx.from.id)
    if (!userProfile) {
      return ctx.editMessageText('⚠️ Please run /setup first!')
    }
    
    // Get current digest preferences
    const { data: currentDigests } = await supabase
      .from('user_digest_preferences')
      .select('digest_type')
      .eq('user_id', userProfile.id)
    
    const currentTypes = currentDigests?.map(d => d.digest_type) || []
    const selectedText = currentTypes.length > 0 
      ? `\n\n*Currently enabled*: ${currentTypes.map(t => t === 'morning' ? '🌅 Morning' : '🌇 Evening').join(', ')}`
      : '\n\n*No digests enabled*'
    
    await ctx.editMessageText(`📬 *Edit Digest Settings*\n\nChoose when you want to receive daily surf digests:${selectedText}`, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`${currentTypes.includes('morning') ? '✅ ' : ''}🌅 Morning Digest (8 AM)`, 'digest_morning')],
        [Markup.button.callback(`${currentTypes.includes('evening') ? '✅ ' : ''}🌇 Evening Digest (6 PM)`, 'digest_evening')],
        [Markup.button.callback('✅ Done', 'digests_done')]
      ]).reply_markup
    })
  } catch (error) {
    console.error('Error in edit_digests:', error)
    await ctx.answerCbQuery('Error loading digest settings.')
  }
})

// Digest toggle handlers
bot.action('digest_morning', async (ctx) => {
  try {
    const userProfile = await getUserProfile(ctx.from.id)
    if (!userProfile) return
    
    // Check if morning digest exists
    const { data: existing } = await supabase
      .from('user_digest_preferences')
      .select('*')
      .eq('user_id', userProfile.id)
      .eq('digest_type', 'morning')
      .single()
    
    if (existing) {
      // Remove morning digest
      await supabase
        .from('user_digest_preferences')
        .delete()
        .eq('user_id', userProfile.id)
        .eq('digest_type', 'morning')
      
      await ctx.answerCbQuery('Morning digest disabled')
    } else {
      // Add morning digest
      await supabase
        .from('user_digest_preferences')
        .insert({
          user_id: userProfile.id,
          digest_type: 'morning'
        })
      
      await ctx.answerCbQuery('Morning digest enabled')
    }
    
    // Update UI
    const { data: currentDigests } = await supabase
      .from('user_digest_preferences')
      .select('digest_type')
      .eq('user_id', userProfile.id)
    
    const currentTypes = currentDigests?.map(d => d.digest_type) || []
    const selectedText = currentTypes.length > 0 
      ? `\n\n*Currently enabled*: ${currentTypes.map(t => t === 'morning' ? '🌅 Morning' : '🌇 Evening').join(', ')}`
      : '\n\n*No digests enabled*'
    
    await ctx.editMessageText(`📬 *Edit Digest Settings*\n\nChoose when you want to receive daily surf digests:${selectedText}`, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`${currentTypes.includes('morning') ? '✅ ' : ''}🌅 Morning Digest (8 AM)`, 'digest_morning')],
        [Markup.button.callback(`${currentTypes.includes('evening') ? '✅ ' : ''}🌇 Evening Digest (6 PM)`, 'digest_evening')],
        [Markup.button.callback('✅ Done', 'digests_done')]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error toggling morning digest:', error)
    await ctx.answerCbQuery('Error updating setting.')
  }
})

bot.action('digest_evening', async (ctx) => {
  try {
    const userProfile = await getUserProfile(ctx.from.id)
    if (!userProfile) return
    
    // Check if evening digest exists
    const { data: existing } = await supabase
      .from('user_digest_preferences')
      .select('*')
      .eq('user_id', userProfile.id)
      .eq('digest_type', 'evening')
      .single()
    
    if (existing) {
      // Remove evening digest
      await supabase
        .from('user_digest_preferences')
        .delete()
        .eq('user_id', userProfile.id)
        .eq('digest_type', 'evening')
      
      await ctx.answerCbQuery('Evening digest disabled')
    } else {
      // Add evening digest
      await supabase
        .from('user_digest_preferences')
        .insert({
          user_id: userProfile.id,
          digest_type: 'evening'
        })
      
      await ctx.answerCbQuery('Evening digest enabled')
    }
    
    // Update UI
    const { data: currentDigests } = await supabase
      .from('user_digest_preferences')
      .select('digest_type')
      .eq('user_id', userProfile.id)
    
    const currentTypes = currentDigests?.map(d => d.digest_type) || []
    const selectedText = currentTypes.length > 0 
      ? `\n\n*Currently enabled*: ${currentTypes.map(t => t === 'morning' ? '🌅 Morning' : '🌇 Evening').join(', ')}`
      : '\n\n*No digests enabled*'
    
    await ctx.editMessageText(`📬 *Edit Digest Settings*\n\nChoose when you want to receive daily surf digests:${selectedText}`, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`${currentTypes.includes('morning') ? '✅ ' : ''}🌅 Morning Digest (8 AM)`, 'digest_morning')],
        [Markup.button.callback(`${currentTypes.includes('evening') ? '✅ ' : ''}🌇 Evening Digest (6 PM)`, 'digest_evening')],
        [Markup.button.callback('✅ Done', 'digests_done')]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error toggling evening digest:', error)
    await ctx.answerCbQuery('Error updating setting.')
  }
})

bot.action('digests_done', async (ctx) => {
  try {
    await ctx.answerCbQuery('✅ Digest settings saved!')
    
    // Get updated digest preferences for confirmation
    const userProfile = await getUserProfile(ctx.from.id)
    const { data: digestPrefs } = await supabase
      .from('user_digest_preferences')
      .select('digest_type')
      .eq('user_id', userProfile.id)
    
    const enabledDigests = digestPrefs?.map(d => d.digest_type) || []
    
    let confirmationMsg = '✅ *Digest Settings Saved!*\n\n'
    
    if (enabledDigests.length > 0) {
      confirmationMsg += '📬 *Your active digests:*\n'
      enabledDigests.forEach(type => {
        const emoji = type === 'morning' ? '🌅' : '🌇'
        const time = type === 'morning' ? '8:00 AM' : '6:00 PM'
        const title = type === 'morning' ? 'Morning' : 'Evening'
        confirmationMsg += `${emoji} ${title} Digest (${time})\n`
      })
    } else {
      confirmationMsg += '📭 *No digests enabled*\n\nYou won\'t receive daily surf reports, but you can still use commands like /today and /tomorrow.'
    }
    
    confirmationMsg += '\n💡 *You can always change these settings using /prefs*'
    
    await ctx.editMessageText(confirmationMsg, { parse_mode: 'Markdown' })
    
  } catch (error) {
    console.error('Error in digests_done:', error)
    await ctx.editMessageText('✅ Digest settings saved! Use /prefs to view.')
  }
})

// Start server
const PORT = process.env.PORT || 3000
const HOST = '0.0.0.0'
const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT}`)
  
  if (process.env.NODE_ENV === 'production') {
    // Set webhook in production
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL || `https://waveping-production.up.railway.app/webhook`
    bot.telegram.setWebhook(webhookUrl)
      .then(() => console.log(`📱 Webhook set to: ${webhookUrl}`))
      .catch(err => console.error('❌ Failed to set webhook:', err))
  } else {
    // Use polling in development
    bot.launch()
    console.log('🤖 Bot started with polling')
  }
})

// Graceful shutdown
process.once('SIGINT', () => {
  if (process.env.NODE_ENV !== 'production') {
    bot.stop('SIGINT')
  }
  server.close()
  process.exit(0)
})
process.once('SIGTERM', () => {
  if (process.env.NODE_ENV !== 'production') {
    bot.stop('SIGTERM')
  }
  server.close()
  process.exit(0)
})