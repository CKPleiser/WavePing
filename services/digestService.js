const { WaveScheduleScraper } = require('../lib/wave-scraper-final.js')

class DigestService {
  constructor(supabase, bot) {
    this.supabase = supabase
    this.bot = bot
    this.scraper = new WaveScheduleScraper()
  }

  /**
   * Get users for a specific digest type
   */
  async getDigestUsers(digestType) {
    // Get all users with notifications enabled who have the specific digest preference
    const { data: profiles, error: profilesError } = await this.supabase
      .from('profiles')
      .select(`
        id, 
        telegram_id,
        min_spots,
        user_levels (level),
        user_sides (side),
        user_days (day_of_week),
        user_time_windows (start_time, end_time),
        user_digest_preferences (digest_type)
      `)
      .eq('notification_enabled', true)
    
    if (profilesError) throw profilesError

    // Filter profiles to only those who want this specific digest type
    return profiles?.filter(user => {
      // Check if user has this digest type in their preferences
      const hasDigestPreference = user.user_digest_preferences?.some(
        pref => pref.digest_type === digestType
      )
      return hasDigestPreference
    }) || []
  }

  /**
   * Filter sessions based on user preferences
   */
  filterSessionsForUser(sessions, user) {
    const userLevels = user.user_levels?.map(ul => ul.level) || []
    const userSides = user.user_sides?.map(us => us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any') || []
    const userDays = user.user_days?.map(ud => ud.day_of_week) || []
    const userTimeWindows = user.user_time_windows || []
    
    return this.scraper.filterSessionsForUser(
      sessions, 
      userLevels, 
      userSides, 
      userDays, 
      true, 
      userTimeWindows
    ).filter(s => {
      const availableSpots = s.spots_available || 0
      return availableSpots > 0 && availableSpots >= user.min_spots
    })
  }

  /**
   * Format session for message display
   */
  formatSession(session, includeDate = false) {
    const spots = session.spots_available || 0
    const bookingUrl = session.booking_url || 'https://thewave.com/bristol/book/'
    
    let message = ''
    if (includeDate && session.dateLabel) {
      message += `*${session.dateLabel}* `
    }
    message += `*${session.time}* - ${session.session_name}\n`
    message += `${spots} spot${spots === 1 ? '' : 's'} available\n`
    message += `[Book Now](${bookingUrl})\n\n`
    
    return message
  }

  /**
   * Send morning digest to users
   */
  async sendMorningDigest() {
    console.log('🌅 Sending morning digest notifications...')
    
    const users = await this.getDigestUsers('morning')
    console.log(`Found ${users.length} users subscribed to morning digest`)

    // Get today's and tomorrow's sessions
    const todaySessions = await this.scraper.getTodaysSessions().catch(() => [])
    const tomorrowSessions = await this.scraper.getTomorrowsSessions().catch(() => [])
    
    const results = []
    
    for (const user of users) {
      try {
        // Filter sessions for user
        const todayFiltered = this.filterSessionsForUser(todaySessions, user)
        const tomorrowFiltered = this.filterSessionsForUser(tomorrowSessions, user)

        if (todayFiltered.length === 0 && tomorrowFiltered.length === 0) {
          continue // Skip if no matching sessions
        }

        // Create morning digest message
        let message = `🌅 *Good Morning, Wave Rider!* ☀️\n\n`
        
        if (todayFiltered.length > 0) {
          message += `🌊 *TODAY'S SESSIONS* (${todayFiltered.length} match${todayFiltered.length === 1 ? '' : 'es'})\n\n`
          
          todayFiltered.slice(0, 5).forEach(session => {
            message += this.formatSession(session)
          })
          
          if (todayFiltered.length > 5) {
            message += `...and ${todayFiltered.length - 5} more! Use /today for the full list.\n\n`
          }
        }
        
        if (tomorrowFiltered.length > 0) {
          message += `🌅 *TOMORROW'S PREVIEW* (${tomorrowFiltered.length} session${tomorrowFiltered.length === 1 ? '' : 's'})\n\n`
          
          tomorrowFiltered.slice(0, 3).forEach(session => {
            message += this.formatSession(session)
          })
        }

        message += this.getQuickCommands()

        await this.bot.telegram.sendMessage(user.telegram_id, message, { parse_mode: 'Markdown' })
        results.push({ 
          telegramId: user.telegram_id, 
          status: 'sent', 
          sessionsToday: todayFiltered.length, 
          sessionsTomorrow: tomorrowFiltered.length 
        })
        
      } catch (error) {
        console.error(`Failed to send morning digest to ${user.telegram_id}:`, error.message)
        results.push({ telegramId: user.telegram_id, status: 'failed', error: error.message })
      }
    }
    
    const sent = results.filter(r => r.status === 'sent').length
    const failed = results.filter(r => r.status === 'failed').length
    console.log(`Morning digest complete: ${sent} sent, ${failed} failed`)
    
    return { success: true, results }
  }

  /**
   * Send evening digest to users
   */
  async sendEveningDigest() {
    console.log('🌇 Sending evening digest notifications...')
    
    const users = await this.getDigestUsers('evening')
    console.log(`Found ${users.length} users subscribed to evening digest`)

    // Get tomorrow's sessions and next few days for weekend preview
    const tomorrowSessions = await this.scraper.getTomorrowsSessions().catch(() => [])
    const upcomingSessions = await this.scraper.getSessionsInRange(
      3, 
      new Date(Date.now() + 24*60*60*1000)
    ).catch(() => [])
    
    const results = []
    
    for (const user of users) {
      try {
        // Filter sessions for user
        const tomorrowFiltered = this.filterSessionsForUser(tomorrowSessions, user)
        const upcomingFiltered = this.filterSessionsForUser(upcomingSessions, user)

        if (tomorrowFiltered.length === 0 && upcomingFiltered.length === 0) {
          continue // Skip if no matching sessions
        }

        // Create evening digest message  
        let message = `🌇 *Evening Wave Report* 🌊\n\n`
        
        if (tomorrowFiltered.length > 0) {
          message += `🌅 *TOMORROW'S SESSIONS* (${tomorrowFiltered.length} match${tomorrowFiltered.length === 1 ? '' : 'es'})\n\n`
          
          tomorrowFiltered.slice(0, 6).forEach(session => {
            message += this.formatSession(session)
          })
          
          if (tomorrowFiltered.length > 6) {
            message += `...and ${tomorrowFiltered.length - 6} more! Use /tomorrow for the full list.\n\n`
          }
        }
        
        // Weekend preview (if upcoming sessions)
        if (upcomingFiltered.length > tomorrowFiltered.length) {
          const weekendSessions = upcomingFiltered.filter(s => 
            !tomorrowSessions.some(t => t.dateISO === s.dateISO && t.time === s.time)
          )
          
          if (weekendSessions.length > 0) {
            message += `🗓️ *COMING UP* (Next few days)\n\n`
            
            weekendSessions.slice(0, 3).forEach(session => {
              message += this.formatSession(session, true)
            })
          }
        }

        message += this.getEveningCommands()

        await this.bot.telegram.sendMessage(user.telegram_id, message, { parse_mode: 'Markdown' })
        results.push({ 
          telegramId: user.telegram_id, 
          status: 'sent', 
          sessionsTomorrow: tomorrowFiltered.length,
          sessionsUpcoming: upcomingFiltered.length
        })
        
      } catch (error) {
        console.error(`Failed to send evening digest to ${user.telegram_id}:`, error.message)
        results.push({ telegramId: user.telegram_id, status: 'failed', error: error.message })
      }
    }
    
    const sent = results.filter(r => r.status === 'sent').length
    const failed = results.filter(r => r.status === 'failed').length
    console.log(`Evening digest complete: ${sent} sent, ${failed} failed`)
    
    return { success: true, results }
  }

  /**
   * Get quick commands for morning digest
   */
  getQuickCommands() {
    return `💡 *Quick Commands:*\n` +
           `• /today - See all today's sessions\n` +
           `• /tomorrow - Check tomorrow's lineup\n` +
           `• /setup - Update your preferences\n\n` +
           `🌊 Ready to catch some waves? 🤙`
  }

  /**
   * Get quick commands for evening digest
   */
  getEveningCommands() {
    return `💡 *Plan Your Sessions:*\n` +
           `• /tomorrow - Full tomorrow schedule\n` +
           `• /setup - Update preferences\n` +
           `• /notify - Manage notifications\n\n` +
           `🌙 Rest well, wave rider! 🏄‍♂️`
  }
}

module.exports = DigestService