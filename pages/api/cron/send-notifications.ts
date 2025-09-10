import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../lib/supabase/client'
import { format, addHours, addDays, addWeeks } from 'date-fns'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    console.log('Checking for notifications to send...')
    
    const supabase = createAdminClient()
    const now = new Date()
    
    // Define notification timing deltas
    const timingDeltas = {
      '1w': addWeeks(now, 1),
      '48h': addHours(now, 48),
      '24h': addHours(now, 24),
      '12h': addHours(now, 12),
      '2h': addHours(now, 2)
    }

    let totalNotificationsSent = 0

    // Process each timing window
    for (const [timing, targetTime] of Object.entries(timingDeltas)) {
      const windowStart = new Date(targetTime.getTime() - 15 * 60 * 1000) // 15 minutes before
      const windowEnd = new Date(targetTime.getTime() + 15 * 60 * 1000)   // 15 minutes after

      // Find sessions that should trigger notifications in this window
      const { data: upcomingSessions } = await supabase
        .from('sessions')
        .select('*')
        .eq('is_active', true)
        .gte('date', format(windowStart, 'yyyy-MM-dd'))
        .lte('date', format(windowEnd, 'yyyy-MM-dd'))
        .gt('spots_available', 0)

      if (!upcomingSessions?.length) {
        continue
      }

      console.log(`Processing ${upcomingSessions.length} sessions for ${timing} notifications`)

      for (const session of upcomingSessions) {
        const sessionDateTime = new Date(`${session.date}T${session.start_time}`)
        
        // Check if this session falls within our notification window
        if (sessionDateTime < windowStart || sessionDateTime > windowEnd) {
          continue
        }

        // Get matching users for this session
        const { data: matchingUsers } = await supabase
          .rpc('get_matching_users', { session_record: session })

        if (!matchingUsers?.length) {
          continue
        }

        console.log(`Found ${matchingUsers.length} matching users for session ${session.session_name}`)

        for (const user of matchingUsers) {
          // Check if user has this timing enabled
          if (!user.notification_timings.includes(timing)) {
            continue
          }

          // Check if we've already sent this notification
          const { data: alreadySent } = await supabase
            .from('notifications_sent')
            .select('id')
            .eq('user_id', user.user_id)
            .eq('session_id', session.id)
            .eq('timing', timing)
            .single()

          if (alreadySent) {
            continue // Already sent
          }

          // Send the notification
          await sendTelegramNotification(user.telegram_id, session, timing)

          // Record that we sent it
          await supabase.from('notifications_sent').insert({
            user_id: user.user_id,
            session_id: session.id,
            timing,
            sent_at: new Date().toISOString()
          })

          totalNotificationsSent++
        }
      }
    }

    console.log(`Sent ${totalNotificationsSent} notifications`)

    res.status(200).json({
      message: 'Notifications processed successfully',
      notifications_sent: totalNotificationsSent
    })

  } catch (error) {
    console.error('Notification sending error:', error)
    res.status(500).json({ 
      error: 'Failed to send notifications',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

async function sendTelegramNotification(telegramId: number, session: any, timing: string) {
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

    // Get weather data if available
    const supabase = createAdminClient()
    const { data: weather } = await supabase
      .from('weather_cache')
      .select('*')
      .eq('date', session.date)
      .single()

    let message = `🌊 *Wave Alert - ${timingDisplay} notice*\n\n`
    message += `📅 ${format(new Date(session.date), 'EEEE, MMMM do')}\n`
    message += `🕐 ${session.start_time}`
    
    if (session.end_time) {
      message += ` - ${session.end_time}`
    }
    
    message += `\n📊 *Level:* ${session.session_name}\n`
    
    if (session.side && session.side !== 'A') {
      const sideDisplay = session.side === 'L' ? 'Left' : 'Right'
      message += `🏄 *Side:* ${sideDisplay}\n`
    }
    
    message += `👥 *Spaces available:* ${session.spots_available}\n`

    // Add weather info if available
    if (weather) {
      message += `\n🌡️ *Conditions:*\n`
      message += `• Air: ${weather.air_temp}°C | Water: ${weather.water_temp}°C\n`
      message += `• Wind: ${weather.wind_speed} mph ${weather.wind_direction}\n`
      message += `• ${weather.conditions}\n`
    }

    // Add urgency indicators
    if (session.spots_available <= 3) {
      message += `\n⚠️ *Filling fast - only ${session.spots_available} spots left!*`
    }

    // Add instructor info if available
    if (session.instructor) {
      message += `\n👨‍🏫 *Instructor:* ${session.instructor}`
    }

    // Create inline keyboard with actions
    const keyboard = {
      inline_keyboard: [
        [{
          text: '📍 Book Now',
          url: session.book_url || `https://thewave.com/book`
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
      const errorData = await response.json()
      throw new Error(`Telegram API error: ${JSON.stringify(errorData)}`)
    }

    console.log(`Sent notification to user ${telegramId} for session ${session.session_name}`)
    
  } catch (error) {
    console.error(`Failed to send notification to ${telegramId}:`, error)
    throw error
  }
}