/**
 * Bot UI Components
 * Beautiful message formatting and user interface elements
 */

const ui = {
  /**
   * Welcome message for new users
   */
  welcomeMessage(firstName) {
    return `🌊 *Welcome to WavePing, ${firstName}!* 🏄‍♂️

🎯 *Your Personal Surf Assistant*

Get instant notifications when surf sessions matching your preferences become available at The Wave Bristol!

✨ *What WavePing does for you:*
🔔 Smart notifications for your preferred sessions
📱 Daily surf digests delivered when you want them
🌊 Real-time session availability tracking
🎯 Personalized recommendations based on your skill level

*Ready to catch your perfect wave?* 🤙`
  },

  /**
   * Welcome back message for returning users
   */
  welcomeBackMessage(firstName, userProfile) {
    const hasPreferences = userProfile.user_levels?.length > 0
    
    if (hasPreferences) {
      const levels = userProfile.user_levels.map(ul => ul.level).join(', ')
      const notifications = userProfile.user_notifications?.length || 0
      
      return `🌊 *Welcome back, ${firstName}!* 🏄‍♂️

📊 *Your Profile:*
🎯 Levels: ${this.capitalizeWords(levels)}
🔔 ${notifications} notification${notifications !== 1 ? 's' : ''} active
📱 Notifications: ${userProfile.notification_enabled ? '✅ Enabled' : '❌ Disabled'}

*What would you like to do today?* 🤙`
    } else {
      return `🌊 *Welcome back, ${firstName}!* 🏄‍♂️

Looks like you haven't finished setting up your preferences yet.

*Ready to get personalized surf alerts?* 🤙`
    }
  },

  /**
   * Main menu message
   */
  mainMenuMessage() {
    return `🏄‍♂️ *WavePing Main Menu* 🌊

Choose what you'd like to do:

🌊 *Sessions* - Check availability
⚙️ *Settings* - Manage preferences  
📱 *Help* - Get support

*Let's find you the perfect wave!* 🤙`
  },

  /**
   * Sessions display message
   */
  createSessionsMessage(timeframe, filteredSessions, allSessions, userProfile) {
    const emoji = {
      'Today': '🌊',
      'Tomorrow': '🌅',
      'Week': '📅'
    }[timeframe] || '🌊'
    
    let message = `${emoji} *${timeframe}'s Sessions*\n\n`
    
    if (filteredSessions.length === 0 && allSessions.length === 0) {
      message += `😴 *No sessions available*\n\n`
      message += `The waves are taking a rest day.\n`
      message += `Try checking tomorrow! 🌅`
      return message
    }
    
    if (userProfile && filteredSessions.length > 0) {
      message += `🎯 *Your Matches* (${filteredSessions.length})\n`
      message += `_Perfect for your preferences_\n\n`
      
      filteredSessions.slice(0, 6).forEach((session, i) => {
        const spots = session.spots_available || 0
        const levelEmoji = this.getLevelEmoji(session.level)
        const sideEmoji = session.side === 'L' ? '🏄‍♂️' : session.side === 'R' ? '🏄‍♀️' : '🌊'
        
        message += `${levelEmoji} *${session.time}* ${sideEmoji}\n`
        message += `   ${session.session_name}\n`
        message += `   💺 ${spots} spot${spots !== 1 ? 's' : ''} available\n`
        if (i < 5 && i < filteredSessions.length - 1) message += '\n'
      })
      
      if (filteredSessions.length > 6) {
        message += `\n_...and ${filteredSessions.length - 6} more matches!_\n`
      }
      
      // Show different sessions if available
      const otherSessions = allSessions.filter(s => 
        !filteredSessions.some(fs => fs.session_id === s.session_id)
      )
      
      if (otherSessions.length > 0) {
        message += `\n\n🌊 *Other Available Sessions* (${otherSessions.length})\n`
        message += `_Don't match your preferences, but available_\n\n`
        
        otherSessions.slice(0, 3).forEach((session, i) => {
          const spots = session.spots_available || 0
          const levelEmoji = this.getLevelEmoji(session.level)
          
          message += `${levelEmoji} *${session.time}* - ${spots} spots\n`
        })
        
        if (otherSessions.length > 3) {
          message += `_...and ${otherSessions.length - 3} more available._`
        }
      }
    } else {
      // Show all sessions (no user profile or no matches)
      message += `🌊 *All Available Sessions* (${allSessions.length})\n\n`
      
      if (allSessions.length === 0) {
        message += `😴 No sessions with available spots right now.\n`
        message += `Check back later or set up notifications! 🔔`
        return message
      }
      
      allSessions.slice(0, 8).forEach((session, i) => {
        const spots = session.spots_available || 0
        const levelEmoji = this.getLevelEmoji(session.level)
        const sideEmoji = session.side === 'L' ? '🏄‍♂️' : session.side === 'R' ? '🏄‍♀️' : '🌊'
        
        message += `${levelEmoji} *${session.time}* ${sideEmoji}\n`
        message += `   ${session.session_name}\n`
        message += `   💺 ${spots} spot${spots !== 1 ? 's' : ''}\n`
        if (i < 7 && i < allSessions.length - 1) message += '\n'
      })
      
      if (allSessions.length > 8) {
        message += `\n_...and ${allSessions.length - 8} more sessions!_`
      }
    }
    
    message += `\n\n🔗 [Book at The Wave](https://thewave.com/bristol/book/)`
    
    return message
  },

  /**
   * Week overview
   */
  createWeekOverview(sessions) {
    const dayGroups = {}
    const today = new Date().toISOString().split('T')[0]
    
    // Group sessions by day
    sessions.forEach(session => {
      if (!dayGroups[session.dateISO]) {
        dayGroups[session.dateISO] = []
      }
      dayGroups[session.dateISO].push(session)
    })
    
    let message = `📅 *Week Overview* 🌊\n\n`
    
    const sortedDays = Object.keys(dayGroups).sort()
    
    if (sortedDays.length === 0) {
      return message + `😴 *No sessions found*\n\nThe waves are taking a week off! 🏖️`
    }
    
    sortedDays.slice(0, 7).forEach((dateISO, dayIndex) => {
      const daySessions = dayGroups[dateISO]
      const availableSessions = daySessions.filter(s => (s.spots_available || 0) > 0)
      
      const dayName = this.getDayName(dateISO, today)
      const totalSpots = availableSessions.reduce((sum, s) => sum + (s.spots_available || 0), 0)
      
      message += `${dayIndex === 0 ? '🌊' : dayIndex === 1 ? '🌅' : '📆'} *${dayName}*\n`
      message += `   ${availableSessions.length} sessions, ${totalSpots} total spots\n`
      
      // Show top 2 sessions
      availableSessions.slice(0, 2).forEach(session => {
        const levelEmoji = this.getLevelEmoji(session.level)
        message += `   ${levelEmoji} ${session.time} (${session.spots_available} spots)\n`
      })
      
      if (availableSessions.length > 2) {
        message += `   _...and ${availableSessions.length - 2} more_\n`
      }
      
      if (dayIndex < Math.min(sortedDays.length - 1, 6)) message += '\n'
    })
    
    return message
  },

  /**
   * Preferences display
   */
  createPreferencesMessage(userProfile) {
    let message = `⚙️ *Your Surf Preferences* 🏄‍♂️\n\n`
    
    // Levels
    const levels = userProfile.user_levels?.map(ul => ul.level) || []
    if (levels.length > 0) {
      const levelEmojis = levels.map(l => `${this.getLevelEmoji(l)} ${this.capitalizeWords(l)}`).join(', ')
      message += `🎯 *Skill Levels:* ${levelEmojis}\n`
    } else {
      message += `🎯 *Skill Levels:* Not set\n`
    }
    
    // Sides
    const sides = userProfile.user_sides?.map(us => 
      us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any'
    ) || []
    const sideText = sides.length > 0 ? sides.join(', ') : 'Any side'
    message += `🏄 *Wave Side:* ${sideText}\n`
    
    // Days
    const days = userProfile.user_days?.map(ud => {
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      return dayNames[ud.day_of_week]
    }) || []
    const daysText = days.length > 0 ? days.join(', ') : 'Any day'
    message += `📅 *Surf Days:* ${daysText}\n`
    
    // Time windows
    const times = userProfile.user_time_windows?.map(tw => 
      `${tw.start_time}-${tw.end_time}`
    ) || []
    const timesText = times.length > 0 ? times.join(', ') : 'Any time'
    message += `🕐 *Time Windows:* ${timesText}\n`
    
    // Min spots
    message += `💺 *Min Spots:* ${userProfile.min_spots || 1}\n`
    
    // Notifications
    const notifications = userProfile.user_notifications?.map(un => un.timing) || []
    const notifText = notifications.length > 0 ? notifications.join(', ') : 'None'
    message += `🔔 *Notifications:* ${notifText}\n`
    
    // Status
    message += `📱 *Status:* ${userProfile.notification_enabled ? '✅ Active' : '❌ Paused'}\n`
    
    message += `\n*Want to make changes?* 🛠️`
    
    return message
  },

  /**
   * Notification settings
   */
  createNotificationMessage(userProfile) {
    let message = `🔔 *Notification Settings* 📱\n\n`
    
    message += `*Current Status:* ${userProfile.notification_enabled ? '✅ Active' : '❌ Paused'}\n\n`
    
    const notifications = userProfile.user_notifications || []
    if (notifications.length > 0) {
      message += `*Active Notifications:*\n`
      notifications.forEach(notif => {
        const emoji = {
          '24h': '📅',
          '12h': '🌅',
          '6h': '⏰',
          '3h': '⚡',
          '1h': '🚨'
        }[notif.timing] || '🔔'
        
        message += `${emoji} ${notif.timing} before sessions\n`
      })
    } else {
      message += `*No notification timings set*\n`
      message += `Set up when you want to be alerted! ⏰`
    }
    
    const digests = userProfile.user_digest_preferences || []
    if (digests.length > 0) {
      message += `\n*Daily Digests:*\n`
      digests.forEach(digest => {
        const emoji = digest.digest_type === 'morning' ? '🌅' : '🌇'
        const time = digest.digest_type === 'morning' ? '8:00 AM' : '6:00 PM'
        message += `${emoji} ${this.capitalizeWords(digest.digest_type)} digest at ${time}\n`
      })
    }
    
    return message
  },

  /**
   * Setup welcome
   */
  setupWelcomeMessage() {
    return `⚙️ *Setup Your Surf Preferences* 🏄‍♂️

Let's personalize WavePing for you!

🚀 *Quick Setup (30 seconds)*
Perfect for getting started fast with smart defaults.

⚙️ *Detailed Setup (2 minutes)*  
Full customization of all preferences.

*Choose your adventure:* 🤙`
  },

  /**
   * Quick setup message
   */
  quickSetupMessage() {
    return `🚀 *Quick Setup Started!* ⚡

*Step 1 of 3: Your Skill Level*

Choose your surfing level to get the right session recommendations:

🟢 *Beginner* - New to surfing, learning basics
🔵 *Improver* - Getting comfortable, building confidence  
🟡 *Intermediate* - Regular surfer, comfortable on most waves
🟠 *Advanced* - Experienced surfer, all conditions
🔴 *Expert* - Pro level, coaching others

*What's your level?* 🏄‍♂️`
  },

  /**
   * Help message
   */
  helpMessage() {
    return `❓ *WavePing Help Center* 🆘

🏄‍♂️ *Commands:*
/today - See today's sessions
/tomorrow - Tomorrow's sessions  
/week - Week overview
/prefs - Manage preferences
/setup - Configure alerts
/help - This help message

🔔 *How Notifications Work:*
• Set your preferences (level, times, days)
• Choose notification timing (1h, 6h, 24h before)
• Get alerts when matching sessions have spots!

📱 *Daily Digests:*
• Morning digest (8 AM) - Plan your day
• Evening digest (6 PM) - Tomorrow's preview

🆘 *Need More Help?*
Contact @WavePingSupport for assistance!

*Happy surfing!* 🤙`
  },

  /**
   * Test message
   */
  createTestMessage(userProfile) {
    const hasProfile = !!userProfile
    const hasPrefs = hasProfile && userProfile.user_levels?.length > 0
    
    let message = `🧪 *WavePing Test Center* 🔬\n\n`
    
    message += `*Profile Status:* ${hasProfile ? '✅' : '❌'}\n`
    message += `*Preferences Set:* ${hasPrefs ? '✅' : '❌'}\n`
    message += `*Notifications:* ${hasProfile && userProfile.notification_enabled ? '✅' : '❌'}\n\n`
    
    if (hasProfile) {
      message += `*User ID:* ${userProfile.id}\n`
      message += `*Telegram ID:* ${userProfile.telegram_id}\n`
      message += `*Min Spots:* ${userProfile.min_spots || 1}\n\n`
    }
    
    message += `*Test Functions:* 🧪`
    
    return message
  },

  // Utility methods
  getLevelEmoji(level) {
    const emojis = {
      'beginner': '🟢',
      'improver': '🔵', 
      'intermediate': '🟡',
      'advanced': '🟠',
      'expert': '🔴'
    }
    return emojis[level.toLowerCase()] || '⚪'
  },

  capitalizeWords(str) {
    return str.replace(/\b\w/g, l => l.toUpperCase())
  },

  getDayName(dateISO, today) {
    const date = new Date(dateISO)
    const todayDate = new Date(today)
    const diffTime = date - todayDate
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Tomorrow'
    
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    return days[date.getDay()]
  }
}

module.exports = ui