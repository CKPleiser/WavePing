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
      message += `<b>${session.dateLabel}</b> `
    }
    message += `<b>${session.time}</b> ${session.session_name} ${sideChip}\n`
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
   * Format digest message with pagination support
   */
  formatDigestMessage(sessions, page, sessionsPerPage, digestType, timeframeLabel) {
    const totalPages = Math.ceil(sessions.length / sessionsPerPage)
    const startIdx = (page - 1) * sessionsPerPage
    const endIdx = Math.min(startIdx + sessionsPerPage, sessions.length)
    const sessionsToShow = sessions.slice(startIdx, endIdx)
    
    let message = ''
    
    // Header based on digest type
    if (digestType === 'morning') {
      message = `🌅 **Good Morning, Wave Rider!** ☀️\n\n`
    } else {
      message = `🌇 **Evening Wave Report** 🌊\n\n`
    }
    
    // Session count and page info
    message += `🌊 **${timeframeLabel.toUpperCase()}** (${sessions.length} match${sessions.length === 1 ? '' : 'es'})`
    if (totalPages > 1) {
      message += ` - Page ${page}/${totalPages}`
    }
    message += `\n\n`
    
    // Display sessions for current page
    let currentDate = ''
    sessionsToShow.forEach((session, index) => {
      // Add date header for multi-day views
      if (timeframeLabel !== 'Today' && timeframeLabel !== 'Tomorrow' && session.dateLabel && session.dateLabel !== currentDate) {
        if (index > 0) message += '\n'
        message += `<b>${session.dateLabel}</b>\n`
        currentDate = session.dateLabel
      }
      message += this.formatSession(session, false)
    })
    
    // Links
    message += `[🏄‍♂️ <b>Book at The Wave</b>](https://ticketing.thewave.com/)\n\n`
    message += `[☕ <b>Support WavePing</b>](https://buymeacoffee.com/driftwithcaz)\n\n`
    
    // Commands
    if (digestType === 'morning') {
      message += this.getQuickCommands()
    } else {
      message += this.getEveningCommands()
    }
    
    return message
  }

  /**
   * Create pagination keyboard for digest messages
   */
  createDigestPaginationKeyboard(currentPage, totalPages, digestType, timeframe) {
    const { Markup } = require('telegraf')
    const buttons = []
    
    // Pagination row if needed
    if (totalPages > 1) {
      const paginationRow = []
      
      if (currentPage > 1) {
        paginationRow.push(
          Markup.button.callback('⬅️ Previous', `digest_page_${currentPage - 1}_${digestType}_${timeframe}`)
        )
      }
      
      // Page indicator (non-clickable)
      paginationRow.push(
        Markup.button.callback(`📄 ${currentPage}/${totalPages}`, 'noop')
      )
      
      if (currentPage < totalPages) {
        paginationRow.push(
          Markup.button.callback('➡️ Next', `digest_page_${currentPage + 1}_${digestType}_${timeframe}`)
        )
      }
      
      buttons.push(paginationRow)
    }
    
    // Refresh button
    buttons.push([
      Markup.button.callback('🔄 Refresh', `digest_refresh_${digestType}_${timeframe}`)
    ])
    
    return Markup.inlineKeyboard(buttons)
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
        let timeframeCode = '24h' // for callback data
        if (userTimings.includes('1w')) {
          timeframeLabel = 'Next 7 Days'
          timeframeCode = '1w'
        } else if (userTimings.includes('48h')) {
          timeframeLabel = 'Next 2 Days'
          timeframeCode = '48h'
        }

        // Create paginated message
        const sessionsPerPage = 10
        const message = this.formatDigestMessage(
          filteredSessions,
          1, // Start at page 1
          sessionsPerPage,
          'morning',
          timeframeLabel
        )
        
        // Add pagination keyboard if needed
        const totalPages = Math.ceil(filteredSessions.length / sessionsPerPage)
        const keyboard = totalPages > 1 
          ? this.createDigestPaginationKeyboard(1, totalPages, 'morning', timeframeCode)
          : undefined

        // Store sessions in cache for pagination (you might want to use Redis or similar)
        // For now, we'll need to refetch when paginating
        
        const options = { parse_mode: 'Markdown' }
        if (keyboard) {
          options.reply_markup = keyboard.reply_markup
        }

        await this.bot.telegram.sendMessage(user.telegram_id, message, options)
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
        let timeframeCode = '24h' // for callback data
        if (userTimings.includes('1w')) {
          timeframeLabel = 'Next 7 Days'
          timeframeCode = '1w'
        } else if (userTimings.includes('48h')) {
          timeframeLabel = 'Next 2 Days'
          timeframeCode = '48h'
        }

        // Create paginated message
        const sessionsPerPage = 12
        const message = this.formatDigestMessage(
          filteredSessions,
          1, // Start at page 1
          sessionsPerPage,
          'evening',
          timeframeLabel
        )
        
        // Add pagination keyboard if needed
        const totalPages = Math.ceil(filteredSessions.length / sessionsPerPage)
        const keyboard = totalPages > 1 
          ? this.createDigestPaginationKeyboard(1, totalPages, 'evening', timeframeCode)
          : undefined

        const options = { parse_mode: 'Markdown' }
        if (keyboard) {
          options.reply_markup = keyboard.reply_markup
        }

        await this.bot.telegram.sendMessage(user.telegram_id, message, options)
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

  /**
   * Handle digest pagination callback
   */
  async handleDigestPagination(ctx, page, digestType, timeframeCode) {
    try {
      await ctx.answerCbQuery()
      
      const userId = ctx.from.id
      
      // Get user profile with the same structure as filterSessionsForUser expects
      const { data: profile } = await this.supabase
        .from('profiles')
        .select(`
          id,
          telegram_id,
          min_spots,
          user_levels (level),
          user_sides (side),
          user_days (day_of_week),
          user_time_windows (start_time, end_time)
        `)
        .eq('telegram_id', userId)
        .single()
      
      if (!profile) {
        return ctx.editMessageText('Unable to find your profile. Please run /setup first.')
      }
      
      // Determine days to fetch based on timeframe code
      let days = 1
      let timeframeLabel = 'Today'
      
      if (timeframeCode === '1w') {
        days = 7
        timeframeLabel = 'Next 7 Days'
      } else if (timeframeCode === '48h') {
        days = 2
        timeframeLabel = 'Next 2 Days'
      } else if (timeframeCode === '24h') {
        days = 1
        timeframeLabel = digestType === 'evening' ? 'Tomorrow' : 'Today'
      }
      
      // Get sessions
      const sessions = await this.scraper.getSessionsInRange(days).catch(() => [])
      const filteredSessions = this.filterSessionsForUser(sessions, profile)
      
      if (filteredSessions.length === 0) {
        return ctx.editMessageText('No matching sessions found for your preferences.')
      }
      
      // Generate paginated message
      const sessionsPerPage = digestType === 'morning' ? 10 : 12
      const totalPages = Math.ceil(filteredSessions.length / sessionsPerPage)
      
      // Validate page number
      const validPage = Math.min(Math.max(1, page), totalPages)
      
      const message = this.formatDigestMessage(
        filteredSessions,
        validPage,
        sessionsPerPage,
        digestType,
        timeframeLabel
      )
      
      const keyboard = totalPages > 1 
        ? this.createDigestPaginationKeyboard(validPage, totalPages, digestType, timeframeCode)
        : undefined
      
      const options = { parse_mode: 'Markdown' }
      if (keyboard) {
        options.reply_markup = keyboard.reply_markup
      }
      
      return ctx.editMessageText(message, options)
      
    } catch (error) {
      console.error('Error handling digest pagination:', error)
      await ctx.answerCbQuery('Failed to load page. Please try again.')
    }
  }
}

module.exports = DigestService