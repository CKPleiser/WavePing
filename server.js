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
📊 Level: ${session.level}
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
  try {
    const telegramId = ctx.from.id
    
    // Rate limiting
    if (!checkRateLimit(`today:${telegramId}`)) {
      return ctx.reply('⏱ Please wait a moment before requesting again...')
    }
    
    // Send loading message
    const loadingMsg = await ctx.reply('🌊 Loading today\'s Wave sessions...')
    
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
    
    // Get today's sessions from database (no scraping on-demand)
    const todayStr = today()
    const currentTime = new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Europe/London' }).slice(0, 5) // HH:MM format
    const { data: allSessions, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('date', todayStr)
      .eq('is_active', true)
      .gte('start_time', currentTime) // Only future sessions
      .order('start_time')
    
    if (sessionError) {
      console.error('Database error:', sessionError)
      return ctx.telegram.editMessageText(
        ctx.chat.id, 
        loadingMsg.message_id, 
        undefined,
        `❌ *Database error*\n\nPlease try again later.`, 
        { parse_mode: 'Markdown' }
      )
    }
    
    // Convert database format to scraper format for compatibility
    const sessionsFormatted = (allSessions || []).map(session => ({
      session_name: session.session_name,
      level: session.level,
      side: session.side === 'L' ? 'Left' : session.side === 'R' ? 'Right' : 'Any',
      time: session.start_time,
      time24: session.start_time,
      spots_available: session.spots_available,
      booking_url: session.book_url
    }))
    
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
    const scraper = new WaveScheduleScraper()
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
        
        const availableLevels = sessionsFormatted.map(s => s.level).filter((v, i, a) => a.indexOf(v) === i)
        const availableTimes = sessionsFormatted.map(s => s.time24).filter((v, i, a) => a.indexOf(v) === i).sort()
        
        noSessionsMsg += `\n💡 *Available today:*\n`
        if (availableLevels.length > 0) noSessionsMsg += `📊 Levels: ${availableLevels.join(', ')}\n`
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
    ctx.reply('❌ Error loading sessions. Try again later.')
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
    
    // Get tomorrow's sessions from database (no scraping on-demand)
    const tomorrowStr = tomorrow()
    const { data: allSessions, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('date', tomorrowStr)
      .eq('is_active', true)
      .order('start_time')
    
    if (sessionError) {
      console.error('Database error:', sessionError)
      return ctx.telegram.editMessageText(
        ctx.chat.id, 
        loadingMsg.message_id, 
        undefined,
        `❌ *Database error*\n\nPlease try again later.`, 
        { parse_mode: 'Markdown' }
      )
    }
    
    // Convert database format to scraper format for compatibility
    const sessionsFormatted = (allSessions || []).map(session => ({
      session_name: session.session_name,
      level: session.level,
      side: session.side === 'L' ? 'Left' : session.side === 'R' ? 'Right' : 'Any',
      time: session.start_time,
      time24: session.start_time,
      spots_available: session.spots_available,
      booking_url: session.book_url
    }))
    
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
    const scraper = new WaveScheduleScraper()
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
        if (availableLevels.length > 0) noSessionsMsg += `📊 Levels: ${availableLevels.join(', ')}\n`
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
    ctx.reply('❌ Error loading sessions. Try again later.')
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
    
    await ctx.editMessageText(`⚙️ *Edit Session Levels*\n\nClick levels to toggle them:${selectedText}`, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`${currentLevels.includes('beginner') ? '✅ ' : ''}🟢 Beginner`, 'level_beginner')],
        [Markup.button.callback(`${currentLevels.includes('improver') ? '✅ ' : ''}🔵 Improver`, 'level_improver')],
        [Markup.button.callback(`${currentLevels.includes('intermediate') ? '✅ ' : ''}🟡 Intermediate`, 'level_intermediate')],
        [Markup.button.callback(`${currentLevels.includes('advanced') ? '✅ ' : ''}🟠 Advanced`, 'level_advanced')],
        [Markup.button.callback(`${currentLevels.includes('expert') ? '✅ ' : ''}🔴 Expert`, 'level_expert')],
        [Markup.button.callback('✅ Done', 'levels_done')]
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
        confirmationMsg += `${emoji} ${level.charAt(0).toUpperCase() + level.slice(1)}\n`
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
  await ctx.answerCbQuery()
  
  // Get current time preferences
  const preferences = await getUserPreferences(ctx.from.id)
  const currentTimes = preferences?.user_time_windows || []
  
  let message = '🕐 *Time Preferences*\n\n'
  message += 'Select your preferred time windows for surf sessions:\n\n'
  
  if (currentTimes.length > 0) {
    message += '✅ *Current preferences:*\n'
    currentTimes.forEach((tw, i) => {
      message += `   ${tw.start_time} - ${tw.end_time}\n`
    })
    message += '\n'
  }
  
  const timeButtons = [
    [
      Markup.button.callback('🌅 Early (7-10am)', 'time_early'),
      Markup.button.callback('🌞 Morning (10am-1pm)', 'time_morning')
    ],
    [
      Markup.button.callback('☀️ Afternoon (1-5pm)', 'time_afternoon'),
      Markup.button.callback('🌇 Evening (5-8pm)', 'time_evening')
    ],
    [
      Markup.button.callback('🌙 Late (8-11pm)', 'time_late'),
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
})

// Time preference handlers
bot.action('time_early', async (ctx) => {
  await saveTimeWindow(ctx, '07:00', '10:00', '🌅 Early (7-10am)')
})

bot.action('time_morning', async (ctx) => {
  await saveTimeWindow(ctx, '10:00', '13:00', '🌞 Morning (10am-1pm)')
})

bot.action('time_afternoon', async (ctx) => {
  await saveTimeWindow(ctx, '13:00', '17:00', '☀️ Afternoon (1-5pm)')
})

bot.action('time_evening', async (ctx) => {
  await saveTimeWindow(ctx, '17:00', '20:00', '🌇 Evening (5-8pm)')
})

bot.action('time_late', async (ctx) => {
  await saveTimeWindow(ctx, '20:00', '23:00', '🌙 Late (8-11pm)')
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

// Done with notifications
bot.action('notifications_done', async (ctx) => {
  await ctx.answerCbQuery('✅ Notifications saved!')
  await ctx.editMessageText('✅ *Notifications Saved!*\n\nYou\'ll receive alerts for sessions matching your preferences.\n\nUse /prefs to see all your preferences.', { parse_mode: 'Markdown' })
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
    
    await ctx.editMessageText(`✅ *Levels saved!*\n\nYour selected levels: ${ctx.session.selectedLevels.join(', ')}\n\nUse /prefs to continue setting up other preferences.`)
    
    // Clear session
    ctx.session.selectedLevels = []
    
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

async function saveTimeWindow(ctx, startTime, endTime, description) {
  await ctx.answerCbQuery(`Adding ${description}...`)
  
  try {
    // Get or create user
    const { data: user } = await supabase
      .from('profiles')
      .select('id')
      .eq('telegram_id', ctx.from.id)
      .single()
    
    if (!user) {
      return ctx.editMessageText('❌ User not found. Please use /setup first.')
    }
    
    // Check if this time window already exists
    const { data: existing } = await supabase
      .from('user_time_windows')
      .select('*')
      .eq('user_id', user.id)
      .eq('start_time', startTime)
      .eq('end_time', endTime)
      .single()
    
    if (existing) {
      return ctx.editMessageText(`⚠️ ${description} is already in your preferences!`, { parse_mode: 'Markdown' })
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
    
    await ctx.editMessageText(`✅ *${description} added!*\n\nTime window: ${startTime} - ${endTime}\n\nUse /prefs to see all your preferences.`, { parse_mode: 'Markdown' })
    
  } catch (error) {
    console.error('Error saving time window:', error)
    await ctx.editMessageText('❌ Error saving time preference. Try again later.')
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

// Webhook endpoint
app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body, res)
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