/**
 * Main Bot Handler
 * Orchestrates all bot commands and interactions
 */

const commands = require('./commands')
const callbacks = require('./callbacks')
const logger = require('../utils/logger').child('Bot')

class BotHandler {
  constructor(bot, supabase) {
    this.bot = bot
    this.supabase = supabase
    this.logger = logger
    
    this.setupCommands()
    this.setupCallbacks()
    this.setupMenuButton()
    this.setupBotCommands()
    this.setupErrorHandling()
  }

  setupCommands() {
    // Welcome command - CRITICAL FIX: Proper context passing
    this.bot.command('start', (ctx) => commands.start(this.supabase, ctx))
    
    // Main commands
    this.bot.command('today', commands.today.bind(null, this.supabase))
    this.bot.command('tomorrow', commands.tomorrow.bind(null, this.supabase))
    // Week command removed - only today/tomorrow supported
    
    // Settings and preferences
    this.bot.command('setup', commands.preferences.bind(null, this.supabase))
    this.bot.command('notifications', commands.notifications.bind(null, this.supabase))
    
    // Utility commands
    this.bot.command('help', commands.help)
    this.bot.command('menu', commands.menu)
    this.bot.command('test', commands.test.bind(null, this.supabase))
    
    
    // Support command for Buy Me a Coffee
    this.bot.command('support', commands.support)
    
    this.logger.info('Bot commands registered successfully')
  }

  setupCallbacks() {
    // Basic navigation callbacks
    this.bot.action('today', callbacks.navigation.bind(null, this.supabase))
    this.bot.action('tomorrow', callbacks.navigation.bind(null, this.supabase))
    this.bot.action('main', callbacks.navigation.bind(null, this.supabase))
    this.bot.action('prefs', callbacks.navigation.bind(null, this.supabase))
    this.bot.action('alerts', callbacks.navigation.bind(null, this.supabase))
    this.bot.action('help', callbacks.navigation.bind(null, this.supabase))
    this.bot.action('support', callbacks.navigation.bind(null, this.supabase))
    this.bot.action('donate', callbacks.navigation.bind(null, this.supabase))
    this.bot.action('help_contact', callbacks.navigation.bind(null, this.supabase))
    this.bot.action('help_feature', callbacks.navigation.bind(null, this.supabase))
    
    // Show more functionality
    this.bot.action('show_more_today', callbacks.navigation.bind(null, this.supabase))
    this.bot.action('show_more_tomorrow', callbacks.navigation.bind(null, this.supabase))
    
    // Menu navigation with prefix
    this.bot.action(/^menu_(.+)$/, callbacks.menu.bind(null, this.supabase))
    
    // Preferences management
    this.bot.action(/^pref_(.+)$/, callbacks.preferences.bind(null, this.supabase))
    this.bot.action(/^setup_(.+)$/, callbacks.setup.bind(null, this.supabase))
    
    // Notification management
    this.bot.action(/^notif_(.+)$/, callbacks.notifications.bind(null, this.supabase))
    
    // Digest management
    this.bot.action(/^digest_(.+)$/, callbacks.digests.bind(null, this.supabase))
    
    // Support and contact management
    this.bot.action(/^support_(.+)$/, callbacks.support.bind(null, this.supabase))
    
    // Session filtering and display
    this.bot.action(/^filter_(.+)$/, callbacks.filters.bind(null, this.supabase))
    this.bot.action(/^session_(.+)$/, callbacks.sessions.bind(null, this.supabase))
    
    // Pagination
    this.bot.action(/^page_(.+)_(\d+)$/, callbacks.pagination.bind(null, this.supabase))
    
    // Back navigation
    this.bot.action('back', callbacks.back)
    this.bot.action(/^back_(.+)$/, callbacks.backTo.bind(null, this.supabase))
    
    // Confirmation actions
    this.bot.action(/^confirm_(.+)$/, callbacks.confirmActions.bind(null, this.supabase))
    
    // Test actions
    this.bot.action(/^test_(.+)$/, callbacks.test.bind(null, this.supabase))
    
    // Catch-all for debugging
    this.bot.action(/.+/, (ctx) => {
      this.logger.info('Unmatched callback received', {
        data: ctx.callbackQuery.data,
        userId: ctx.from.id
      })
      ctx.answerCbQuery('Debug: Callback received but not matched')
    })
    
    this.logger.info('Bot callbacks registered successfully')
  }

  async setupMenuButton() {
    try {
      // Set the menu button that appears next to the text input
      await this.bot.telegram.setChatMenuButton({
        menu_button: {
          type: 'commands'
        }
      })
      
      this.logger.info('Bot menu button configured successfully')
    } catch (error) {
      this.logger.error('Failed to setup menu button', { error: error.message })
    }
  }

  async setupBotCommands() {
    try {
      // Define the command list that appears in the menu
      const commands = [
        { command: 'start', description: '🌊 Welcome' },
        { command: 'today', description: '🏄‍♂️ Today\'s Sessions' },
        { command: 'tomorrow', description: '🌅 Tomorrow\'s Sessions' },
        { command: 'setup', description: '⚙️ Preferences' },
        { command: 'notifications', description: '🔔 Notification Settings' },
        { command: 'support', description: '☕ Support WavePing' },
        { command: 'help', description: '❓ Help & Feedback' }
      ]
      
      await this.bot.telegram.setMyCommands(commands)
      this.logger.info('Bot commands menu configured successfully')
    } catch (error) {
      this.logger.error('Failed to setup bot commands', { error: error.message })
    }
  }

  setupErrorHandling() {
    this.bot.catch((err, ctx) => {
      this.logger.error('Bot error occurred', {
        error: err.message,
        stack: err.stack,
        userId: ctx.from?.id,
        updateType: ctx.updateType,
        callbackData: ctx.callbackQuery?.data,
        message: ctx.message?.text
      })
      
      // Send user-friendly error message
      if (ctx.callbackQuery) {
        ctx.answerCbQuery('🚨 Something went wrong. Please try again.').catch(() => {})
      } else {
        ctx.reply(
          '🚨 Oops! Something went wrong. Please try again later.\n\n' +
          'If the problem persists, use /help for support.',
          { parse_mode: 'Markdown' }
        ).catch(() => {
          // Silent fail for reply errors
          this.logger.error('Failed to send error message to user')
        })
      }
    })
  }

  // Utility methods for commands to use
  static async getUserProfile(supabase, telegramId) {
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
      logger.error('Error fetching user profile', { error, telegramId })
      return null
    }
    
    return data
  }

  static async createUserProfile(supabase, telegramId, username = null) {
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
      logger.error('Error creating user profile', { error, telegramId })
      return null
    }
    
    return data
  }
}

module.exports = BotHandler