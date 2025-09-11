import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../lib/supabase/client'
import { format } from 'date-fns'
import { nowInLondon, toLondon, formatLondonDate, getTimingDeltas, createNotificationWindow } from '../../../lib/utils/london-time'
import pLimit from 'p-limit'

// Limit concurrent Telegram API calls to avoid rate limits
const telegramLimit = pLimit(10)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    console.log('Checking for notifications to send...')
    
    const supabase = createAdminClient()
    const nowLon = nowInLondon()
    
    // Define notification timing deltas in London timezone
    const timingDeltasLon = getTimingDeltas(nowLon)
    let totalNotificationsSent = 0

    // Process each timing window
    for (const [timing, targetLon] of Object.entries(timingDeltasLon)) {
      const { windowStartLon, windowEndLon } = createNotificationWindow(targetLon, 45) // 45 min window

      // DB stores date as YYYY-MM-DD (no tz). Filter by POSSIBLE days in London time:
      const dayStart = format(windowStartLon, 'yyyy-MM-dd')
      const dayEnd = format(windowEndLon, 'yyyy-MM-dd')

      console.log(`Processing ${timing} notifications. Window: ${windowStartLon.toISOString()} to ${windowEndLon.toISOString()}`)

      // Find sessions that should trigger notifications in this window
      const { data: upcomingSessions } = await supabase
        .from('sessions')
        .select('*')
        .eq('is_active', true)
        .gte('date', dayStart)
        .lte('date', dayEnd)
        // Include sessions with unknown spots (null) as they might become available
        .or('spots_available.gt.0,spots_available.is.null')

      if (!upcomingSessions?.length) {
        continue
      }

      console.log(`Processing ${upcomingSessions.length} potential sessions for ${timing} notifications`)

      for (const session of upcomingSessions) {
        // Build the *London* datetime from local date & start_time
        const sessionLon = toLondon(`${session.date}T${session.start_time}`)
        
        // Check if this session falls within our notification window
        if (sessionLon < windowStartLon || sessionLon > windowEndLon) {
          continue
        }

        // Get matching users for this session
        const { data: matchingUsers } = await supabase
          .rpc('get_matching_users', { session_record: session })

        if (!matchingUsers?.length) {
          continue
        }

        console.log(`Found ${matchingUsers.length} matching users for session ${session.session_name}`)

        // Filter users who have this timing enabled and process with concurrency limit
        const usersWithTiming = matchingUsers.filter((user: any) => 
          user.notification_timings.includes(timing)
        )

        if (!usersWithTiming.length) {
          continue
        }

        // Process notifications with concurrency limiting
        const notificationPromises = usersWithTiming.map((user: any) =>
          telegramLimit(async () => {
            try {
              // Attempt to send notification
              const success = await sendTelegramNotification(user.telegram_id, session, timing)
              
              if (success) {
                // Record as sent with idempotent insert (ignore conflicts)
                try {
                  await supabase.from('notifications_sent').insert({
                    user_id: user.user_id,
                    session_id: session.id,
                    timing,
                    sent_at: new Date().toISOString()
                  })
                  return true
                } catch (insertError: any) {
                  // Ignore unique constraint violations (23505) - already sent
                  if (insertError.code === '23505') {
                    console.log(`Notification already recorded for user ${user.telegram_id}, session ${session.id}, timing ${timing}`)
                    return false
                  }
                  throw insertError
                }
              }
              return false
            } catch (error) {
              console.error(`Failed to process notification for user ${user.telegram_id}:`, error)
              return false
            }
          })
        )

        const results = await Promise.all(notificationPromises)
        const successCount = results.filter(Boolean).length
        totalNotificationsSent += successCount

        console.log(`Sent ${successCount}/${usersWithTiming.length} notifications for session ${session.session_name}`)
      }
    }

    console.log(`Total notifications sent: ${totalNotificationsSent}`)

    res.status(200).json({
      message: 'Notifications processed successfully',
      notifications_sent: totalNotificationsSent,
      processed_at: nowLon.toISOString()
    })

  } catch (error) {
    console.error('Notification sending error:', error)
    res.status(500).json({ 
      error: 'Failed to send notifications',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

/**
 * Send Telegram notification with proper error handling
 * Returns true if sent successfully, false otherwise (doesn't throw)
 */
async function sendTelegramNotification(telegramId: number, session: any, timing: string): Promise<boolean> {
  try {
    const bot_token = process.env.TELEGRAM_BOT_TOKEN!
    
    // Format the notification message
    const timingDisplay = {
      '1w': '1 week',
      '48h': '48 hours', 
      '24h': '24 hours',
      '12h': '12 hours',
      '2h': '2 hours'
    }[timing] || timing

    // Markdown escaping utility
    const md = (s: string) => s.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\\\$1')

    // Get weather data if available
    const supabase = createAdminClient()
    const { data: weather } = await supabase
      .from('weather_cache')
      .select('*')
      .eq('date', session.date)
      .maybeSingle() // Use maybeSingle to avoid errors when no weather data

    let message = `🌊 *Wave Alert - ${md(timingDisplay)} notice*\\n\\n`
    message += `📅 ${md(formatLondonDate(session.date))}\\n`
    message += `🕐 ${md(session.start_time)}`
    
    if (session.end_time) {
      message += ` - ${md(session.end_time)}`
    }
    
    message += `\\n📊 *Level:* ${md(session.session_name)}\\n`
    
    if (session.side && session.side !== 'A') {
      const sideDisplay = session.side === 'L' ? 'Left' : 'Right'
      message += `🏄 *Side:* ${sideDisplay}\\n`
    }
    
    // Handle null spots_available
    const spotsDisplay = session.spots_available !== null 
      ? `${session.spots_available}`
      : 'TBA'
    message += `👥 *Spaces available:* ${spotsDisplay}\\n`

    // Add weather info if available
    if (weather) {
      message += `\\n🌡️ *Conditions:*\\n`
      message += `• Air: ${weather.air_temp}°C | Water: ${weather.water_temp}°C\\n`
      message += `• Wind: ${weather.wind_speed} mph ${weather.wind_direction}\\n`
      message += `• ${md(weather.conditions)}\\n`
    }

    // Add urgency indicators for low availability
    if (session.spots_available !== null && session.spots_available <= 3 && session.spots_available > 0) {
      message += `\\n⚠️ *Filling fast - only ${session.spots_available} spots left!*`
    }

    // Add instructor info if available
    if (session.instructor) {
      message += `\\n👨‍🏫 *Instructor:* ${md(session.instructor)}`
    }

    // Create inline keyboard with actions
    const keyboard = {
      inline_keyboard: [
        [{
          text: '📍 Book Now',
          url: session.book_url || `https://thewave.com/book?utm_source=waveping_bot&utm_medium=telegram&utm_campaign=notification`
        }],
        [
          {
            text: '✅ I\'m going',
            callback_data: `going_${session.id}`
          },
          {
            text: '❌ Skip',
            callback_data: `skip_${session.id}`
          }
        ]
      ]
    }

    // Send via Telegram Bot API
    const telegramUrl = `https://api.telegram.org/bot${bot_token}/sendMessage`
    
    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: telegramId,
        text: message,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      })
    })

    if (!response.ok) {
      const err = await response.json()
      console.error('Telegram API error', { telegramId, err })
      return false
    }

    console.log(`Sent notification to user ${telegramId} for session ${session.session_name}`)
    return true
    
  } catch (error) {
    console.error('Telegram send failed', { telegramId, error })
    return false
  }
}