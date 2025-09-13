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
        user_digest_preferences (digest_type),
        user_digest_filters (timing)
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
   * Format session for message display - now without individual booking links
   */
  formatSession(session, includeDate = false) {
    const spots = session.spots_available || 0
    const sideChip = session.side === 'Left' ? '[L]' : session.side === 'Right' ? '[R]' : '[Any]'
    
    let message = ''
    if (includeDate && session.dateLabel) {
      message += `**${session.dateLabel}** `
    }
    message += `**${session.time}** ${session.session_name} ${sideChip}\n`
    message += `${spots} spot${spots === 1 ? '' : 's'} available\n\n`
    
    return message
  }

  /**
   * Get sessions for user's notification timing preference
   */
  async getSessionsForTimingPreference(user) {
    // Get user's notification timing preferences
    const userTimings = user.user_digest_filters?.map(n => n.timing) || []
    
    let days = 1 // Default to 1 day
    
    // Determine how many days to fetch based on user's timing preferences
    if (userTimings.includes('1w')) {
      days = 7 // 1 week
    } else if (userTimings.includes('48h')) {
      days = 2 // 48 hours
    } else if (userTimings.includes('24h')) {
      days = 1 // 24 hours  
    } else if (userTimings.includes('12h')) {
      days = 1 // 12 hours (same day)
    } else if (userTimings.includes('2h')) {
      days = 1 // 2 hours (same day)
    }
    
    // Get sessions for the determined timeframe
    return await this.scraper.getSessionsInRange(days).catch(() => [])
  }

  /**
   * Send morning digest to users
   */
  async sendMorningDigest() {
    console.log('🌅 Sending morning digest notifications...')
    
    const users = await this.getDigestUsers('morning')
    console.log(`Found ${users.length} users subscribed to morning digest`)
    
    const results = []
    
    for (const user of users) {
      try {
        // Get sessions based on user's timing preference
        const sessions = await this.getSessionsForTimingPreference(user)
        const filteredSessions = this.filterSessionsForUser(sessions, user)

        if (filteredSessions.length === 0) {
          continue // Skip if no matching sessions
        }

        // Determine timeframe label
        const userTimings = user.user_digest_filters?.map(n => n.timing) || []
        let timeframeLabel = 'Today'
        if (userTimings.includes('1w')) {
          timeframeLabel = 'Next 7 Days'
        } else if (userTimings.includes('48h')) {
          timeframeLabel = 'Next 2 Days'
        }

        // Create morning digest message
        let message = `🌅 **Good Morning, Wave Rider!** ☀️\n\n`
        message += `🌊 **${timeframeLabel.toUpperCase()}** (${filteredSessions.length} match${filteredSessions.length === 1 ? '' : 'es'})\n\n`
        
        // Show up to 10 sessions, grouped by date if multiple days
        const sessionsToShow = filteredSessions.slice(0, 10)
        let currentDate = ''
        
        sessionsToShow.forEach((session, index) => {
          // Add date header for multi-day views
          if (timeframeLabel !== 'Today' && session.dateLabel && session.dateLabel !== currentDate) {
            if (index > 0) message += '\n'
            message += `**${session.dateLabel}**\n`
            currentDate = session.dateLabel
          }
          message += this.formatSession(session, false)
        })
        
        if (filteredSessions.length > 10) {
          message += `...and ${filteredSessions.length - 10} more sessions!\n\n`
        }
        
        // Single booking link
        message += `[🏄‍♂️ **Book at The Wave**](https://ticketing.thewave.com/)\n\n`
        
        // Support link
        message += `[☕ **Support WavePing**](https://buymeacoffee.com/driftwithcaz)\n\n`
        
        message += this.getQuickCommands()

        await this.bot.telegram.sendMessage(user.telegram_id, message, { parse_mode: 'Markdown' })
        results.push({ 
          telegramId: user.telegram_id, 
          status: 'sent', 
          sessionsFound: filteredSessions.length,
          timeframe: timeframeLabel
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
    
    const results = []
    
    for (const user of users) {
      try {
        // Get sessions based on user's timing preference
        const sessions = await this.getSessionsForTimingPreference(user)
        const filteredSessions = this.filterSessionsForUser(sessions, user)

        if (filteredSessions.length === 0) {
          continue // Skip if no matching sessions
        }

        // Determine timeframe label
        const userTimings = user.user_digest_filters?.map(n => n.timing) || []
        let timeframeLabel = 'Tomorrow'
        if (userTimings.includes('1w')) {
          timeframeLabel = 'Next 7 Days'
        } else if (userTimings.includes('48h')) {
          timeframeLabel = 'Next 2 Days'
        }

        // Create evening digest message
        let message = `🌇 **Evening Wave Report** 🌊\n\n`
        message += `🌅 **${timeframeLabel.toUpperCase()}** (${filteredSessions.length} match${filteredSessions.length === 1 ? '' : 'es'})\n\n`
        
        // Show up to 12 sessions for evening digest, grouped by date if multiple days
        const sessionsToShow = filteredSessions.slice(0, 12)
        let currentDate = ''
        
        sessionsToShow.forEach((session, index) => {
          // Add date header for multi-day views
          if (timeframeLabel !== 'Tomorrow' && session.dateLabel && session.dateLabel !== currentDate) {
            if (index > 0) message += '\n'
            message += `**${session.dateLabel}**\n`
            currentDate = session.dateLabel
          }
          message += this.formatSession(session, false)
        })
        
        if (filteredSessions.length > 12) {
          message += `...and ${filteredSessions.length - 12} more sessions!\n\n`
        }
        
        // Single booking link
        message += `[🏄‍♂️ **Book at The Wave**](https://ticketing.thewave.com/)\n\n`
        
        // Support link
        message += `[☕ **Support WavePing**](https://buymeacoffee.com/driftwithcaz)\n\n`
        
        message += this.getEveningCommands()

        await this.bot.telegram.sendMessage(user.telegram_id, message, { parse_mode: 'Markdown' })
        results.push({ 
          telegramId: user.telegram_id, 
          status: 'sent', 
          sessionsFound: filteredSessions.length,
          timeframe: timeframeLabel
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
           `• /setup - Update preferences\n\n` +
           `🌙 Rest well, wave rider! 🏄‍♂️`
  }
}

module.exports = DigestService