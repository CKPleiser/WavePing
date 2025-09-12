/**
 * Bot Callback Handlers
 * Handles all inline keyboard button presses and interactions
 */

const { Markup } = require('telegraf')
const menus = require('./menus')
const ui = require('./ui')
const commands = require('./commands')
const { WaveScheduleScraper } = require('../lib/wave-scraper-final')
const { checkRateLimit } = require('../utils/telegram-helpers')
// BotHandler methods will be passed as parameters to avoid circular dependency

// Utility function for getting user profile
async function getUserProfile(supabase, telegramId) {
  const { data, error } = await supabase
    .from('profiles')
    .select(`
      *,
      user_levels (level),
      user_sides (side),
      user_days (day_of_week),
      user_time_windows (start_time, end_time),
      user_notifications (timing),
      user_digest_preferences (digest_type)
    `)
    .eq('telegram_id', telegramId)
    .single()
  
  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching user profile', { error, telegramId })
    return null
  }
  
  return data
}

async function createUserProfile(supabase, telegramId, username = null) {
  const { data, error } = await supabase
    .from('profiles')
    .insert({
      telegram_id: telegramId,
      telegram_username: username,
      notification_enabled: true,
      min_spots: 1
    })
    .select()
    .single()
  
  if (error) {
    console.error('Error creating user profile', { error, telegramId })
    return null
  }
  
  return data
}

const callbacks = {
  /**
   * Menu navigation callbacks
   */
  async menu(supabase, ctx) {
    const action = ctx.match[1] // Extract menu type from regex match
    
    try {
      switch (action) {
        case 'main':
          const mainMessage = ui.mainMenuMessage()
          return ctx.editMessageText(mainMessage, {
            parse_mode: 'Markdown',
            reply_markup: menus.mainMenu()
          })
          
        case 'today':
          return commands.today(supabase, ctx)
          
        case 'tomorrow':
          return commands.tomorrow(supabase, ctx)
          
        case 'week':
          return commands.week(supabase, ctx)
          
        case 'preferences':
          return commands.preferences(supabase, ctx)
          
        case 'notifications':
          return commands.notifications(supabase, ctx)
          
        case 'help':
          const helpMessage = ui.helpMessage()
          return ctx.editMessageText(helpMessage, {
            parse_mode: 'Markdown',
            reply_markup: menus.helpMenu()
          })
          
        default:
          return ctx.answerCbQuery('Unknown menu option')
      }
    } catch (error) {
      console.error('Menu callback error:', error)
      return ctx.answerCbQuery('Error loading menu')
    }
  },

  /**
   * Preferences management callbacks
   */
  async preferences(supabase, ctx) {
    const action = ctx.match[1]
    const telegramId = ctx.from.id
    
    try {
      const userProfile = await getUserProfile(supabase, telegramId)
      
      if (!userProfile) {
        return ctx.answerCbQuery('Please run /setup first!')
      }
      
      switch (action) {
        case 'levels':
          const currentLevels = userProfile.user_levels?.map(ul => ul.level) || []
          return ctx.editMessageText(
            '🎯 *Select Your Skill Levels*\n\nChoose all levels you\'re comfortable surfing:',
            {
              parse_mode: 'Markdown',
              reply_markup: menus.levelSelectionMenu(currentLevels)
            }
          )
          
        case 'sides':
          const currentSides = userProfile.user_sides?.map(us => us.side) || []
          return ctx.editMessageText(
            '🏄 *Select Wave Sides*\n\nWhich side(s) do you prefer?',
            {
              parse_mode: 'Markdown', 
              reply_markup: menus.sideSelectionMenu(currentSides)
            }
          )
          
        case 'days':
          const currentDays = userProfile.user_days?.map(ud => ud.day_of_week) || []
          return ctx.editMessageText(
            '📅 *Select Surf Days*\n\nWhich days can you surf?',
            {
              parse_mode: 'Markdown',
              reply_markup: menus.daySelectionMenu(currentDays)
            }
          )
          
        case 'times':
          const currentTimes = userProfile.user_time_windows || []
          return ctx.editMessageText(
            '🕐 *Select Time Windows*\n\nWhen do you prefer to surf?',
            {
              parse_mode: 'Markdown',
              reply_markup: menus.timeSelectionMenu(currentTimes)
            }
          )
          
        case 'spots':
          return ctx.editMessageText(
            '💺 *Minimum Available Spots*\n\nHow many spots should be available?',
            {
              parse_mode: 'Markdown',
              reply_markup: menus.minSpotsMenu(userProfile.min_spots || 1)
            }
          )
          
        case 'digests':
          const currentDigests = userProfile.user_digest_preferences?.map(dp => dp.digest_type) || []
          return ctx.editMessageText(
            '📱 *Daily Digests*\n\nWhen would you like daily summaries?',
            {
              parse_mode: 'Markdown',
              reply_markup: menus.digestMenu(currentDigests)
            }
          )
          
        case 'reset':
          return ctx.editMessageText(
            '⚠️ *Reset All Preferences*\n\nThis will delete ALL your preferences and start fresh.\n\nAre you sure?',
            {
              parse_mode: 'Markdown',
              reply_markup: menus.confirmationMenu('reset_all', 'menu_preferences')
            }
          )
          
        // Level toggles
        case 'level_toggle_beginner':
        case 'level_toggle_improver':
        case 'level_toggle_intermediate':
        case 'level_toggle_advanced':
        case 'level_toggle_expert':
          const levelToToggle = action.split('_')[2]
          return await this.toggleUserLevel(supabase, ctx, userProfile, levelToToggle)
          
        // Save level changes
        case 'level_save':
          ctx.answerCbQuery('✅ Skill levels saved!')
          return commands.preferences(supabase, ctx)
          
        default:
          return ctx.answerCbQuery('Unknown preference option')
      }
    } catch (error) {
      console.error('Preferences callback error:', error)
      return ctx.answerCbQuery('Error updating preferences')
    }
  },

  /**
   * Setup workflow callbacks
   */
  async setup(supabase, ctx) {
    const action = ctx.match[1]
    const telegramId = ctx.from.id
    
    try {
      let userProfile = await getUserProfile(supabase, telegramId)
      
      if (!userProfile) {
        userProfile = await createUserProfile(supabase, telegramId, ctx.from.username)
      }
      
      switch (action) {
        case 'quick':
          return commands.quickSetup(supabase, ctx)
          
        case 'detailed':
          return ctx.editMessageText(
            '⚙️ *Detailed Setup*\n\nLet\'s configure everything step by step.\n\nStarting with your skill level:',
            {
              parse_mode: 'Markdown',
              reply_markup: menus.levelSelectionMenu()
            }
          )
          
        case 'quick_level_beginner':
        case 'quick_level_improver':
        case 'quick_level_intermediate':
        case 'quick_level_advanced':
        case 'quick_level_expert':
          const level = action.split('_')[2]
          await this.setUserLevel(supabase, userProfile, level)
          
          return ctx.editMessageText(
            `✅ *Level Set: ${ui.capitalizeWords(level)}*\n\n🕐 *Step 2 of 3: Preferred Times*\n\nWhen do you like to surf?`,
            {
              parse_mode: 'Markdown',
              reply_markup: menus.quickSetupTimeMenu()
            }
          )
          
        case 'quick_time_morning':
        case 'quick_time_afternoon':
        case 'quick_time_evening':
        case 'quick_time_any':
          const timePreference = action.split('_')[2]
          await this.setUserTimePreference(supabase, userProfile, timePreference)
          
          return ctx.editMessageText(
            `✅ *Time Preference Set*\n\n🔔 *Step 3 of 3: Notifications*\n\nWhen should I remind you about matching sessions?`,
            {
              parse_mode: 'Markdown',
              reply_markup: menus.quickSetupNotificationsMenu()
            }
          )
          
        case 'quick_notif_24h':
        case 'quick_notif_12h':
        case 'quick_notif_6h':
        case 'quick_notif_digest':
          const notifTiming = action.split('_')[2]
          await this.setUserNotificationPreference(supabase, userProfile, notifTiming)
          
          return ctx.editMessageText(
            `🎉 *Setup Complete!* 🎉\n\n✅ Profile configured\n✅ Preferences set\n✅ Notifications enabled\n\n*You're all set!*\n\nTry /today to see your personalized session matches! 🌊`,
            {
              parse_mode: 'Markdown',
              reply_markup: menus.mainMenu()
            }
          )
          
        default:
          return ctx.answerCbQuery('Unknown setup option')
      }
    } catch (error) {
      console.error('Setup callback error:', error)
      return ctx.answerCbQuery('Setup error occurred')
    }
  },

  /**
   * Session filtering callbacks
   */
  async filters(supabase, ctx) {
    const action = ctx.match[1]
    
    try {
      switch (action) {
        case 'matches_today':
        case 'matches_tomorrow':
          const timeframe = action.split('_')[1]
          return timeframe === 'today' ? commands.today(supabase, ctx) : commands.tomorrow(supabase, ctx)
          
        case 'all_today':
        case 'all_tomorrow':
          // Show all sessions without user filtering
          const allTimeframe = action.split('_')[1]
          return this.showAllSessions(supabase, ctx, allTimeframe)
          
        default:
          return ctx.answerCbQuery('Unknown filter option')
      }
    } catch (error) {
      console.error('Filter callback error:', error)
      return ctx.answerCbQuery('Filter error occurred')
    }
  },

  /**
   * Session management callbacks
   */
  async sessions(supabase, ctx) {
    const action = ctx.match[1]
    return ctx.answerCbQuery('Session action not implemented yet')
  },

  /**
   * Pagination callbacks
   */
  async pagination(supabase, ctx) {
    const action = ctx.match[1]
    const page = parseInt(ctx.match[2])
    return ctx.answerCbQuery(`Pagination: ${action} page ${page}`)
  },

  /**
   * General back navigation
   */
  back(ctx) {
    return ctx.editMessageText(
      ui.mainMenuMessage(),
      {
        parse_mode: 'Markdown',
        reply_markup: menus.mainMenu()
      }
    )
  },

  /**
   * Back to specific menu navigation
   */
  async backTo(supabase, ctx) {
    const target = ctx.match[1]
    return ctx.answerCbQuery(`Back to ${target} not implemented yet`)
  },

  /**
   * Utility methods
   */
  async toggleUserLevel(supabase, ctx, userProfile, level) {
    try {
      // Check if level exists
      const { data: existingLevel } = await supabase
        .from('user_levels')
        .select('id')
        .eq('user_id', userProfile.id)
        .eq('level', level)
        .single()

      if (existingLevel) {
        // Remove level
        await supabase
          .from('user_levels')
          .delete()
          .eq('id', existingLevel.id)
      } else {
        // Add level
        await supabase
          .from('user_levels')
          .insert({
            user_id: userProfile.id,
            level: level
          })
      }

      // Refresh the menu with updated selections
      const updatedProfile = await getUserProfile(supabase, ctx.from.id)
      const currentLevels = updatedProfile.user_levels?.map(ul => ul.level) || []
      
      return ctx.editMessageReplyMarkup(
        menus.levelSelectionMenu(currentLevels).reply_markup
      )
    } catch (error) {
      console.error('Toggle level error:', error)
      return ctx.answerCbQuery('Error updating level')
    }
  },

  async setUserLevel(supabase, userProfile, level) {
    // Clear existing levels and set new one for quick setup
    await supabase
      .from('user_levels')
      .delete()
      .eq('user_id', userProfile.id)

    await supabase
      .from('user_levels')
      .insert({
        user_id: userProfile.id,
        level: level
      })
  },

  async setUserTimePreference(supabase, userProfile, timePreference) {
    // Clear existing time windows
    await supabase
      .from('user_time_windows')
      .delete()
      .eq('user_id', userProfile.id)

    // Set based on preference
    const timeWindows = {
      morning: [{ start_time: '06:00', end_time: '12:00' }],
      afternoon: [{ start_time: '12:00', end_time: '18:00' }],
      evening: [{ start_time: '18:00', end_time: '21:00' }],
      any: [
        { start_time: '06:00', end_time: '12:00' },
        { start_time: '12:00', end_time: '18:00' },
        { start_time: '18:00', end_time: '21:00' }
      ]
    }

    const windows = timeWindows[timePreference] || timeWindows.any
    
    for (const window of windows) {
      await supabase
        .from('user_time_windows')
        .insert({
          user_id: userProfile.id,
          start_time: window.start_time,
          end_time: window.end_time
        })
    }
  },

  async setUserNotificationPreference(supabase, userProfile, timing) {
    // Clear existing notifications
    await supabase
      .from('user_notifications')
      .delete()
      .eq('user_id', userProfile.id)

    if (timing === 'digest') {
      // Set up digest preference instead
      await supabase
        .from('user_digest_preferences')
        .upsert({
          user_id: userProfile.id,
          digest_type: 'morning'
        })
    } else {
      // Set notification timing
      await supabase
        .from('user_notifications')
        .insert({
          user_id: userProfile.id,
          timing: timing
        })
    }
  },

  async showAllSessions(supabase, ctx, timeframe) {
    const scraper = new WaveScheduleScraper()
    
    try {
      const sessions = timeframe === 'today' 
        ? await scraper.getTodaysSessions()
        : await scraper.getTomorrowsSessions()

      const allAvailableSessions = sessions.filter(s => (s.spots_available || 0) > 0)
      
      const sessionMessage = ui.createSessionsMessage(
        timeframe === 'today' ? 'Today' : 'Tomorrow',
        allAvailableSessions,
        allAvailableSessions,
        null
      )
      
      return ctx.editMessageText(sessionMessage, {
        parse_mode: 'Markdown',
        reply_markup: menus.sessionMenu(timeframe, false)
      })
    } catch (error) {
      return ctx.editMessageText(
        `❌ Error loading ${timeframe}'s sessions. Please try again.`,
        {
          reply_markup: menus.sessionMenu(timeframe, false)
        }
      )
    }
  }
}

module.exports = callbacks