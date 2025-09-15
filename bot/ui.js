/**
 * Bot UI Components
 * Beautiful message formatting and user interface elements
 */

const ui = {
  /**
   * Welcome message for new users
   */
  welcomeMessage(firstName) {
    return `🌊 <b>Welcome to WavePing, ${firstName}!</b>

<b>Your Personal Surf Assistant</b>

Get instant notifications when surf sessions matching your preferences become available at The Wave Bristol!

<b>What WavePing does for you:</b>
Smart notifications for your preferred sessions
Daily surf digests delivered when you want them
Daily session digest updates
Personalized recommendations based on your skill level

<b>Ready to catch your perfect wave?</b>`
  },

  /**
   * Welcome back message for returning users
   */
  welcomeBackMessage(firstName, userProfile) {
    const hasPreferences = userProfile.user_levels?.length > 0
    
    if (hasPreferences) {
      return `<b>Welcome back, ${firstName}</b>`
    } else {
      return `<b>Welcome back, ${firstName}</b>

Set up your preferences to get personalized surf alerts.`
    }
  },

  /**
   * Main menu message
   */
  mainMenuMessage(todayCount = null, tomorrowCount = null) {
    const todayText = todayCount !== null ? ` (${todayCount})` : ''
    const tomorrowText = tomorrowCount !== null ? ` (${tomorrowCount})` : ''
    
    return `🌊 <b>WavePing</b>

Today${todayText} and Tomorrow${tomorrowText} sessions available.
Your Setup and Alerts & Digests below.`
  },

  /**
   * Sessions display message
   */
  createSessionsMessage(timeframe, filteredSessions, allSessions, userProfile, showAll = false) {
    const emoji = {
      'Today': '🌊',
      'Tomorrow': '🌅',
      'Week': '📅'
    }[timeframe] || '🌊'
    
    let message = `${emoji} <b>${timeframe} at The Wave</b>\n`
    
    if (filteredSessions.length === 0 && allSessions.length === 0) {
      message += `\n<b>No sessions available</b>\n\n`
      message += `No sessions scheduled.\nTry checking tomorrow.`
      return message
    }
    
    if (userProfile && filteredSessions.length > 0) {
      message += `<b>Your matches (${filteredSessions.length})</b>\n\n`
      
      // Show top 4 sessions or all if showAll is true
      const maxDisplay = showAll ? filteredSessions.length : 4
      const sessionsToShow = filteredSessions.slice(0, maxDisplay)
      
      sessionsToShow.forEach((session) => {
        const spots = session.spots_available || 0
        const sessionName = session.session_name || this.capitalizeWords(session.level)
        
        message += `<b>${session.time}</b> • ${sessionName} • <b>${this.spotsLabel(spots)}</b>\n`
      })
      
      
    } else if (userProfile && filteredSessions.length === 0) {
      // User has preferences but no matches
      message += `<b>No matches right now</b>\n\n`
      message += `Try widening time windows or set Min spots to 1+.\n\n`
      
      // Show all available sessions
      if (allSessions.length > 0) {
        message += `<b>Other available sessions (${allSessions.length})</b>\n\n`
        
        const maxDisplay = showAll ? allSessions.length : 4
        const sessionsToShow = allSessions.slice(0, maxDisplay)
        
        sessionsToShow.forEach((session) => {
          const spots = session.spots_available || 0
          const sessionName = session.session_name || this.capitalizeWords(session.level)
          
          message += `<b>${session.time}</b> • ${sessionName} • <b>${this.spotsLabel(spots)}</b>\n`
        })
      }
      
    } else {
      // No user profile  
      message += `<b>All available sessions (${allSessions.length})</b>\n\n`
      
      if (allSessions.length === 0) {
        message += `No sessions available right now.`
        return message
      }
      
      const maxDisplay = showAll ? allSessions.length : 4
      const sessionsToShow = allSessions.slice(0, maxDisplay)
      
      sessionsToShow.forEach((session) => {
        const spots = session.spots_available || 0
        const sessionName = session.session_name || this.capitalizeWords(session.level)
        
        message += `<b>${session.time}</b> • ${sessionName} • <b>${this.spotsLabel(spots)}</b>\n`
      })
      
    }
    
    return message
  },

  // Week overview removed - only today/tomorrow supported

  /**
   * Preferences display
   */
  createPreferencesMessage(userProfile) {
    let message = `🛠 <b>Your Setup</b>\n\n`
    
    // Levels - clean, no emojis
    const levels = userProfile.user_levels?.map(ul => this.capitalizeWords(ul.level)) || []
    const levelText = levels.length > 0 ? levels.join(', ') : 'Not set'
    message += `<b>Level:</b> ${levelText}\n`
    
    // Sides - clean
    const sides = userProfile.user_sides?.map(us => 
      us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any'
    ) || []
    const sideText = sides.length > 0 ? sides.join(', ') : 'Any'
    message += `<b>Wave side:</b> ${sideText}\n`
    
    // Days - compact format
    const days = userProfile.user_days?.map(ud => {
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      return dayNames[ud.day_of_week]
    }) || []
    let daysText = 'Mon–Sun'
    if (days.length === 5 && !days.includes('Sat') && !days.includes('Sun')) {
      daysText = 'Mon–Fri'
    } else if (days.length === 2 && days.includes('Sat') && days.includes('Sun')) {
      daysText = 'Weekends'
    } else if (days.length > 0 && days.length < 7) {
      daysText = days.join(', ')
    }
    message += `<b>Days:</b> ${daysText}\n`
    
    // Time windows - chip format
    const times = userProfile.user_time_windows?.map(tw => 
      this.chipTimeWindow(tw.start_time, tw.end_time)
    ) || []
    const timesText = times.length > 0 ? times.join(', ') : 'Any'
    message += `<b>Time windows:</b> ${timesText}\n`
    
    // Min spots
    const minSpots = userProfile.min_spots || 1
    message += `<b>Min spots:</b> ${minSpots}+\n`
    
    // Notification timing preferences - show when user gets alerts
    const notificationFilters = userProfile.user_digest_filters || []
    let notificationText = 'Not set'
    if (notificationFilters.length > 0) {
      const timingMap = {
        '1w': '1 week before',
        '48h': '48h before',
        '24h': '24h before', 
        '12h': '12h before',
        '2h': '2h before'
      }
      const timingItems = notificationFilters.map(filter => 
        timingMap[filter.timing] || filter.timing
      )
      notificationText = timingItems.join(', ')
    }
    message += `<b>Notification timing:</b> ${notificationText}\n`
    
    // Digest preferences - clean format
    const digestPrefs = userProfile.user_digest_preferences || []
    let digestText = 'None'
    if (digestPrefs.length > 0) {
      const digestItems = digestPrefs.map(pref => {
        const time = pref.digest_type === 'morning' ? '08:00' : '18:00'
        return `${this.capitalizeWords(pref.digest_type)} ${time}`
      })
      digestText = digestItems.join(', ')
    }
    message += `<b>Digests:</b> ${digestText}\n`
    
    // Alerts status - clean
    const alertsStatus = userProfile.notification_enabled ? 'On' : 'Off'
    message += `<b>Alerts:</b> ${alertsStatus}\n`
    
    message += `\n<i>Tap a setting below to change it:</i>`
    
    return message
  },

  /**
   * Current profile overview
   */
  createProfileOverviewMessage(userProfile) {
    let message = `👤 <b>Your Current Profile</b> 🏄‍♂️\n\n`
    
    // Account info
    message += `<b>Account:</b> ${userProfile.telegram_username ? '@' + userProfile.telegram_username : 'Telegram User'}\n`
    message += `<b>Status:</b> ${userProfile.notification_enabled ? '✅ Active' : '❌ Paused'}\n\n`
    
    // Skill Levels
    const levels = userProfile.user_levels?.map(ul => ul.level) || []
    if (levels.length > 0) {
      const levelText = levels.map(l => this.capitalizeWords(l)).join(', ')
      message += `🎯 <b>Skill Levels:</b> ${levelText}\n`
    } else {
      message += `🎯 <b>Skill Levels:</b> Not set\n`
    }
    
    // Wave Sides
    const sides = userProfile.user_sides?.map(us => 
      us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any'
    ) || []
    const sideText = sides.length > 0 ? sides.join(', ') : 'Any side'
    message += `🏄 <b>Wave Side:</b> ${sideText}\n`
    
    // Days
    const days = userProfile.user_days?.map(ud => {
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      return dayNames[ud.day_of_week]
    }) || []
    const daysText = days.length > 0 ? days.join(', ') : 'Any day'
    message += `📅 <b>Surf Days:</b> ${daysText}\n`
    
    // Time windows
    const times = userProfile.user_time_windows?.map(tw => 
      `${tw.start_time}-${tw.end_time}`
    ) || []
    const timesText = times.length > 0 ? times.join(', ') : 'Any time'
    message += `🕐 <b>Time Windows:</b> ${timesText}\n`
    
    // Min spots
    message += `💺 <b>Min Spots:</b> ${userProfile.min_spots || 1}\n`
    
    // Notifications
    const digestPrefs = userProfile.user_digest_preferences || []
    if (digestPrefs.length > 0) {
      const digestText = digestPrefs.map(pref => {
        return pref.digest_type === 'morning' ? '🌅 Morning digest' : '🌇 Evening digest'
      }).join(', ')
      message += `🔔 <b>Daily Digests:</b> ${digestText}\n`
    } else {
      message += `🔔 <b>Daily Digests:</b> None set\n`
    }
    
    message += `\n<b>Ready to make changes?</b> Use the buttons below! 👇`
    
    return message
  },

  /**
   * Notification settings
   */
  createNotificationMessage(userProfile) {
    let message = `🔔 <b>Notification Settings</b> 📱\n\n`
    
    message += `<b>Current Status:</b> ${userProfile.notification_enabled ? '✅ Active' : '❌ Paused'}\n\n`
    
    // Show digest delivery preferences (morning/evening)
    const digestPrefs = userProfile.user_digest_preferences || []
    if (digestPrefs.length > 0) {
      message += `<b>Daily Digest Delivery:</b>\n`
      digestPrefs.forEach(pref => {
        const emoji = pref.digest_type === 'morning' ? '🌅' : '🌇'
        const time = pref.digest_type === 'morning' ? '8:00 AM' : '6:00 PM'
        message += `${emoji} ${this.capitalizeWords(pref.digest_type)} digest at ${time}\n`
      })
    } else {
      message += `<b>No digest delivery preferences set</b>\n`
      message += `Choose when you want to receive daily surf summaries! ⏰`
    }
    
    // Show session filters (what sessions to include)
    const sessionFilters = userProfile.user_digest_filters || []
    if (sessionFilters.length > 0) {
      message += `\n<b>Session Filters:</b>\n`
      message += `Include sessions starting within: ${sessionFilters.map(f => f.timing).join(', ')}\n`
    } else {
      message += `\n<b>No session filters set</b>\n`
      message += `Choose how far ahead to look for sessions! 🔍`
    }
    
    return message
  },

  /**
   * Setup welcome
   */
  setupWelcomeMessage() {
    return `⚙️ <b>Setup Your Surf Preferences</b> 🏄‍♂️

Let's personalize WavePing for you!

🚀 <b>Quick Setup (30 seconds)</b>
Perfect for getting started fast with smart defaults.

⚙️ <b>Detailed Setup (2 minutes)</b>  
Full customization of all preferences.

<b>Choose your adventure:</b> 🤙`
  },

  /**
   * Quick setup message
   */
  quickSetupMessage() {
    return `🚀 <b>Quick Setup Started!</b> ⚡

<b>Step 1 of 3: Your Skill Level</b>

Choose your surfing level to get the right session recommendations:

🟢 <b>Beginner</b> - New to surfing, learning basics
🔵 <b>Improver</b> - Getting comfortable, building confidence  
🟡 <b>Intermediate</b> - Regular surfer, comfortable on most waves
🟠 <b>Advanced</b> - Experienced surfer, all conditions
🔴 <b>Expert</b> - Pro level, coaching others

<b>What's your level?</b> 🏄‍♂️`
  },

  /**
   * Help message - User support and feedback
   */
  helpMessage() {
    return `<b>🛟 Help & Feedback</b>

Questions, bug, or an idea? Ping me.

<b>Contact</b>
• Telegram: <a href="https://t.me/driftwithcaz">@driftwithcaz</a>
• Email: <a href="mailto:ckpleiser@gmail.com">ckpleiser@gmail.com</a>

<b>When you write</b>
• What you tried / where it broke
• Your Telegram username
• Screenshots if useful

<b>Feature requests</b>
Tell me the problem, what you want the bot to do, and why it helps.`
  },

  /**
   * Test message
   */
  createTestMessage(userProfile) {
    const hasProfile = !!userProfile
    const hasPrefs = hasProfile && userProfile.user_levels?.length > 0
    
    let message = `🧪 <b>WavePing Test Center</b> 🔬\n\n`
    
    message += `<b>Profile Status:</b> ${hasProfile ? '✅' : '❌'}\n`
    message += `<b>Preferences Set:</b> ${hasPrefs ? '✅' : '❌'}\n`
    message += `<b>Notifications:</b> ${hasProfile && userProfile.notification_enabled ? '✅' : '❌'}\n\n`
    
    if (hasProfile) {
      message += `<b>User ID:</b> ${userProfile.id}\n`
      message += `<b>Telegram ID:</b> ${userProfile.telegram_id}\n`
      message += `<b>Min Spots:</b> ${userProfile.min_spots || 1}\n\n`
    }
    
    message += `<b>Test Functions:</b> 🧪`
    
    return message
  },

  /**
   * Post-save confirmation message with clear next actions
   */
  createSavedPreferencesMessage() {
    return `✅ <b>Saved.</b> We'll only ping you for matches.

<b>What's next?</b>
• <b>/today</b> — See matches you can book now at The Wave
• <b>/tomorrow</b> — Preview tomorrow's sessions

<b>Need tweaks?</b>
• <b>Alerts & Digests</b> — instant pings + daily summaries
• <b>Your Setup</b> — levels, sides, days, times, spots`
  },

  /**
   * Support message - Donations only
   */
  supportMessage() {
    return `<b>☕ Donate to WavePing</b>

Free, open-source digests for The Wave Bristol.
Your donation keeps this running.

<b>Your support funds</b>
• Servers & scraping
• Fixes and new features

Thanks for keeping it free for everyone.`
  },

  contactMessage() {
    return (
      `💬 <b>Contact the developer</b>\n\n` +
      `Questions, feedback, or found a bug? Ping me.\n\n` +
      `<b>Get in touch</b>\n` +
      `• 📧 Email: <a href="mailto:ckpleiser@gmail.com">ckpleiser@gmail.com</a>\n` +
      `• 💬 Telegram: <a href="https://t.me/driftwithcaz">@driftwithcaz</a>\n\n` +
      `<b>Response time</b>\n` +
      `Usually within 24 hours.\n\n` +
      `<b>Please include</b>\n` +
      `• What you tried and the screen you were on\n` +
      `• Your Telegram username\n` +
      `• Screenshots if helpful\n\n` +
      `Thanks for helping make WavePing better. 🌊`
    )
  },

  featureRequestMessage() {
    return (
      `📈 <b>Feature requests</b>\n\n` +
      `Got an idea that would make WavePing more useful?\n\n` +
      `<b>How to send it</b>\n` +
      `• Telegram: <a href="https://t.me/driftwithcaz">@driftwithcaz</a>\n` +
      `• Email: <a href="mailto:ckpleiser@gmail.com">ckpleiser@gmail.com</a>\n\n` +
      `<b>Tell me</b>\n` +
      `• The problem you want to solve\n` +
      `• What you'd like the bot to do\n` +
      `• Why it helps (and how often you'd use it)\n\n` +
      `<b>How I prioritise</b>\n` +
      `Stuff that helps the most surfers ships first.`
    )
  },

  // Utility methods

  // Chip formatting helpers for consistency
  chipSide(side) {
    if (side === 'L' || side === 'Left') return '[L]'
    if (side === 'R' || side === 'Right') return '[R]'
    return '[Any]'
  },

  chipTimeWindow(startTime, endTime) {
    const start = parseInt(startTime.split(':')[0])
    const end = parseInt(endTime.split(':')[0])
    return `${start}–${end}`
  },

  spotsLabel(spots) {
    return `${spots} spot${spots !== 1 ? 's' : ''}`
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