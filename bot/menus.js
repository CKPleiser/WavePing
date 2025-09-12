/**
 * Bot Menu System
 * Beautiful inline keyboard menus for navigation
 */

const { Markup } = require('telegraf')

const menus = {
  /**
   * Main menu - Central navigation hub
   */
  mainMenu() {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('🌊 Today', 'menu_today'),
        Markup.button.callback('🌅 Tomorrow', 'menu_tomorrow')
      ],
      [
        Markup.button.callback('⚙️ Preferences', 'menu_preferences')
      ],
      [
        Markup.button.callback('🔔 Notifications', 'menu_notifications'),
        Markup.button.callback('❓ Help', 'menu_help')
      ],
      [
        Markup.button.callback('☕ Support WavePing', 'menu_support')
      ]
    ])
  },

  /**
   * Session viewing menu
   */
  sessionMenu(timeframe, hasMatches) {
    const buttons = []
    
    // Navigation buttons
    if (timeframe !== 'today') {
      buttons.push([Markup.button.callback('🌊 Today', 'menu_today')])
    }
    if (timeframe !== 'tomorrow') {
      buttons.push([Markup.button.callback('🌅 Tomorrow', 'menu_tomorrow')])
    }
    
    // Filter options if user has matches
    if (hasMatches) {
      buttons.push([
        Markup.button.callback('🎯 My Matches Only', `filter_matches_${timeframe}`),
        Markup.button.callback('🌊 Show All', `filter_all_${timeframe}`)
      ])
    }
    
    // Action buttons
    buttons.push([
      Markup.button.callback('🔄 Refresh', `menu_${timeframe}`),
      Markup.button.callback('⚙️ Edit Filters', 'menu_preferences')
    ])
    
    // Bottom navigation
    buttons.push([
      Markup.button.callback('🏠 Main Menu', 'menu_main')
    ])
    
    return Markup.inlineKeyboard(buttons)
  },

  // Week view removed - only today/tomorrow supported

  /**
   * Preferences management menu
   */
  preferencesMenu() {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('🎯 Skill Levels', 'pref_levels'),
        Markup.button.callback('🏄 Wave Sides', 'pref_sides')
      ],
      [
        Markup.button.callback('📅 Surf Days', 'pref_days'),
        Markup.button.callback('🕐 Time Windows', 'pref_times')
      ],
      [
        Markup.button.callback('💺 Min Spots', 'pref_spots'),
        Markup.button.callback('🔔 Notifications', 'menu_notifications')
      ],
      [
        Markup.button.callback('📱 Digests', 'pref_digests'),
        Markup.button.callback('🔄 Reset All', 'pref_reset')
      ],
      [
        Markup.button.callback('🏠 Main Menu', 'menu_main')
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
        Markup.button.callback('⚙️ Back to Prefs', 'menu_preferences')
      ],
      [
        Markup.button.callback('🏠 Main Menu', 'menu_main')
      ]
    ])
  },

  /**
   * Help menu
   */
  helpMenu() {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('🏄‍♂️ Commands', 'help_commands'),
        Markup.button.callback('🔔 Notifications', 'help_notifications')
      ],
      [
        Markup.button.callback('❓ FAQ', 'help_faq'),
        Markup.button.callback('📞 Contact', 'help_contact')
      ],
      [
        Markup.button.callback('🏠 Main Menu', 'menu_main')
      ]
    ])
  },

  /**
   * Quick setup menus
   */
  quickSetupLevelsMenu() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🟢 Beginner', 'setup_quick_level_beginner')],
      [Markup.button.callback('🔵 Improver', 'setup_quick_level_improver')],
      [Markup.button.callback('🟡 Intermediate', 'setup_quick_level_intermediate')],
      [Markup.button.callback('🟠 Advanced', 'setup_quick_level_advanced')],
      [Markup.button.callback('🔴 Expert', 'setup_quick_level_expert')],
      [Markup.button.callback('🔙 Back', 'menu_main')]
    ])
  },

  /**
   * Level selection menu (for preferences)
   */
  levelSelectionMenu(currentLevels = []) {
    const levels = [
      { key: 'beginner', emoji: '🟢', name: 'Beginner' },
      { key: 'improver', emoji: '🔵', name: 'Improver' },
      { key: 'intermediate', emoji: '🟡', name: 'Intermediate' },
      { key: 'advanced', emoji: '🟠', name: 'Advanced' },
      { key: 'expert', emoji: '🔴', name: 'Expert' }
    ]
    
    const buttons = levels.map(level => {
      const isSelected = currentLevels.includes(level.key)
      const text = `${isSelected ? '✅ ' : ''}${level.emoji} ${level.name}`
      return [Markup.button.callback(text, `pref_level_toggle_${level.key}`)]
    })
    
    buttons.push(
      [Markup.button.callback('✅ Save Changes', 'pref_level_save')],
      [Markup.button.callback('🔙 Back to Preferences', 'menu_preferences')]
    )
    
    return Markup.inlineKeyboard(buttons)
  },

  /**
   * Side selection menu
   */
  sideSelectionMenu(currentSides = []) {
    const sides = [
      { key: 'L', emoji: '🏄‍♂️', name: 'Left Side' },
      { key: 'R', emoji: '🏄‍♀️', name: 'Right Side' },
      { key: 'A', emoji: '🌊', name: 'Any Side' }
    ]
    
    const buttons = sides.map(side => {
      const isSelected = currentSides.includes(side.key)
      const text = `${isSelected ? '✅ ' : ''}${side.emoji} ${side.name}`
      return [Markup.button.callback(text, `pref_side_toggle_${side.key}`)]
    })
    
    buttons.push(
      [Markup.button.callback('✅ Save Changes', 'pref_side_save')],
      [Markup.button.callback('🔙 Back to Preferences', 'menu_preferences')]
    )
    
    return Markup.inlineKeyboard(buttons)
  },

  /**
   * Day selection menu
   */
  daySelectionMenu(currentDays = []) {
    const days = [
      { key: 0, name: 'Mon' }, { key: 1, name: 'Tue' }, { key: 2, name: 'Wed' },
      { key: 3, name: 'Thu' }, { key: 4, name: 'Fri' }, { key: 5, name: 'Sat' }, { key: 6, name: 'Sun' }
    ]
    
    const buttons = [
      days.slice(0, 4).map(day => {
        const isSelected = currentDays.includes(day.key)
        const text = `${isSelected ? '✅ ' : ''}${day.name}`
        return Markup.button.callback(text, `pref_day_toggle_${day.key}`)
      }),
      days.slice(4).map(day => {
        const isSelected = currentDays.includes(day.key)
        const text = `${isSelected ? '✅ ' : ''}${day.name}`
        return Markup.button.callback(text, `pref_day_toggle_${day.key}`)
      })
    ]
    
    buttons.push(
      [Markup.button.callback('✅ Save Changes', 'pref_day_save')],
      [Markup.button.callback('🔙 Back to Preferences', 'menu_preferences')]
    )
    
    return Markup.inlineKeyboard(buttons)
  },

  /**
   * Time window selection menu
   */
  timeSelectionMenu(currentTimes = []) {
    const timeWindows = [
      { start: '06:00', end: '09:00', desc: '🌅 Early (6-9 AM)' },
      { start: '09:00', end: '12:00', desc: '🌞 Morning (9-12 PM)' },
      { start: '12:00', end: '15:00', desc: '☀️ Midday (12-3 PM)' },
      { start: '15:00', end: '18:00', desc: '🌤️ Afternoon (3-6 PM)' },
      { start: '18:00', end: '21:00', desc: '🌅 Evening (6-9 PM)' }
    ]
    
    const buttons = timeWindows.map(time => {
      const isSelected = currentTimes.some(ct => 
        ct.start_time === time.start && ct.end_time === time.end
      )
      const text = `${isSelected ? '✅ ' : ''}${time.desc}`
      return [Markup.button.callback(text, `pref_time_toggle_${time.start}_${time.end}`)]
    })
    
    buttons.push(
      [Markup.button.callback('✅ Save Changes', 'pref_time_save')],
      [Markup.button.callback('➕ Custom Time', 'pref_time_custom')],
      [Markup.button.callback('🔙 Back to Preferences', 'menu_preferences')]
    )
    
    return Markup.inlineKeyboard(buttons)
  },

  /**
   * Min spots selection menu
   */
  minSpotsMenu(currentMinSpots = 1) {
    const options = [
      { value: 1, desc: "1+ (I'll take any spot!)" },
      { value: 2, desc: '2+ (Small group)' },
      { value: 3, desc: '3+ (Want options)' },
      { value: 5, desc: '5+ (Plenty of space)' },
      { value: 10, desc: '10+ (Lots of availability)' }
    ]
    
    const buttons = options.map(option => {
      const isSelected = currentMinSpots === option.value
      const text = `${isSelected ? '✅ ' : ''}${option.desc}`
      return [Markup.button.callback(text, `pref_spots_set_${option.value}`)]
    })
    
    buttons.push(
      [Markup.button.callback('🔙 Back to Preferences', 'menu_preferences')]
    )
    
    return Markup.inlineKeyboard(buttons)
  },

  /**
   * Notification timing menu
   */
  notificationTimingMenu(currentTimings = []) {
    const timings = [
      { key: '24h', desc: '📅 24 hours before' },
      { key: '12h', desc: '🌅 12 hours before' },
      { key: '6h', desc: '⏰ 6 hours before' },
      { key: '3h', desc: '⚡ 3 hours before' },
      { key: '1h', desc: '🚨 1 hour before' }
    ]
    
    const buttons = timings.map(timing => {
      const isSelected = currentTimings.includes(timing.key)
      const text = `${isSelected ? '✅ ' : ''}${timing.desc}`
      return [Markup.button.callback(text, `notif_timing_toggle_${timing.key}`)]
    })
    
    buttons.push(
      [Markup.button.callback('✅ Save Changes', 'notif_timing_save')],
      [Markup.button.callback('🔙 Back to Notifications', 'menu_notifications')]
    )
    
    return Markup.inlineKeyboard(buttons)
  },

  /**
   * Digest preferences menu
   */
  digestMenu(currentDigests = []) {
    const digests = [
      { key: 'morning', desc: '🌅 Morning Digest (8 AM)' },
      { key: 'evening', desc: '🌇 Evening Digest (6 PM)' }
    ]
    
    const buttons = digests.map(digest => {
      const isSelected = currentDigests.includes(digest.key)
      const text = `${isSelected ? '✅ ' : ''}${digest.desc}`
      return [Markup.button.callback(text, `notif_digest_toggle_${digest.key}`)]
    })
    
    buttons.push(
      [Markup.button.callback('✅ Save Changes', 'notif_digest_save')],
      [Markup.button.callback('🔙 Back to Notifications', 'menu_notifications')]
    )
    
    return Markup.inlineKeyboard(buttons)
  },

  /**
   * Confirmation menu for destructive actions
   */
  confirmationMenu(action, returnMenu = 'menu_main') {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Yes, Confirm', `confirm_${action}`),
        Markup.button.callback('❌ Cancel', returnMenu)
      ]
    ])
  },

  /**
   * Quick setup time menu (simplified)
   */
  quickSetupTimeMenu() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🌅 Early Bird (6-12 PM)', 'setup_quick_time_morning')],
      [Markup.button.callback('☀️ Afternoon Rider (12-6 PM)', 'setup_quick_time_afternoon')],
      [Markup.button.callback('🌇 Evening Surfer (6-9 PM)', 'setup_quick_time_evening')],
      [Markup.button.callback('🌊 Any Time is Good!', 'setup_quick_time_any')]
    ])
  },

  /**
   * Quick setup notifications menu
   */
  quickSetupNotificationsMenu() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('📅 24h before (recommended)', 'setup_quick_notif_24h')],
      [Markup.button.callback('🌅 12h before', 'setup_quick_notif_12h')],
      [Markup.button.callback('⏰ 6h before', 'setup_quick_notif_6h')],
      [Markup.button.callback('🌊 Daily digest only', 'setup_quick_notif_digest')]
    ])
  },

  /**
   * Setup wizard specific menus
   */
  setupLevelSelectionMenu(currentLevels = []) {
    const levels = [
      { key: 'beginner', emoji: '🟢', name: 'Beginner' },
      { key: 'improver', emoji: '🔵', name: 'Improver' },
      { key: 'intermediate', emoji: '🟡', name: 'Intermediate' },
      { key: 'advanced', emoji: '🟠', name: 'Advanced' },
      { key: 'expert', emoji: '🔴', name: 'Expert' }
    ]
    
    const buttons = levels.map(level => {
      const isSelected = currentLevels.includes(level.key)
      const text = `${isSelected ? '✅ ' : ''}${level.emoji} ${level.name}`
      return [Markup.button.callback(text, `setup_level_toggle_${level.key}`)]
    })
    
    buttons.push(
      [Markup.button.callback('➡️ Continue to Step 2', 'setup_level_continue')],
      [Markup.button.callback('🔙 Back to Menu', 'menu_main')]
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
      [Markup.button.callback('➡️ Continue to Step 3', 'setup_side_continue')]
    )
    
    return Markup.inlineKeyboard(buttons)
  },
  
  setupMinSpotsMenu(currentSpots = 1) {
    const options = [
      { value: 1, desc: "1+ spot (I'll take any!)" },
      { value: 2, desc: '2+ spots (Small group)' },
      { value: 5, desc: '5+ spots (Want options)' },
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
      [Markup.button.callback('➡️ Continue to Step 5', 'setup_day_continue')]
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
      [Markup.button.callback('➡️ Continue to Step 6', 'setup_time_continue')]
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

  /**
   * Back button utility
   */
  backButton(target = 'menu_main') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Back', target)]
    ])
  }
}

module.exports = menus