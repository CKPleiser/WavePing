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
  mainMenuMessage() {
    return `🏄‍♂️ <b>WavePing Main Menu</b>

Quick commands:
/today - Check today's sessions
/tomorrow - Check tomorrow's sessions
/setup - Change your preferences

Ready to find your session.`
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
    
    let message = `${emoji} <b>${timeframe} at The Wave</b>\n`
    
    if (filteredSessions.length === 0 && allSessions.length === 0) {
      message += `\n<b>No sessions available</b>\n\n`
      message += `No sessions scheduled.\nTry checking tomorrow.`
      return message
    }
    
    if (userProfile && filteredSessions.length > 0) {
      message += `<b>Your matches (${filteredSessions.length})</b>\n\n`
      
      // Show top 4 sessions, then "Show more (N)" if needed
      const maxDisplay = 4
      const sessionsToShow = filteredSessions.slice(0, maxDisplay)
      const remainingSessions = filteredSessions.length - maxDisplay
      
      sessionsToShow.forEach((session) => {
        const spots = session.spots_available || 0
        const level = this.capitalizeWords(session.level)
        const sideChip = this.chipSide(session.side)
        
        message += `<b>${session.time}</b> • ${level} • ${sideChip} • <b>${this.spotsLabel(spots)}</b>\n`
      })
      
      if (remainingSessions > 0) {
        message += `\n<i>Show more (${remainingSessions})</i>\n`
      }
      
    } else if (userProfile && filteredSessions.length === 0) {
      // User has preferences but no matches
      message += `<b>No matches right now</b>\n\n`
      message += `Try widening time windows or set Min spots to 1+.\n\n`
      
      // Show all available sessions
      if (allSessions.length > 0) {
        message += `<b>Other available sessions (${allSessions.length})</b>\n\n`
        
        const maxDisplay = 4
        const sessionsToShow = allSessions.slice(0, maxDisplay)
        const remainingSessions = allSessions.length - maxDisplay
        
        sessionsToShow.forEach((session) => {
          const spots = session.spots_available || 0
          const level = this.capitalizeWords(session.level)
          const sideChip = this.chipSide(session.side)
          
          message += `<b>${session.time}</b> • ${level} • ${sideChip} • <b>${this.spotsLabel(spots)}</b>\n`
        })
        
        if (remainingSessions > 0) {
          message += `\n<i>Show more (${remainingSessions})</i>\n`
        }
      }
      
    } else {
      // No user profile  
      message += `<b>All available sessions (${allSessions.length})</b>\n\n`
      
      if (allSessions.length === 0) {
        message += `No sessions available right now.`
        return message
      }
      
      const maxDisplay = 4
      const sessionsToShow = allSessions.slice(0, maxDisplay)
      const remainingSessions = allSessions.length - maxDisplay
      
      sessionsToShow.forEach((session) => {
        const spots = session.spots_available || 0
        const level = this.capitalizeWords(session.level)
        const sideChip = this.chipSide(session.side)
        
        message += `<b>${session.time}</b> • ${level} • ${sideChip} • <b>${this.spotsLabel(spots)}</b>\n`
      })
      
      if (remainingSessions > 0) {
        message += `\n<i>Show more (${remainingSessions})</i>\n`
      }
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
    message += `**Level:** ${levelText}\n`
    
    // Sides - clean
    const sides = userProfile.user_sides?.map(us => 
      us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any'
    ) || []
    const sideText = sides.length > 0 ? sides.join(', ') : 'Any'
    message += `**Wave side:** ${sideText}\n`
    
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
    message += `**Days:** ${daysText}\n`
    
    // Time windows - chip format
    const times = userProfile.user_time_windows?.map(tw => 
      this.chipTimeWindow(tw.start_time, tw.end_time)
    ) || []
    const timesText = times.length > 0 ? times.join(', ') : 'Any'
    message += `**Time windows:** ${timesText}\n`
    
    // Min spots
    const minSpots = userProfile.min_spots || 1
    message += `**Min spots:** ${minSpots}+\n`
    
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
    message += `**Digests:** ${digestText}\n`
    
    // Alerts status - clean
    const alertsStatus = userProfile.notification_enabled ? 'On' : 'Off'
    message += `**Alerts:** ${alertsStatus}\n`
    
    message += `\n*Tap a setting below to change it:*`
    
    return message
  },

  /**
   * Current profile overview
   */
  createProfileOverviewMessage(userProfile) {
    let message = `👤 *Your Current Profile* 🏄‍♂️\n\n`
    
    // Account info
    message += `*Account:* ${userProfile.telegram_username ? '@' + userProfile.telegram_username : 'Telegram User'}\n`
    message += `*Status:* ${userProfile.notification_enabled ? '✅ Active' : '❌ Paused'}\n\n`
    
    // Skill Levels
    const levels = userProfile.user_levels?.map(ul => ul.level) || []
    if (levels.length > 0) {
      const levelEmojis = levels.map(l => `${this.getLevelEmoji(l)} ${this.capitalizeWords(l)}`).join(', ')
      message += `🎯 *Skill Levels:* ${levelEmojis}\n`
    } else {
      message += `🎯 *Skill Levels:* Not set\n`
    }
    
    // Wave Sides
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
    const digestPrefs = userProfile.user_digest_preferences || []
    if (digestPrefs.length > 0) {
      const digestText = digestPrefs.map(pref => {
        return pref.digest_type === 'morning' ? '🌅 Morning digest' : '🌇 Evening digest'
      }).join(', ')
      message += `🔔 *Daily Digests:* ${digestText}\n`
    } else {
      message += `🔔 *Daily Digests:* None set\n`
    }
    
    message += `\n*Ready to make changes?* Use the buttons below! 👇`
    
    return message
  },

  /**
   * Notification settings
   */
  createNotificationMessage(userProfile) {
    let message = `🔔 *Notification Settings* 📱\n\n`
    
    message += `*Current Status:* ${userProfile.notification_enabled ? '✅ Active' : '❌ Paused'}\n\n`
    
    // Show digest delivery preferences (morning/evening)
    const digestPrefs = userProfile.user_digest_preferences || []
    if (digestPrefs.length > 0) {
      message += `*Daily Digest Delivery:*\n`
      digestPrefs.forEach(pref => {
        const emoji = pref.digest_type === 'morning' ? '🌅' : '🌇'
        const time = pref.digest_type === 'morning' ? '8:00 AM' : '6:00 PM'
        message += `${emoji} ${this.capitalizeWords(pref.digest_type)} digest at ${time}\n`
      })
    } else {
      message += `*No digest delivery preferences set*\n`
      message += `Choose when you want to receive daily surf summaries! ⏰`
    }
    
    // Show session filters (what sessions to include)
    const sessionFilters = userProfile.user_digest_filters || []
    if (sessionFilters.length > 0) {
      message += `\n*Session Filters:*\n`
      message += `Include sessions starting within: ${sessionFilters.map(f => f.timing).join(', ')}\n`
    } else {
      message += `\n*No session filters set*\n`
      message += `Choose how far ahead to look for sessions! 🔍`
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
    return `❓ *WavePing Help*

**Available Commands:**
/start - Welcome message and main menu
/today - Today's surf sessions  
/tomorrow - Tomorrow's surf sessions
/setup - Your preferences and settings
/notifications - Manage alerts and digests
/support - Support the developer
/help - This help message

**How It Works:**
1. Set your preferences (skill level, preferred times, wave side)
2. Choose when to receive notifications 
3. Get alerts when matching sessions become available

**Daily Digests:**
• Morning digest (8 AM) - Plan your day
• Evening digest (6 PM) - Preview tomorrow

**Need Help?**
Contact @driftwithcaz for support.

*Happy surfing!*`
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

  /**
   * Post-save confirmation message with clear next actions
   */
  createSavedPreferencesMessage() {
    return `✅ *Saved.* We'll only ping you for matches.

*What's next?*
• */today* — See matches you can book now at The Wave
• */tomorrow* — Preview tomorrow's sessions

*Need tweaks?*
• *Alerts & Digests* — instant pings + daily summaries
• *Your Setup* — levels, sides, days, times, spots`
  },

  /**
   * Support message - Buy Me a Coffee integration
   */
  supportMessage() {
    return `☕ *Support WavePing* 💙

🌊 Thank you for using WavePing! This bot helps surfers at The Wave Bristol get the perfect session notifications.

*How WavePing helps you:*
• 🔔 Smart session alerts for your skill level
• 📱 Daily surf digests delivered when you want
• 🎯 Personalized recommendations
• 🔄 Daily availability updates

*Support the Development:*
WavePing is built with ❤️ by an independent developer. Your support helps:

• 🔧 Keep the bot running 24/7
• ✨ Add new features you request  
• 🛡️ Maintain reliable notifications
• 🌊 Improve the surf experience for everyone

*Ways to Support:*`
  },

  /**
   * Contact support message
   */
  contactMessage() {
    return `💬 *Contact Developer* 🙋‍♂️

Have questions, feedback, or found a bug?

*Get in Touch:*
• 📧 Email: ckpleiser@gmail.com
• 💬 Telegram: @driftwithcaz

*Response Time:*
Usually within 24 hours! 🚀

*What to Include:*
• Describe the issue clearly
• Include your Telegram username
• Screenshots if helpful

Thanks for helping make WavePing better! 🌊`
  },

  /**
   * Feature request message
   */
  featureRequestMessage() {
    return `📈 *Feature Requests* ✨

Got an idea to make WavePing even better?

*Popular Requests:*
• 🌡️ Water temperature alerts
• 🌌 Wind condition notifications  
• 📅 Session booking reminders
• 🏆 Surf streak tracking
• 📊 Session analytics

*How to Submit:*
1️⃣ Contact @Driftwithcaz with your idea
2️⃣ Describe how it would help you
3️⃣ We'll consider it for the roadmap!

*Development Priority:*
Features that help the most surfers get added first! 🌊

Your input shapes the future of WavePing! 🚀`
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