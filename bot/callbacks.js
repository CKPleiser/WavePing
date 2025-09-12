/**
 * Bot Callback Handlers
 * Handles all inline keyboard button presses and interactions
 */

const { Markup } = require('telegraf')
const menus = require('./menus')
const ui = require('./ui')
const commands = require('./commands')
const { WaveScheduleScraper } = require('../lib/wave-scraper-final')
// checkRateLimit was removed as it was unused
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
    console.log(`🔧 Menu callback triggered: ${action}`, { userId: ctx.from.id })
    
    // CRITICAL: Answer callback query first to remove loading state
    await ctx.answerCbQuery()
    
    try {
      switch (action) {
        case 'main':
          const mainMessage = ui.mainMenuMessage()
          return await ctx.editMessageText(mainMessage, {
            parse_mode: 'Markdown',
            reply_markup: menus.mainMenu()
          })
          
        case 'today':
          return commands.today(supabase, ctx)
          
        case 'tomorrow':
          return commands.tomorrow(supabase, ctx)
          
        // Week view removed - only today/tomorrow supported
          
        case 'preferences':
        case 'menu_preferences':
          return commands.preferences(supabase, ctx)
          
        case 'notifications':
          return commands.notifications(supabase, ctx)
          
        case 'help':
          const helpMessage = ui.helpMessage()
          return await ctx.editMessageText(helpMessage, {
            parse_mode: 'Markdown',
            reply_markup: menus.helpMenu()
          })
          
        case 'support':
          const supportMessage = ui.supportMessage()
          return await ctx.editMessageText(supportMessage, {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.url('☕ Buy Me a Coffee', 'https://buymeacoffee.com/waveping')],
              [Markup.button.url('💖 GitHub Sponsors', 'https://github.com/sponsors/waveping')],
              [Markup.button.callback('💬 Contact Developer', 'support_contact')],
              [Markup.button.callback('📈 Feature Request', 'support_feature')],
              [Markup.button.callback('🏠 Main Menu', 'menu_main')]
            ])
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
    console.log(`⚙️ Preferences callback triggered: ${action}`, { userId: telegramId })
    
    // CRITICAL: Answer callback query first
    await ctx.answerCbQuery()
    
    try {
      const userProfile = await getUserProfile(supabase, telegramId)
      
      if (!userProfile) {
        // Don't call answerCbQuery again since we already called it
        return
      }
      
      switch (action) {
        case 'levels':
          const currentLevels = userProfile.user_levels?.map(ul => ul.level) || []
          const levels = ['beginner', 'improver', 'intermediate', 'advanced', 'expert']
          const levelButtons = levels.map(level => {
            const isSelected = currentLevels.includes(level)
            const emoji = level === 'beginner' ? '🟢' : level === 'improver' ? '🔵' : level === 'intermediate' ? '🟡' : level === 'advanced' ? '🟠' : '🔴'
            const text = `${isSelected ? '✅ ' : ''}${emoji} ${level.charAt(0).toUpperCase() + level.slice(1)}`
            return [{ text, callback_data: `pref_level_toggle_${level}` }]
          })
          levelButtons.push([{ text: '✅ Save Changes', callback_data: 'pref_level_save' }])
          levelButtons.push([{ text: '🔙 Back', callback_data: 'menu_preferences' }])
          
          return ctx.editMessageText(
            '🎯 *Select Your Skill Levels*\n\nChoose all levels you\'re comfortable surfing:',
            {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: levelButtons }
            }
          )
          
        case 'sides':
          const currentSides = userProfile.user_sides?.map(us => us.side) || []
          const sideButtons = [
            [{ text: `${currentSides.includes('L') ? '✅ ' : ''}🏄‍♂️ Left Side`, callback_data: 'pref_side_toggle_L' }],
            [{ text: `${currentSides.includes('R') ? '✅ ' : ''}🏄‍♀️ Right Side`, callback_data: 'pref_side_toggle_R' }],
            [{ text: `${currentSides.includes('A') ? '✅ ' : ''}🌊 Any Side`, callback_data: 'pref_side_toggle_A' }],
            [{ text: '✅ Save Changes', callback_data: 'pref_side_save' }],
            [{ text: '🔙 Back', callback_data: 'menu_preferences' }]
          ]
          
          return ctx.editMessageText(
            '🏄 *Select Wave Sides*\n\nWhich side(s) do you prefer?',
            {
              parse_mode: 'Markdown', 
              reply_markup: { inline_keyboard: sideButtons }
            }
          )
          
        case 'days':
          const currentDays = userProfile.user_days?.map(ud => ud.day_of_week) || []
          const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
          const dayButtons = days.map((day, index) => {
            const isSelected = currentDays.includes(index)
            const text = `${isSelected ? '✅ ' : ''}📅 ${day}`
            return [{ text, callback_data: `pref_day_toggle_${index}` }]
          })
          dayButtons.push([{ text: '✅ Save Changes', callback_data: 'pref_day_save' }])
          dayButtons.push([{ text: '🔙 Back', callback_data: 'menu_preferences' }])
          
          return ctx.editMessageText(
            '📅 *Select Surf Days*\n\nWhich days can you surf?',
            {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: dayButtons }
            }
          )
          
        case 'times':
          const currentTimes = userProfile.user_time_windows || []
          const timeWindows = [
            { start: '06:00', end: '09:00', desc: '🌅 Early (6-9 AM)' },
            { start: '09:00', end: '12:00', desc: '🌞 Morning (9-12 PM)' },
            { start: '12:00', end: '15:00', desc: '☀️ Midday (12-3 PM)' },
            { start: '15:00', end: '18:00', desc: '🌤️ Afternoon (3-6 PM)' },
            { start: '18:00', end: '21:00', desc: '🌅 Evening (6-9 PM)' }
          ]
          const timeButtons = timeWindows.map(time => {
            const isSelected = currentTimes.some(ct => ct.start_time === time.start && ct.end_time === time.end)
            const text = `${isSelected ? '✅ ' : ''}${time.desc}`
            return [{ text, callback_data: `pref_time_toggle_${time.start}_${time.end}` }]
          })
          timeButtons.push([{ text: '✅ Save Changes', callback_data: 'pref_time_save' }])
          timeButtons.push([{ text: '🔙 Back', callback_data: 'menu_preferences' }])
          
          return ctx.editMessageText(
            '🕐 *Select Time Windows*\n\nWhen do you prefer to surf?',
            {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: timeButtons }
            }
          )
          
        case 'spots':
          const currentMinSpots = userProfile.min_spots || 1
          const spotOptions = [
            { value: 1, desc: "1+ (I'll take any spot!)" },
            { value: 2, desc: '2+ (Small group)' },
            { value: 3, desc: '3+ (Want options)' },
            { value: 5, desc: '5+ (Plenty of space)' },
            { value: 10, desc: '10+ (Lots of availability)' }
          ]
          const spotButtons = spotOptions.map(option => {
            const isSelected = currentMinSpots === option.value
            const text = `${isSelected ? '✅ ' : ''}${option.desc}`
            return [{ text, callback_data: `pref_spots_set_${option.value}` }]
          })
          spotButtons.push([{ text: '🔙 Back', callback_data: 'menu_preferences' }])
          
          return ctx.editMessageText(
            '💺 *Minimum Available Spots*\n\nHow many spots should be available?',
            {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: spotButtons }
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
              reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('✅ Yes, Reset Everything', 'confirm_reset_all')],
                [Markup.button.callback('❌ Cancel', 'menu_preferences')]
              ])
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
          
        // Side toggles
        case 'side_toggle_L':
        case 'side_toggle_R':
        case 'side_toggle_A':
          const sideToToggle = action.split('_')[2]
          return await this.toggleUserSide(supabase, ctx, userProfile, sideToToggle)
          
        case 'side_save':
          ctx.answerCbQuery('✅ Wave sides saved!')
          return commands.preferences(supabase, ctx)
          
        // Day toggles
        case 'day_toggle_0':
        case 'day_toggle_1':
        case 'day_toggle_2':
        case 'day_toggle_3':
        case 'day_toggle_4':
        case 'day_toggle_5':
        case 'day_toggle_6':
          const dayToToggle = parseInt(action.split('_')[2])
          return await this.toggleUserDay(supabase, ctx, userProfile, dayToToggle)
          
        case 'day_save':
          ctx.answerCbQuery('✅ Surf days saved!')
          return commands.preferences(supabase, ctx)
          
        // Time toggles
        case 'time_toggle_06:00_09:00':
        case 'time_toggle_09:00_12:00':
        case 'time_toggle_12:00_15:00':
        case 'time_toggle_15:00_18:00':
        case 'time_toggle_18:00_21:00':
          const [_, __, startTime, endTime] = action.split('_')
          return await this.toggleUserTimeWindow(supabase, ctx, userProfile, startTime, endTime)
          
        case 'time_save':
          ctx.answerCbQuery('✅ Time windows saved!')
          return commands.preferences(supabase, ctx)
          
        // Min spots selection
        case 'spots_set_1':
        case 'spots_set_2':
        case 'spots_set_3':
        case 'spots_set_5':
        case 'spots_set_10':
          const spotCount = parseInt(action.split('_')[2])
          await supabase.from('profiles').update({
            min_spots: spotCount
          }).eq('id', userProfile.id)
          
          ctx.answerCbQuery(`✅ Minimum spots set to ${spotCount}!`)
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
   * Notification management callbacks
   */
  async notifications(supabase, ctx) {
    const action = ctx.match[1]
    const telegramId = ctx.from.id
    
    // CRITICAL: Answer callback query first
    await ctx.answerCbQuery()
    
    try {
      const userProfile = await getUserProfile(supabase, telegramId)
      
      if (!userProfile) {
        // Don't call answerCbQuery again since we already called it
        return
      }
      
      switch (action) {
        case 'enable':
          await supabase.from('profiles').update({
            notification_enabled: true
          }).eq('id', userProfile.id)
          
          ctx.answerCbQuery('✅ Notifications enabled!')
          return commands.notifications(supabase, ctx)
          
        case 'disable':
          await supabase.from('profiles').update({
            notification_enabled: false
          }).eq('id', userProfile.id)
          
          ctx.answerCbQuery('❌ Notifications disabled!')
          return commands.notifications(supabase, ctx)
          
        case 'test':
          const testMessage = `🧪 *Test Notification* 🔔\n\nThis is a test to make sure your WavePing notifications are working!\n\nIf you can see this message, everything is working perfectly! 🎉`
          
          await ctx.reply(testMessage, { parse_mode: 'Markdown' })
          return ctx.answerCbQuery('📤 Test notification sent!')
          
        case 'digest_toggle_morning':
        case 'digest_toggle_evening':
          const digestType = action.split('_')[2]
          return await this.toggleDigestPreference(supabase, ctx, userProfile, digestType)
          
        case 'digest_save':
          ctx.answerCbQuery('✅ Digest preferences saved!')
          return commands.notifications(supabase, ctx)
          
        default:
          return ctx.answerCbQuery('Unknown notification option')
      }
    } catch (error) {
      console.error('Notification callback error:', error)
      return ctx.answerCbQuery('Error updating notifications')
    }
  },

  /**
   * Setup workflow callbacks - Complete 6-step guided wizard
   */
  async setup(supabase, ctx) {
    const action = ctx.match[1]
    const telegramId = ctx.from.id
    console.log(`🚀 Setup callback triggered: ${action}`, { userId: telegramId })
    
    // CRITICAL: Answer callback query first
    await ctx.answerCbQuery()
    
    try {
      let userProfile = await getUserProfile(supabase, telegramId)
      
      if (!userProfile) {
        userProfile = await createUserProfile(supabase, telegramId, ctx.from.username)
      }
      
      switch (action) {
        case 'quick':
        case 'restart':
          // Start session for 6-step wizard
          ctx.session = ctx.session || {}
          ctx.session.setup = {
            step: 'levels',
            levels: [],
            sides: [],
            days: [],
            timeWindows: [],
            notifications: [],
            minSpots: 1
          }
          
          return ctx.editMessageText(
            '🚀 *Setup Wizard Started!* ⚡\n\n*Step 1 of 6: Skill Levels*\n\nChoose all levels you\'re comfortable surfing with:',
            {
              parse_mode: 'Markdown',
              reply_markup: menus.setupLevelSelectionMenu([])
            }
          )
          
        case 'detailed':
          return ctx.editMessageText(
            '⚙️ *Detailed Setup*\n\nLet\'s configure everything step by step.\n\nStarting with your skill level:',
            {
              parse_mode: 'Markdown',
              reply_markup: menus.levelSelectionMenu()
            }
          )
          
        // Setup wizard level toggles
        case 'setup_level_toggle_beginner':
        case 'setup_level_toggle_improver':
        case 'setup_level_toggle_intermediate':
        case 'setup_level_toggle_advanced':
        case 'setup_level_toggle_expert':
          const levelToToggle = action.split('_')[3]
          return this.toggleSetupLevel(supabase, ctx, levelToToggle)
          
        case 'setup_level_continue':
          if (!ctx.session?.setup?.levels?.length) {
            return ctx.answerCbQuery('⚠️ Please select at least one skill level!')
          }
          
          return ctx.editMessageText(
            `✅ *Levels Selected*\n\n*Step 2 of 6: Wave Sides*\n\nWhich side do you prefer to surf?`,
            {
              parse_mode: 'Markdown',
              reply_markup: menus.setupSideSelectionMenu([])
            }
          )
          
        // Setup wizard side toggles
        case 'setup_side_toggle_Left':
        case 'setup_side_toggle_Right':
        case 'setup_side_toggle_Any':
          const sideToToggle = action.split('_')[3]
          return this.toggleSetupSide(supabase, ctx, sideToToggle)
          
        case 'setup_side_continue':
          if (!ctx.session?.setup?.sides?.length) {
            ctx.session.setup.sides = ['Any'] // Default to any if none selected
          }
          
          return ctx.editMessageText(
            `✅ *Wave Sides Selected*\n\n*Step 3 of 6: Minimum Spots*\n\nHow many available spots do you need?`,
            {
              parse_mode: 'Markdown',
              reply_markup: menus.setupMinSpotsMenu(1)
            }
          )
          
        // Setup wizard min spots
        case 'setup_spots_1':
        case 'setup_spots_2':
        case 'setup_spots_5':
        case 'setup_spots_10':
          const spotCount = parseInt(action.split('_')[2])
          ctx.session.setup.minSpots = spotCount
          
          return ctx.editMessageText(
            `✅ *Minimum Spots: ${spotCount}*\n\n*Step 4 of 6: Surf Days*\n\nWhich days can you surf?`,
            {
              parse_mode: 'Markdown',
              reply_markup: menus.setupDaySelectionMenu([])
            }
          )
          
        // Setup wizard day toggles
        case 'setup_day_toggle_0':
        case 'setup_day_toggle_1':
        case 'setup_day_toggle_2':
        case 'setup_day_toggle_3':
        case 'setup_day_toggle_4':
        case 'setup_day_toggle_5':
        case 'setup_day_toggle_6':
          const dayToToggle = parseInt(action.split('_')[3])
          return this.toggleSetupDay(supabase, ctx, dayToToggle)
          
        case 'setup_day_continue':
          if (!ctx.session?.setup?.days?.length) {
            ctx.session.setup.days = [0,1,2,3,4,5,6] // Default to all days
          }
          
          return ctx.editMessageText(
            `✅ *Surf Days Selected*\n\n*Step 5 of 6: Time Windows*\n\nWhen do you prefer to surf?`,
            {
              parse_mode: 'Markdown',
              reply_markup: menus.setupTimeSelectionMenu([])
            }
          )
          
        // Setup wizard time toggles
        case 'setup_time_toggle_morning':
        case 'setup_time_toggle_afternoon':
        case 'setup_time_toggle_evening':
          const timeToToggle = action.split('_')[3]
          return this.toggleSetupTime(supabase, ctx, timeToToggle)
          
        case 'setup_time_continue':
          if (!ctx.session?.setup?.timeWindows?.length) {
            // Default to all times if none selected
            ctx.session.setup.timeWindows = [
              { start_time: '06:00', end_time: '09:00' },
              { start_time: '09:00', end_time: '12:00' },
              { start_time: '12:00', end_time: '15:00' },
              { start_time: '15:00', end_time: '18:00' },
              { start_time: '18:00', end_time: '21:00' }
            ]
          }
          
          return ctx.editMessageText(
            `✅ *Time Windows Selected*\n\n*Step 6 of 6: Notifications*\n\nHow would you like to be notified?`,
            {
              parse_mode: 'Markdown',
              reply_markup: menus.setupNotificationMenu()
            }
          )
          
        // Setup wizard notifications
        case 'setup_notif_morning':
        case 'setup_notif_evening':
        case 'setup_notif_both':
          const notifChoice = action.split('_')[2]
          
          // Save all preferences to database
          await this.saveSetupWizard(supabase, userProfile, ctx.session.setup, notifChoice)
          
          // Clear session
          delete ctx.session.setup
          
          return ctx.editMessageText(
            `🎉 *Setup Complete!* 🎉\n\n✅ Skill levels configured\n✅ Wave preferences set\n✅ Timing preferences saved\n✅ Notifications enabled\n\n*You're all set to get personalized surf alerts!*\n\nTry /today to see your matches! 🌊`,
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
      const levels = ['beginner', 'improver', 'intermediate', 'advanced', 'expert']
      const levelButtons = levels.map(level => {
        const isSelected = currentLevels.includes(level)
        const emoji = level === 'beginner' ? '🟢' : level === 'improver' ? '🔵' : level === 'intermediate' ? '🟡' : level === 'advanced' ? '🟠' : '🔴'
        const text = `${isSelected ? '✅ ' : ''}${emoji} ${level.charAt(0).toUpperCase() + level.slice(1)}`
        return [{ text, callback_data: `pref_level_toggle_${level}` }]
      })
      levelButtons.push([{ text: '✅ Save Changes', callback_data: 'pref_level_save' }])
      levelButtons.push([{ text: '🔙 Back', callback_data: 'menu_preferences' }])
      
      return ctx.editMessageReplyMarkup({ inline_keyboard: levelButtons })
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
      // Set up digest preference using new enum system
      await supabase
        .from('user_notifications')
        .insert({
          user_id: userProfile.id,
          timing: 'morning'
        })
    } else {
      // Set notification timing (convert old system to new enum)
      const timingMap = {
        '24h': 'morning',
        '12h': 'morning', 
        '6h': 'evening',
        '3h': 'evening',
        '1h': 'evening'
      }
      
      await supabase
        .from('user_notifications')
        .insert({
          user_id: userProfile.id,
          timing: timingMap[timing] || 'morning'
        })
    }
  },

  // New setup wizard helper methods
  async toggleSetupLevel(supabase, ctx, level) {
    ctx.session = ctx.session || {}
    ctx.session.setup = ctx.session.setup || { levels: [] }
    
    const levels = ctx.session.setup.levels
    const index = levels.indexOf(level)
    
    if (index === -1) {
      levels.push(level)
    } else {
      levels.splice(index, 1)
    }
    
    return ctx.editMessageReplyMarkup(
      menus.setupLevelSelectionMenu(levels).reply_markup
    )
  },
  
  async toggleSetupSide(supabase, ctx, side) {
    ctx.session = ctx.session || {}
    ctx.session.setup = ctx.session.setup || { sides: [] }
    
    const sides = ctx.session.setup.sides
    const index = sides.indexOf(side)
    
    if (index === -1) {
      sides.push(side)
    } else {
      sides.splice(index, 1)
    }
    
    return ctx.editMessageReplyMarkup(
      menus.setupSideSelectionMenu(sides).reply_markup
    )
  },
  
  async toggleSetupDay(supabase, ctx, day) {
    ctx.session = ctx.session || {}
    ctx.session.setup = ctx.session.setup || { days: [] }
    
    const days = ctx.session.setup.days
    const index = days.indexOf(day)
    
    if (index === -1) {
      days.push(day)
    } else {
      days.splice(index, 1)
    }
    
    return ctx.editMessageReplyMarkup(
      menus.setupDaySelectionMenu(days).reply_markup
    )
  },
  
  async toggleSetupTime(supabase, ctx, timeSlot) {
    ctx.session = ctx.session || {}
    ctx.session.setup = ctx.session.setup || { timeWindows: [] }
    
    const timeWindows = ctx.session.setup.timeWindows
    const timeSlots = {
      morning: { start_time: '06:00', end_time: '12:00' },
      afternoon: { start_time: '12:00', end_time: '18:00' },
      evening: { start_time: '18:00', end_time: '21:00' }
    }
    
    const window = timeSlots[timeSlot]
    const index = timeWindows.findIndex(tw => tw.start_time === window.start_time)
    
    if (index === -1) {
      timeWindows.push(window)
    } else {
      timeWindows.splice(index, 1)
    }
    
    const selectedSlots = timeWindows.map(tw => {
      const slot = Object.keys(timeSlots).find(key => 
        timeSlots[key].start_time === tw.start_time
      )
      return slot
    })
    
    return ctx.editMessageReplyMarkup(
      menus.setupTimeSelectionMenu(selectedSlots).reply_markup
    )
  },
  
  async saveSetupWizard(supabase, userProfile, setup, notificationChoice) {
    // Save levels
    await supabase.from('user_levels').delete().eq('user_id', userProfile.id)
    for (const level of setup.levels) {
      await supabase.from('user_levels').insert({
        user_id: userProfile.id,
        level: level
      })
    }
    
    // Save sides
    await supabase.from('user_sides').delete().eq('user_id', userProfile.id)
    for (const side of setup.sides) {
      const sideCode = side === 'Left' ? 'L' : side === 'Right' ? 'R' : 'A'
      await supabase.from('user_sides').insert({
        user_id: userProfile.id,
        side: sideCode
      })
    }
    
    // Save days
    await supabase.from('user_days').delete().eq('user_id', userProfile.id)
    for (const day of setup.days) {
      await supabase.from('user_days').insert({
        user_id: userProfile.id,
        day_of_week: day
      })
    }
    
    // Save time windows
    await supabase.from('user_time_windows').delete().eq('user_id', userProfile.id)
    for (const window of setup.timeWindows) {
      await supabase.from('user_time_windows').insert({
        user_id: userProfile.id,
        start_time: window.start_time,
        end_time: window.end_time
      })
    }
    
    // Save min spots
    await supabase.from('profiles').update({
      min_spots: setup.minSpots
    }).eq('id', userProfile.id)
    
    // Save notifications using new digest system
    await supabase.from('user_notifications').delete().eq('user_id', userProfile.id)
    
    if (notificationChoice === 'morning') {
      await supabase.from('user_notifications').insert({
        user_id: userProfile.id,
        timing: 'morning'
      })
    } else if (notificationChoice === 'evening') {
      await supabase.from('user_notifications').insert({
        user_id: userProfile.id,
        timing: 'evening'
      })
    } else if (notificationChoice === 'both') {
      await supabase.from('user_notifications').insert([
        { user_id: userProfile.id, timing: 'morning' },
        { user_id: userProfile.id, timing: 'evening' }
      ])
    }
  },

  async showAllSessions(supabase, ctx, timeframe) {
    const scraper = new WaveScheduleScraper()
    
    try {
      const sessions = timeframe === 'today' 
        ? await scraper.getTodaysFutureSessions()
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
  },
  
  async toggleUserSide(supabase, ctx, userProfile, side) {
    try {
      // Single-select: remove all existing sides first, then add the selected one
      await supabase
        .from('user_sides')
        .delete()
        .eq('user_id', userProfile.id)
      
      // Add the new selection
      await supabase
        .from('user_sides')
        .insert({
          user_id: userProfile.id,
          side: side
        })

      const updatedProfile = await getUserProfile(supabase, ctx.from.id)
      const currentSides = updatedProfile.user_sides?.map(us => us.side) || []
      const sideButtons = [
        [{ text: `${currentSides.includes('L') ? '✅ ' : ''}🏄‍♂️ Left Side`, callback_data: 'pref_side_toggle_L' }],
        [{ text: `${currentSides.includes('R') ? '✅ ' : ''}🏄‍♀️ Right Side`, callback_data: 'pref_side_toggle_R' }],
        [{ text: `${currentSides.includes('A') ? '✅ ' : ''}🌊 Any Side`, callback_data: 'pref_side_toggle_A' }],
        [{ text: '✅ Save Changes', callback_data: 'pref_side_save' }],
        [{ text: '🔙 Back', callback_data: 'menu_preferences' }]
      ]
      
      return ctx.editMessageReplyMarkup({ inline_keyboard: sideButtons })
    } catch (error) {
      console.error('Toggle side error:', error)
      return ctx.answerCbQuery('Error updating side preference')
    }
  },
  
  async toggleUserDay(supabase, ctx, userProfile, day) {
    try {
      const { data: existingDay } = await supabase
        .from('user_days')
        .select('day_of_week')
        .eq('user_id', userProfile.id)
        .eq('day_of_week', day)
        .single()

      if (existingDay) {
        await supabase
          .from('user_days')
          .delete()
          .eq('user_id', userProfile.id)
          .eq('day_of_week', day)
      } else {
        await supabase
          .from('user_days')
          .insert({
            user_id: userProfile.id,
            day_of_week: day
          })
      }

      const updatedProfile = await getUserProfile(supabase, ctx.from.id)
      const currentDays = updatedProfile.user_days?.map(ud => ud.day_of_week) || []
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      const dayButtons = days.map((day, index) => {
        const isSelected = currentDays.includes(index)
        const text = `${isSelected ? '✅ ' : ''}📅 ${day}`
        return [{ text, callback_data: `pref_day_toggle_${index}` }]
      })
      dayButtons.push([{ text: '✅ Save Changes', callback_data: 'pref_day_save' }])
      dayButtons.push([{ text: '🔙 Back', callback_data: 'menu_preferences' }])
      
      return ctx.editMessageReplyMarkup({ inline_keyboard: dayButtons })
    } catch (error) {
      console.error('Toggle day error:', error)
      return ctx.answerCbQuery('Error updating day preference')
    }
  },
  
  async toggleUserTimeWindow(supabase, ctx, userProfile, startTime, endTime) {
    try {
      const { data: existingWindow } = await supabase
        .from('user_time_windows')
        .select('id')
        .eq('user_id', userProfile.id)
        .eq('start_time', startTime)
        .eq('end_time', endTime)
        .single()

      if (existingWindow) {
        await supabase
          .from('user_time_windows')
          .delete()
          .eq('id', existingWindow.id)
      } else {
        await supabase
          .from('user_time_windows')
          .insert({
            user_id: userProfile.id,
            start_time: startTime,
            end_time: endTime
          })
      }

      const updatedProfile = await getUserProfile(supabase, ctx.from.id)
      const currentTimes = updatedProfile.user_time_windows || []
      
      const timeWindows = [
        { start: '06:00', end: '09:00', desc: '🌅 Early (6-9 AM)' },
        { start: '09:00', end: '12:00', desc: '🌞 Morning (9-12 PM)' },
        { start: '12:00', end: '15:00', desc: '☀️ Midday (12-3 PM)' },
        { start: '15:00', end: '18:00', desc: '🌤️ Afternoon (3-6 PM)' },
        { start: '18:00', end: '21:00', desc: '🌅 Evening (6-9 PM)' }
      ]
      const timeButtons = timeWindows.map(time => {
        const isSelected = currentTimes.some(ct => ct.start_time === time.start && ct.end_time === time.end)
        const text = `${isSelected ? '✅ ' : ''}${time.desc}`
        return [{ text, callback_data: `pref_time_toggle_${time.start}_${time.end}` }]
      })
      timeButtons.push([{ text: '✅ Save Changes', callback_data: 'pref_time_save' }])
      timeButtons.push([{ text: '🔙 Back', callback_data: 'menu_preferences' }])
      
      return ctx.editMessageReplyMarkup({ inline_keyboard: timeButtons })
    } catch (error) {
      console.error('Toggle time window error:', error)
      return ctx.answerCbQuery('Error updating time preference')
    }
  },
  
  async toggleDigestPreference(supabase, ctx, userProfile, digestType) {
    try {
      const { data: existing } = await supabase
        .from('user_notifications')
        .select('timing')
        .eq('user_id', userProfile.id)
        .eq('timing', digestType)
        .single()

      if (existing) {
        await supabase
          .from('user_notifications')
          .delete()
          .eq('user_id', userProfile.id)
          .eq('timing', digestType)
      } else {
        await supabase
          .from('user_notifications')
          .insert({
            user_id: userProfile.id,
            timing: digestType
          })
      }

      const updatedProfile = await getUserProfile(supabase, ctx.from.id)
      const currentDigests = updatedProfile.user_notifications?.map(un => un.timing) || []
      
      return ctx.editMessageReplyMarkup(
        menus.digestMenu(currentDigests).reply_markup
      )
    } catch (error) {
      console.error('Toggle digest error:', error)
      return ctx.answerCbQuery('Error updating digest preference')
    }
  },
  
  /**
   * Support-related callbacks
   */
  async support(supabase, ctx) {
    const action = ctx.match[1]
    
    // CRITICAL: Answer callback query first
    await ctx.answerCbQuery()
    
    try {
      switch (action) {
        case 'contact':
          const contactMessage = ui.contactMessage()
          return ctx.editMessageText(contactMessage, {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.url('📧 Email Support', 'mailto:support@waveping.app')],
              [Markup.button.url('💬 Telegram Support', 'https://t.me/WavePingSupport')],
              [Markup.button.callback('🔙 Back to Support', 'menu_support')]
            ])
          })
          
        case 'feature':
          const featureMessage = ui.featureRequestMessage()
          return ctx.editMessageText(featureMessage, {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.url('📈 Submit Feature Request', 'https://t.me/WavePingSupport')],
              [Markup.button.callback('🔙 Back to Support', 'menu_support')]
            ])
          })
          
        case 'coffee':
          return ctx.answerCbQuery('☕ Opening Buy Me a Coffee... Thanks for your support! 💙')
          
        default:
          return ctx.answerCbQuery('Unknown support option')
      }
    } catch (error) {
      console.error('Support callback error:', error)
      return ctx.answerCbQuery('Error loading support option')
    }
  },
  
  /**
   * Confirmation actions
   */
  async confirmActions(supabase, ctx) {
    const action = ctx.match[1]
    const telegramId = ctx.from.id
    
    try {
      const userProfile = await getUserProfile(supabase, telegramId)
      
      if (!userProfile) {
        return ctx.answerCbQuery('User profile not found!')
      }
      
      switch (action) {
        case 'reset_all':
          // Delete all user preferences
          await Promise.all([
            supabase.from('user_levels').delete().eq('user_id', userProfile.id),
            supabase.from('user_sides').delete().eq('user_id', userProfile.id),
            supabase.from('user_days').delete().eq('user_id', userProfile.id),
            supabase.from('user_time_windows').delete().eq('user_id', userProfile.id),
            supabase.from('user_notifications').delete().eq('user_id', userProfile.id)
          ])
          
          // Reset min_spots to default
          await supabase.from('profiles').update({
            min_spots: 1
          }).eq('id', userProfile.id)
          
          ctx.answerCbQuery('✅ All preferences reset!')
          
          return ctx.editMessageText(
            '✅ *Preferences Reset Complete!*\n\n🌊 Your preferences have been cleared.\n\nReady to set up fresh preferences?',
            {
              parse_mode: 'Markdown',
              reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('⚙️ Setup Preferences', 'menu_preferences')],
                [Markup.button.callback('🏠 Main Menu', 'menu_main')]
              ])
            }
          )
          
        default:
          return ctx.answerCbQuery('Unknown confirmation action')
      }
    } catch (error) {
      console.error('Confirmation action error:', error)
      return ctx.answerCbQuery('Error processing confirmation')
    }
  },

  /**
   * Test callbacks
   */
  async test(supabase, ctx) {
    const action = ctx.match[1]
    await ctx.answerCbQuery()
    
    switch (action) {
      case 'prefs_menu':
        return ctx.editMessageText('🧪 Testing preferences menu directly:', {
          reply_markup: menus.preferencesMenu()
        })
      
      default:
        return ctx.editMessageText('🧪 Test callback executed: ' + action)
    }
  }
}

module.exports = callbacks