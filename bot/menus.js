/**
 * Bot Menu System
 * Beautiful inline keyboard menus for navigation
 */

const { Markup } = require('telegraf')
const logger = require('../utils/logger').child('Menus')

const menus = {
  /**
   * Main menu - Central navigation hub with session counts
   */
  mainMenu(todayCount = null, tomorrowCount = null) {
    // State-aware button text with counts
    const todayText = todayCount !== null ? `🌊 Today (${todayCount})` : '🌊 Today'
    const tomorrowText = tomorrowCount !== null ? `🌅 Tomorrow (${tomorrowCount})` : '🌅 Tomorrow'
    
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(todayText, 'today'),
        Markup.button.callback(tomorrowText, 'tomorrow')
      ],
      [
        Markup.button.callback('⚙️ Your Setup', 'prefs')
      ],
      [
        Markup.button.callback('🔔 Alerts & Digests', 'alerts')
      ],
      [
        Markup.button.callback('❓ Help & Feedback', 'help')
      ],
      [
        Markup.button.callback('☕ Donate', 'donate')
      ]
    ])
  },

  /**
   * Session viewing menu with individual session booking buttons
   */
  sessionMenu(timeframe, sessions = [], showingCount = null) {
    const buttons = []
    
    logger.debug(`Creating session menu for ${timeframe}`, { sessionCount: sessions.length })
    
    // Bottom row: Book • Refresh only  
    buttons.push([
      Markup.button.url('🏄‍♂️ Book', 'https://ticketing.thewave.com/'),
      Markup.button.callback('🔄 Refresh', `${timeframe}`)
    ])
    
    // Show more button if there are additional sessions
    if (showingCount && sessions.length > showingCount) {
      const remainingCount = sessions.length - showingCount
      buttons.push([
        Markup.button.callback(`Show more (${remainingCount})`, `show_more_${timeframe}`)
      ])
    }
    
    // Navigation
    if (timeframe !== 'today') {
      buttons.push([Markup.button.callback('🌊 Today', 'today')])
    }
    if (timeframe !== 'tomorrow') {
      buttons.push([Markup.button.callback('🌅 Tomorrow', 'tomorrow')])
    }
    
    buttons.push([Markup.button.callback('Main Menu', 'main')])
    
    logger.debug(`Created session menu with ${buttons.length} button rows`)
    const menu = Markup.inlineKeyboard(buttons)
    logger.debug('Menu structure created', { menuStructure: menu.reply_markup })
    
    return menu
  },

  // Week view removed - only today/tomorrow supported

  /**
   * Preferences management menu
   */
  preferencesMenu() {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('👤 Show Current Profile', 'pref_profile_overview')
      ],
      [Markup.button.callback('🎯 Skill Levels', 'pref_levels')],
      [Markup.button.callback('🏄 Wave Sides', 'pref_sides')],
      [Markup.button.callback('📅 Surf Days', 'pref_days')],
      [Markup.button.callback('🕐 Time Windows', 'pref_times')],
      [Markup.button.callback('💺 Min Spots', 'pref_spots')],
      [Markup.button.callback('🔔 Notifications', 'alerts')],
      [Markup.button.callback('📱 Digests', 'pref_digests')],
      [
        Markup.button.callback('🏠 Main Menu', 'main')
      ]
    ])
  },

  /**
   * Notification settings menu
   */
  notificationMenu() {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('⏰ Timing Settings', 'notif_timing'),
        Markup.button.callback('📱 Daily Digests', 'notif_digests')
      ],
      [
        Markup.button.callback('✅ Enable All', 'notif_enable'),
        Markup.button.callback('❌ Disable All', 'notif_disable')
      ],
      [
        Markup.button.callback('🧪 Send Test', 'notif_test'),
        Markup.button.callback('⚙️ Back to Prefs', 'prefs')
      ],
      [
        Markup.button.callback('🏠 Main Menu', 'main')
      ]
    ])
  },

  /**
   * Help menu
   */
  helpMenu() {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('🏠 Main Menu', 'main')
      ]
    ])
  },







  /**
   * Notification timing menu
   */
  notificationTimingMenu(currentTimings = []) {
    const timings = [
      { key: '1w', desc: '📅 1 week' },
      { key: '48h', desc: '🌅 48 hours' },
      { key: '24h', desc: '📅 24 hours' },
      { key: '12h', desc: '🌅 12 hours' },
      { key: '2h', desc: '⏰ 2 hours' }
    ]
    
    const buttons = timings.map(timing => {
      const isSelected = currentTimings.includes(timing.key)
      const text = `${isSelected ? '✅ ' : ''}${timing.desc}`
      return [Markup.button.callback(text, `pref_notification_toggle_${timing.key}`)]
    })
    
    buttons.push(
      [Markup.button.callback('💾 Save Changes', 'notif_timing_save')],
      [Markup.button.callback('🔙 Back to Notifications', 'alerts')]
    )
    
    return Markup.inlineKeyboard(buttons)
  },

  /**
   * Digest preferences menu
   */
  digestMenu(currentDigests = []) {
    const digests = [
      { key: 'morning', desc: '🌅 Morning (8 AM)' },
      { key: 'evening', desc: '🌇 Evening (6 PM)' }
    ]
    
    const buttons = digests.map(digest => {
      const isSelected = currentDigests.includes(digest.key)
      const text = `${isSelected ? '✅ ' : ''}${digest.desc}`
      return [Markup.button.callback(text, `pref_digest_toggle_${digest.key}`)]
    })
    
    buttons.push(
      [Markup.button.callback('💾 Save Changes', 'digest_save')],
      [Markup.button.callback('🔙 Back to Preferences', 'prefs')]
    )
    
    return Markup.inlineKeyboard(buttons)
  },

  /**
   * Confirmation menu for destructive actions
   */
  confirmationMenu(action, returnMenu = 'main') {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Yes, Confirm', `confirm_${action}`),
        Markup.button.callback('❌ Cancel', returnMenu)
      ]
    ])
  },



  /**
   * Setup wizard specific menus
   */
  setupLevelSelectionMenu(currentLevels = []) {
    const levels = [
      { key: 'beginner', name: 'Beginner' },
      { key: 'improver', name: 'Improver' },
      { key: 'intermediate', name: 'Intermediate' },
      { key: 'advanced', name: 'Advanced' },
      { key: 'expert', name: 'Expert' }
    ]
    
    const buttons = levels.map(level => {
      const isSelected = currentLevels.includes(level.key)
      const text = `${isSelected ? '✅ ' : ''}${level.name}`
      return [Markup.button.callback(text, `setup_level_toggle_${level.key}`)]
    })
    
    buttons.push(
      [Markup.button.callback('➡️ Continue', 'setup_level_continue')],
      [Markup.button.callback('🔙 Back to Menu', 'main')]
    )
    
    return Markup.inlineKeyboard(buttons)
  },
  
  setupSideSelectionMenu(currentSides = []) {
    const sides = [
      { key: 'Left', emoji: '🏄‍♂️', name: 'Left Side' },
      { key: 'Right', emoji: '🏄‍♀️', name: 'Right Side' },
      { key: 'Any', emoji: '🌊', name: 'Any Side (I don\'t mind!)' }
    ]
    
    const buttons = sides.map(side => {
      const isSelected = currentSides.includes(side.key)
      const text = `${isSelected ? '✅ ' : ''}${side.emoji} ${side.name}`
      return [Markup.button.callback(text, `setup_side_toggle_${side.key}`)]
    })
    
    buttons.push(
      [Markup.button.callback('➡️ Continue', 'setup_side_continue')]
    )
    
    return Markup.inlineKeyboard(buttons)
  },
  
  setupMinSpotsMenu(currentSpots = 1) {
    const options = [
      { value: 1, desc: "1+ spot (I'll take any!)" },
      { value: 2, desc: '2+ spots' },
      { value: 3, desc: '3+ spots' },
      { value: 5, desc: '5+ spots' },
      { value: 10, desc: '10+ spots (Lots of space)' }
    ]
    
    const buttons = options.map(option => {
      const isSelected = currentSpots === option.value
      const text = `${isSelected ? '✅ ' : ''}💺 ${option.desc}`
      return [Markup.button.callback(text, `setup_spots_${option.value}`)]
    })
    
    return Markup.inlineKeyboard(buttons)
  },
  
  setupDaySelectionMenu(currentDays = []) {
    const days = [
      { key: 0, name: 'Mon' }, { key: 1, name: 'Tue' }, { key: 2, name: 'Wed' },
      { key: 3, name: 'Thu' }, { key: 4, name: 'Fri' }, { key: 5, name: 'Sat' }, { key: 6, name: 'Sun' }
    ]
    
    const buttons = [
      days.slice(0, 4).map(day => {
        const isSelected = currentDays.includes(day.key)
        const text = `${isSelected ? '✅ ' : ''}📅 ${day.name}`
        return Markup.button.callback(text, `setup_day_toggle_${day.key}`)
      }),
      days.slice(4).map(day => {
        const isSelected = currentDays.includes(day.key)
        const text = `${isSelected ? '✅ ' : ''}📅 ${day.name}`
        return Markup.button.callback(text, `setup_day_toggle_${day.key}`)
      })
    ]
    
    buttons.push(
      [Markup.button.callback('➡️ Continue', 'setup_day_continue')]
    )
    
    return Markup.inlineKeyboard(buttons)
  },
  
  setupTimeSelectionMenu(currentTimes = []) {
    const times = [
      { key: 'morning', desc: '🌅 Morning (6 AM - 12 PM)' },
      { key: 'afternoon', desc: '☀️ Afternoon (12 PM - 6 PM)' },
      { key: 'evening', desc: '🌆 Evening (6 PM - 9 PM)' }
    ]
    
    const buttons = times.map(time => {
      const isSelected = currentTimes.includes(time.key)
      const text = `${isSelected ? '✅ ' : ''}${time.desc}`
      return [Markup.button.callback(text, `setup_time_toggle_${time.key}`)]
    })
    
    buttons.push(
      [Markup.button.callback('➡️ Continue', 'setup_time_continue')]
    )
    
    return Markup.inlineKeyboard(buttons)
  },
  
  setupNotificationMenu() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🌅 Morning Digest (8 AM)', 'setup_notif_morning')],
      [Markup.button.callback('🌇 Evening Digest (6 PM)', 'setup_notif_evening')],
      [Markup.button.callback('📱 Both Morning & Evening', 'setup_notif_both')]
    ])
  },

  // Removed post-save menus - no longer needed with simplified flow

  /**
   * Back button utility
   */
  backButton(target = 'main') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Back', target)]
    ])
  }
}

module.exports = menus