/**
 * Bot Command Handlers
 * Beautiful, interactive commands with amazing UI/UX
 */

const { Markup } = require('telegraf')
const menus = require('./menus')
const ui = require('./ui')
const { WaveScheduleScraper } = require('../lib/wave-scraper-final')
const { checkRateLimit } = require('../utils/telegram-helpers')
// Import utilities directly to avoid circular dependency

// Utility functions for user profile management
async function getUserProfile(supabase, telegramId) {
  const { data, error } = await supabase
    .from('profiles')
    .select(`
      *,
      user_levels (level),
      user_sides (side),
      user_days (day_of_week),
      user_time_windows (start_time, end_time),
      user_digest_filters (timing),
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

const commands = {
  /**
   * Welcome command - Beautiful onboarding experience
   */
  async start(supabase, ctx) {
    console.log('🚀 START command received for user:', ctx.from.id)
    const telegramId = ctx.from.id
    const username = ctx.from.username
    
    try {
      // Check if user exists
      console.log('📋 Checking user profile for:', telegramId)
      let userProfile = await getUserProfile(supabase, telegramId)
      console.log('📋 User profile result:', !!userProfile)
    
    if (!userProfile) {
      console.log('👤 Creating new user profile for:', telegramId)
      // Create new user
      userProfile = await createUserProfile(supabase, telegramId, username)
      console.log('👤 New user created:', !!userProfile)
      
      // Welcome new user with beautiful onboarding
      const welcomeMessage = ui.welcomeMessage(ctx.from.first_name || 'Wave Rider')
      console.log('💬 Sending welcome message with keyboard')
      
      await ctx.reply(welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🌊 Today at The Wave', callback_data: 'menu_today' }],
            [{ text: '🌅 Tomorrow at The Wave', callback_data: 'menu_tomorrow' }],
            [{ text: '🛠 Your Setup', callback_data: 'menu_preferences' }],
            [{ text: '🔔 Alerts & Digests', callback_data: 'menu_notifications' }],
            [{ text: '❓ Help & Support', callback_data: 'menu_help' }],
            [{ text: '☕ Buy the dev a coffee', url: 'https://buymeacoffee.com/driftwithcaz' }]
          ]
        }
      })
      console.log('✅ Welcome message sent')
      
    } else {
      console.log('🎉 Existing user found, sending welcome back message')
      
      // Try to get session counts for dynamic urgency line (optional)
      let dynamicUrgency = ''
      try {
        const { WaveScheduleScraper } = require('../lib/wave-scraper-final')
        const scraper = new WaveScheduleScraper()
        const todaySessions = await scraper.getTodaysFutureSessions()
        
        // Extract user preferences in correct format
        const userLevels = userProfile.user_levels?.map(ul => ul.level) || []
        const userSides = userProfile.user_sides?.map(us => 
          us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any'
        ) || []
        const userDays = userProfile.user_days?.map(ud => ud.day_of_week) || []
        const userTimeWindows = userProfile.user_time_windows || []
        
        const filteredSessions = scraper.filterSessionsForUser(
          todaySessions, userLevels, userSides, userDays, true, userTimeWindows
        ).filter(s => (s.spots_available || 0) >= userProfile.min_spots)
        
        if (filteredSessions.length > 0) {
          dynamicUrgency = `\n\n🔥 ${filteredSessions.length} session${filteredSessions.length !== 1 ? 's' : ''} match${filteredSessions.length === 1 ? 'es' : ''} your setup today`
        }
      } catch (error) {
        // Silently ignore if we can't get sessions
        console.log('Could not fetch sessions for dynamic urgency:', error.message)
      }
      
      // Welcome back existing user
      const welcomeBackMessage = ui.welcomeBackMessage(ctx.from.first_name || 'Wave Rider', userProfile) + dynamicUrgency
      
      console.log('🔧 DEBUG: About to call ctx.reply():', {
        hasCtx: !!ctx,
        hasReply: !!(ctx && ctx.reply),
        chatId: ctx.chat?.id,
        messageLength: welcomeBackMessage.length
      })
      
      const replyResult = await ctx.reply(welcomeBackMessage, {
        parse_mode: 'Markdown',  
        reply_markup: {
          inline_keyboard: [
            [{ text: '🌊 Today at The Wave', callback_data: 'menu_today' }],
            [{ text: '🌅 Tomorrow at The Wave', callback_data: 'menu_tomorrow' }],
            [{ text: '🛠 Your Setup', callback_data: 'menu_preferences' }],
            [{ text: '🔔 Alerts & Digests', callback_data: 'menu_notifications' }],
            [{ text: '❓ Help & Support', callback_data: 'menu_help' }],
            [{ text: '☕ Buy the dev a coffee', url: 'https://buymeacoffee.com/driftwithcaz' }]
          ]
        }
      })
      
      console.log('✅ Welcome back message sent, result:', {
        hasResult: !!replyResult,
        messageId: replyResult?.message_id
      })
    }
    } catch (error) {
      console.error('🚨 START command error:', error.message, error.stack)
      await ctx.reply('Sorry, something went wrong. Please try again.').catch(e => {
        console.error('Failed to send error message:', e)
      })
    }
  },

  /**
   * Today's sessions - Interactive session browser
   */
  async today(supabase, ctx) {
    const telegramId = ctx.from.id
    
    // Rate limiting with friendly message
    if (!checkRateLimit(`today:${telegramId}`, 5000)) {
      return ctx.reply(
        '⏳ *Hold your horses, surfer!*\n\n' +
        'Please wait a moment before checking again.\n' +
        'The waves aren\'t going anywhere! 🌊',
        { parse_mode: 'Markdown' }
      )
    }
    
    // Show loading with wave animation
    const loadingMsg = await ctx.reply('🌊 *Checking today\'s waves...*\n\n🏄‍♂️ Scanning sessions...')
    
    try {
      const userProfile = await getUserProfile(supabase, telegramId)
      
      if (!userProfile) {
        return ctx.telegram.editMessageText(
          ctx.chat.id,
          loadingMsg.message_id,
          undefined,
          '🏄‍♂️ *Welcome to WavePing!*\n\n' +
          'Set up your preferences first to get personalized session recommendations.\n\n' +
          'Or browse all sessions without filtering! 🌊',
          {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('⚙️ Setup Preferences', 'menu_preferences')],
              [Markup.button.callback('🌊 Show All Sessions', 'filter_all_today')]
            ])
          }
        )
      }
      
      // Get today's future sessions (exclude past ones)
      const scraper = new WaveScheduleScraper()
      const sessions = await scraper.getTodaysFutureSessions()
      
      // Filter for user
      const userLevels = userProfile.user_levels?.map(ul => ul.level) || []
      const userSides = userProfile.user_sides?.map(us => 
        us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any'
      ) || []
      const userDays = userProfile.user_days?.map(ud => ud.day_of_week) || []
      const userTimeWindows = userProfile.user_time_windows || []
      
      const filteredSessions = scraper.filterSessionsForUser(
        sessions, userLevels, userSides, userDays, true, userTimeWindows
      ).filter(s => (s.spots_available || 0) >= userProfile.min_spots)
      
      const allAvailableSessions = sessions.filter(s => (s.spots_available || 0) > 0)
      
      // Create beautiful session display
      const sessionMessage = ui.createSessionsMessage(
        'Today', 
        filteredSessions, 
        allAvailableSessions,
        userProfile
      )
      
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        sessionMessage,
        {
          parse_mode: 'Markdown',
          reply_markup: menus.sessionMenu('today', filteredSessions.length > 0, filteredSessions.length > 0 ? filteredSessions : allAvailableSessions)
        }
      )
      
    } catch (error) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        '🚨 *Oops! Waves are a bit choppy*\n\n' +
        'Couldn\'t fetch today\'s sessions right now.\n' +
        'Please try again in a moment! 🌊',
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Try Again', 'menu_today')],
            [Markup.button.callback('🏠 Main Menu', 'menu_main')]
          ])
        }
      )
    }
  },

  /**
   * Tomorrow's sessions
   */
  async tomorrow(supabase, ctx) {
    const telegramId = ctx.from.id
    
    if (!checkRateLimit(`tomorrow:${telegramId}`, 5000)) {
      return ctx.reply(
        '⏳ *Patience, grasshopper!*\n\n' +
        'Tomorrow\'s waves will still be there in a moment! 🏄‍♂️',
        { parse_mode: 'Markdown' }
      )
    }
    
    const loadingMsg = await ctx.reply('🌅 *Checking tomorrow\'s forecast...*\n\n🔮 Reading the waves...')
    
    try {
      const userProfile = await getUserProfile(supabase, telegramId)
      const scraper = new WaveScheduleScraper()
      const sessions = await scraper.getTomorrowsSessions()
      
      if (!userProfile) {
        const allSessions = sessions.filter(s => (s.spots_available || 0) > 0)
        const message = ui.createSessionsMessage('Tomorrow', allSessions, allSessions, null)
        
        return ctx.telegram.editMessageText(
          ctx.chat.id,
          loadingMsg.message_id,
          undefined,
          message,
          {
            parse_mode: 'Markdown',
            reply_markup: menus.sessionMenu('tomorrow', allSessions.length > 0, allSessions)
          }
        )
      }
      
      // Filter sessions for user
      const userLevels = userProfile.user_levels?.map(ul => ul.level) || []
      const userSides = userProfile.user_sides?.map(us => 
        us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any'
      ) || []
      const userDays = userProfile.user_days?.map(ud => ud.day_of_week) || []
      const userTimeWindows = userProfile.user_time_windows || []
      
      const filteredSessions = scraper.filterSessionsForUser(
        sessions, userLevels, userSides, userDays, true, userTimeWindows
      ).filter(s => (s.spots_available || 0) >= userProfile.min_spots)
      
      const allAvailableSessions = sessions.filter(s => (s.spots_available || 0) > 0)
      
      const sessionMessage = ui.createSessionsMessage(
        'Tomorrow', 
        filteredSessions, 
        allAvailableSessions, 
        userProfile
      )
      
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        sessionMessage,
        {
          parse_mode: 'Markdown',
          reply_markup: menus.sessionMenu('tomorrow', filteredSessions.length > 0, filteredSessions.length > 0 ? filteredSessions : allAvailableSessions)
        }
      )
      
    } catch (error) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        '🌅 *Tomorrow is looking a bit hazy...*\n\n' +
        'Couldn\'t fetch tomorrow\'s forecast.\n' +
        'The surf gods are taking a coffee break! ☕',
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Try Again', 'menu_tomorrow')],
            [Markup.button.callback('🌊 Check Today Instead', 'menu_today')]
          ])
        }
      )
    }
  },

  // Week view command removed - only today/tomorrow supported


  /**
   * Preferences command
   */
  async preferences(supabase, ctx) {
    const telegramId = ctx.from.id
    let userProfile = await getUserProfile(supabase, telegramId)
    
    if (!userProfile) {
      // Create user profile and start setup wizard
      userProfile = await createUserProfile(supabase, telegramId, ctx.from.username)
      
      return ctx.reply('🚀 *Welcome to WavePing!*\n\nLet\'s set up your preferences!', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎯 Start Setup', callback_data: 'setup_start' }],
            [{ text: '🏠 Main Menu', callback_data: 'menu_main' }]
          ]
        }
      })
    }
    
    // Complete preferences menu with all options
    const preferencesMessage = ui.createPreferencesMessage(userProfile)
    await ctx.reply(preferencesMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Skill Levels', callback_data: 'pref_levels' }],
          [{ text: 'Wave Side', callback_data: 'pref_sides' }],
          [{ text: 'Surf Days', callback_data: 'pref_days' }],
          [{ text: 'Time Windows', callback_data: 'pref_times' }],
          [{ text: 'Min Spots', callback_data: 'pref_spots' }],
          [{ text: 'Notification Timing', callback_data: 'pref_notifications' }],
          [{ text: 'Daily Digests', callback_data: 'pref_digests' }],
          [{ text: '⬅️ Main Menu', callback_data: 'menu_main' }]
        ]
      }
    })
  },

  /**
   * Notifications command
   */
  async notifications(supabase, ctx) {
    const userProfile = await getUserProfile(supabase, ctx.from.id)
    
    if (!userProfile) {
      return ctx.reply('⚙️ Set up your preferences first with /setup')
    }
    
    const notificationMessage = ui.createNotificationMessage(userProfile)
    
    await ctx.reply(notificationMessage, {
      parse_mode: 'Markdown',
      reply_markup: menus.notificationMenu()
    })
  },

  /**
   * Help command
   */
  async help(ctx) {
    const helpMessage = ui.helpMessage()
    
    await ctx.reply(helpMessage, {
      parse_mode: 'Markdown',
      reply_markup: menus.helpMenu()
    })
  },

  /**
   * Menu command
   */
  async menu(ctx) {
    const menuMessage = ui.mainMenuMessage()
    
    await ctx.reply(menuMessage, {
      parse_mode: 'Markdown',
      reply_markup: menus.mainMenu()
    })
  },


  /**
   * Test command
   */
  async test(supabase, ctx) {
    const userProfile = await getUserProfile(supabase, ctx.from.id)
    
    // Test basic inline keyboard
    if (ctx.message?.text === '/test basic') {
      return ctx.reply('🧪 Basic keyboard test:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Button 1', callback_data: 'test_btn1' }],
            [{ text: '❌ Button 2', callback_data: 'test_btn2' }]
          ]
        }
      })
    }
    
    // Test the preferences menu specifically
    if (ctx.message?.text === '/test prefs') {
      const menu = menus.preferencesMenu()
      console.log('🧪 Preferences menu structure:', JSON.stringify(menu, null, 2))
      return ctx.reply('🧪 Testing preferences menu:', {
        reply_markup: menu
      })
    }

    // Test raw preferences menu
    if (ctx.message?.text === '/test raw') {
      return ctx.reply('🧪 Raw preferences menu:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎯 Skill Levels', callback_data: 'pref_levels' }],
            [{ text: '🏄 Wave Sides', callback_data: 'pref_sides' }],
            [{ text: '📅 Surf Days', callback_data: 'pref_days' }],
            [{ text: '🕐 Time Windows', callback_data: 'pref_times' }],
            [{ text: '🏠 Main Menu', callback_data: 'menu_main' }]
          ]
        }
      })
    }
    
    const testMessage = ui.createTestMessage(userProfile)
    
    await ctx.reply(testMessage, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('📱 Send Test Notification', 'test_notification')],
        [Markup.button.callback('🔄 Refresh Profile', 'test_profile')],
        [Markup.button.callback('🌊 Test Session Fetch', 'test_sessions')],
        [Markup.button.callback('🧪 Test Prefs Menu', 'test_prefs_menu')]
      ])
    })
  },

  /**
   * Support command - Buy Me a Coffee integration
   */
  async support(ctx) {
    console.log('💖 SUPPORT command received for user:', ctx.from.id)
    try {
      const supportMessage = ui.supportMessage()
      console.log('💬 Sending support message with keyboard')
      
      await ctx.reply(supportMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '☕ Buy Me a Coffee', url: 'https://buymeacoffee.com/driftwithcaz' }],
            [{ text: '💬 Contact Developer', callback_data: 'support_contact' }],
            [{ text: '📈 Feature Request', callback_data: 'support_feature' }],
            [{ text: '🏠 Main Menu', callback_data: 'menu_main' }]
          ]
        }
      })
      console.log('✅ Support message sent')
    } catch (error) {
      console.error('🚨 SUPPORT command error:', error.message, error.stack)
      await ctx.reply('Sorry, something went wrong with the support command.').catch(e => {
        console.error('Failed to send error message:', e)
      })
    }
  }
}

module.exports = commands