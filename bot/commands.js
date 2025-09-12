/**
 * Bot Command Handlers
 * Beautiful, interactive commands with amazing UI/UX
 */

const { Markup } = require('telegraf')
const menus = require('./menus')
const ui = require('./ui')
const { WaveScheduleScraper } = require('../lib/wave-scraper-final')
const { checkRateLimit, sendChunked } = require('../utils/telegram-helpers')
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

const commands = {
  /**
   * Welcome command - Beautiful onboarding experience
   */
  async start(supabase, ctx) {
    const telegramId = ctx.from.id
    const username = ctx.from.username
    
    // Check if user exists
    let userProfile = await getUserProfile(supabase, telegramId)
    
    if (!userProfile) {
      // Create new user
      userProfile = await createUserProfile(supabase, telegramId, username)
      
      // Welcome new user with beautiful onboarding
      const welcomeMessage = ui.welcomeMessage(ctx.from.first_name || 'Wave Rider')
      
      await ctx.reply(welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: menus.mainMenu()
      })
      
      // Suggest quick setup
      setTimeout(() => {
        ctx.reply(
          '🎯 *Quick Start Available!*\n\n' +
          'Get personalized surf alerts in just 30 seconds:\n\n' +
          '• Tell us your skill level\n' +
          '• Choose your preferred surf times\n' +
          '• Set notification preferences\n\n' +
          'Ready to get started?',
          {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('🚀 Quick Setup (30s)', 'setup_quick')],
              [Markup.button.callback('⚙️ Detailed Setup', 'setup_detailed')],
              [Markup.button.callback('🌊 Just Browse Sessions', 'menu_today')]
            ])
          }
        )
      }, 2000)
    } else {
      // Welcome back existing user
      const welcomeBackMessage = ui.welcomeBackMessage(ctx.from.first_name || 'Wave Rider', userProfile)
      
      await ctx.reply(welcomeBackMessage, {
        parse_mode: 'Markdown',
        reply_markup: menus.mainMenu()
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
              [Markup.button.callback('⚙️ Quick Setup', 'setup_quick')],
              [Markup.button.callback('🌊 Show All Sessions', 'filter_all_today')]
            ])
          }
        )
      }
      
      // Get today's sessions
      const scraper = new WaveScheduleScraper()
      const sessions = await scraper.getTodaysSessions()
      
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
          reply_markup: menus.sessionMenu('today', filteredSessions.length > 0)
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
            reply_markup: menus.sessionMenu('tomorrow', allSessions.length > 0)
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
          reply_markup: menus.sessionMenu('tomorrow', filteredSessions.length > 0)
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

  /**
   * Week overview
   */
  async week(supabase, ctx) {
    const telegramId = ctx.from.id
    
    if (!checkRateLimit(`week:${telegramId}`, 10000)) {
      return ctx.reply(
        '⏳ *Weekly forecast loading...*\n\n' +
        'This takes a bit more time. Please wait! 📊',
        { parse_mode: 'Markdown' }
      )
    }
    
    const loadingMsg = await ctx.reply('📅 *Analyzing the week ahead...*\n\n📊 Crunching wave data...')
    
    try {
      const scraper = new WaveScheduleScraper()
      const sessions = await scraper.getSessionsInRange(7)
      
      const weekMessage = ui.createWeekOverview(sessions)
      
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        weekMessage,
        {
          parse_mode: 'Markdown',
          reply_markup: menus.weekMenu()
        }
      )
      
    } catch (error) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        '📅 *Week view temporarily unavailable*\n\n' +
        'Try checking individual days instead! 🌊',
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🌊 Today', 'menu_today'), Markup.button.callback('🌅 Tomorrow', 'menu_tomorrow')],
            [Markup.button.callback('🏠 Main Menu', 'menu_main')]
          ])
        }
      )
    }
  },

  /**
   * Setup command - Guided setup experience
   */
  async setup(supabase, ctx) {
    const userProfile = await getUserProfile(supabase, ctx.from.id)
    
    if (!userProfile) {
      await createUserProfile(supabase, ctx.from.id, ctx.from.username)
    }
    
    const setupMessage = ui.setupWelcomeMessage()
    
    await ctx.reply(setupMessage, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Quick Setup (30s)', 'setup_quick')],
        [Markup.button.callback('⚙️ Detailed Setup (2min)', 'setup_detailed')],
        [Markup.button.callback('🏠 Back to Menu', 'menu_main')]
      ])
    })
  },

  /**
   * Preferences command
   */
  async preferences(supabase, ctx) {
    const userProfile = await getUserProfile(supabase, ctx.from.id)
    
    if (!userProfile) {
      return ctx.reply(
        '⚙️ *No preferences set yet*\n\n' +
        'Let\'s get you set up first!',
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🚀 Quick Setup', 'setup_quick')],
            [Markup.button.callback('⚙️ Detailed Setup', 'setup_detailed')]
          ])
        }
      )
    }
    
    const preferencesMessage = ui.createPreferencesMessage(userProfile)
    
    // For existing messages, try to edit instead of reply
    if (ctx.callbackQuery) {
      await ctx.editMessageText(preferencesMessage, {
        parse_mode: 'Markdown',
        reply_markup: menus.preferencesMenu()
      })
    } else {
      await ctx.reply(preferencesMessage, {
        parse_mode: 'Markdown',
        reply_markup: menus.preferencesMenu()
      })
    }
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
   * Quick setup command
   */
  async quickSetup(supabase, ctx) {
    // Start session
    ctx.session = ctx.session || {}
    ctx.session.setupType = 'quick'
    ctx.session.setupStep = 'level'
    
    const quickSetupMessage = ui.quickSetupMessage()
    
    await ctx.reply(quickSetupMessage, {
      parse_mode: 'Markdown',
      reply_markup: menus.quickSetupLevelsMenu()
    })
  },

  /**
   * Test command
   */
  async test(supabase, ctx) {
    const userProfile = await getUserProfile(supabase, ctx.from.id)
    
    const testMessage = ui.createTestMessage(userProfile)
    
    await ctx.reply(testMessage, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('📱 Send Test Notification', 'test_notification')],
        [Markup.button.callback('🔄 Refresh Profile', 'test_profile')],
        [Markup.button.callback('🌊 Test Session Fetch', 'test_sessions')]
      ])
    })
  },

  /**
   * Support command - Buy Me a Coffee integration
   */
  async support(ctx) {
    const supportMessage = ui.supportMessage()
    
    await ctx.reply(supportMessage, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.url('☕ Buy Me a Coffee', 'https://buymeacoffee.com/waveping')],
        [Markup.button.url('💖 GitHub Sponsors', 'https://github.com/sponsors/waveping')],
        [Markup.button.callback('💬 Contact Developer', 'support_contact')],
        [Markup.button.callback('📈 Feature Request', 'support_feature')],
        [Markup.button.callback('🏠 Main Menu', 'menu_main')]
      ])
    })
  }
}

module.exports = commands