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
      const notifications = userProfile.user_digest_filters?.length || 0
      
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

Quick commands:
/today - 🌊 Check today's sessions
/tomorrow - 🌅 Check tomorrow's sessions

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
    } else if (userProfile && filteredSessions.length === 0) {
      // User has preferences but no matches
      message += `No matching sessions right now.\n\n`
      message += `💡 *Tip:* broaden time windows or set Min spots to 1+.\n\n`
      message += `🌊 *All Available Sessions* (${allSessions.length})\n\n`
    } else {
      // No user profile  
      message += `🌊 *All Available Sessions* (${allSessions.length})\n\n`
      
      if (allSessions.length === 0) {
        message += `No sessions with available spots right now.\n\n`
        message += `💡 *Tip:* Set up alerts to get notified when spots open.`
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
  
    message += `\n🔗 [Book at The Wave](https://ticketing.thewave.com/)`
    
    return message
  },

  // Week overview removed - only today/tomorrow supported

  /**
   * Preferences display
   */
  createPreferencesMessage(userProfile) {
    let message = `🛠 *Your Setup* 🏄‍♂️\n\n`
    
    // Levels
    const levels = userProfile.user_levels?.map(ul => ul.level) || []
    if (levels.length > 0) {
      const levelEmojis = levels.map(l => `${this.getLevelEmoji(l)} ${this.capitalizeWords(l)}`).join(', ')
      message += `🎯 Skill Levels: ${levelEmojis}\n`
    } else {
      message += `🎯 Skill Levels: Not set\n`
    }
    
    // Sides
    const sides = userProfile.user_sides?.map(us => 
      us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any'
    ) || []
    const sideText = sides.length > 0 ? sides.join(', ') : 'Any side'
    message += `🏄 Wave Side: ${sideText}\n`
    
    // Days
    const days = userProfile.user_days?.map(ud => {
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      return dayNames[ud.day_of_week]
    }) || []
    const daysText = days.length > 0 ? days.join(', ') : 'Any day'
    message += `📅 Surf Days: ${daysText}\n`
    
    // Time windows
    const times = userProfile.user_time_windows?.map(tw => 
      `${tw.start_time}-${tw.end_time}`
    ) || []
    const timesText = times.length > 0 ? times.join(', ') : 'Any time'
    message += `🕐 Time Windows: ${timesText}\n`
    
    // Min spots
    message += `💺 Min Spots: ${userProfile.min_spots || 1}\n`
    
    // Digest preferences (when to receive digests)
    const digestPrefs = userProfile.user_digest_preferences || []
    if (digestPrefs.length > 0) {
      const digestText = digestPrefs.map(pref => {
        return pref.digest_type === 'morning' ? '🌅 Morning digest' : '🌇 Evening digest'
      }).join(', ')
      message += `🔔 Digest delivery: ${digestText}\n`
    } else {
      message += `🔔 Notifications: None set\n`
    }
    
    // Status
    message += `📱 Status: ${userProfile.notification_enabled ? '✅ Active' : '❌ Paused'}\n`
    
    message += `\n*Tap any setting below to change it:*`
    
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
    return `❓ *WavePing Help Center* 🆘

🏄‍♂️ *Commands:*
/today - See today's sessions
/tomorrow - Tomorrow's sessions  
/week - Week overview
/prefs - Manage preferences
/setup - Configure alerts
/support - Support the developer
/help - This help message

🔔 *How Notifications Work:*
• Set your preferences (level, times, days)
• Choose notification timing via daily digests
• Get alerts when matching sessions have spots!

📱 *Daily Digests:*
• Morning digest (8 AM) - Plan your day
• Evening digest (6 PM) - Tomorrow's preview
• Choose specific timing that works for you

☕ *Support WavePing:*
If you love using WavePing, consider supporting development!
Use /support to see how you can help.

🆘 *Need More Help?*
Contact @driftwithcaz for assistance!

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

  /**
   * Post-save confirmation message with clear next actions
   */
  createSavedPreferencesMessage(settingType = 'session filters') {
    return `✅ *Saved.* Your ${settingType} are updated.

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
• 🔄 Real-time availability tracking

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