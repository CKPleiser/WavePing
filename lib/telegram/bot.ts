import { Telegraf, Context, Markup } from 'telegraf'
import { createAdminClient } from '../supabase/client'
import type { SessionLevel, NotificationTiming, UserPreferences } from '../supabase/types'

export interface WavePingContext extends Context {
  session?: any
  user?: {
    id: string
    telegram_id: number
    telegram_username?: string
    preferences?: UserPreferences
  }
}

export class WavePingBot {
  private bot: Telegraf<WavePingContext>
  private supabase = createAdminClient()

  constructor(token: string) {
    this.bot = new Telegraf<WavePingContext>(token)
    this.setupCommands()
    this.setupCallbackHandlers()
  }

  private setupCommands() {
    // Start command - welcome and setup
    this.bot.command('start', async (ctx) => {
      const telegramId = ctx.from.id
      const username = ctx.from.username

      // Check if user exists
      const { data: existingUser } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('telegram_id', telegramId)
        .single()

      if (!existingUser) {
        // Create new user
        const { error } = await this.supabase
          .from('profiles')
          .insert({
            telegram_id: telegramId,
            telegram_username: username
          })

        if (error) {
          console.error('Error creating user:', error)
          return ctx.reply('Sorry, something went wrong. Please try again.')
        }

        await ctx.reply(
          '🌊 *Welcome to WavePing!*\n\n' +
          'I\'ll help you catch the perfect waves at The Wave Bristol.\n\n' +
          'Let\'s set up your preferences so you only get alerts for ' +
          'sessions that match your level and schedule.\n\n' +
          'Ready to start? Use /setup to configure your alerts!',
          { parse_mode: 'Markdown' }
        )

        // Auto-start setup for new users
        return this.startSetup(ctx)
      } else {
        await ctx.reply(
          '🌊 *Welcome back to WavePing!*\n\n' +
          'Your alerts are active and ready.\n\n' +
          'Use /prefs to view your current preferences\n' +
          'Use /today to see today\'s sessions\n' +
          'Use /help for all available commands',
          { parse_mode: 'Markdown' }
        )
      }
    })

    // Setup command
    this.bot.command('setup', this.startSetup.bind(this))

    // Preferences command
    this.bot.command('prefs', async (ctx) => {
      const preferences = await this.getUserPreferences(ctx.from.id)
      if (!preferences) {
        return ctx.reply('You haven\'t set up preferences yet. Use /setup to get started.')
      }

      const msg = this.formatPreferencesMessage(preferences)
      await ctx.reply(msg, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('⚙️ Edit Levels', 'edit_levels')],
          [Markup.button.callback('🏄 Edit Sides', 'edit_sides')],
          [Markup.button.callback('📅 Edit Days', 'edit_days')],
          [Markup.button.callback('🕐 Edit Times', 'edit_times')],
          [Markup.button.callback('🔔 Edit Notifications', 'edit_notifications')]
        ]).reply_markup
      })
    })

    // Today's sessions
    this.bot.command('today', async (ctx) => {
      const sessions = await this.getTodaysSessions(ctx.from.id)
      const msg = this.formatSessionsMessage(sessions, 'Today')
      await ctx.reply(msg, { parse_mode: 'Markdown' })
    })

    // Tomorrow's sessions
    this.bot.command('tomorrow', async (ctx) => {
      const sessions = await this.getTomorrowsSessions(ctx.from.id)
      const msg = this.formatSessionsMessage(sessions, 'Tomorrow')
      await ctx.reply(msg, { parse_mode: 'Markdown' })
    })

    // Week view
    this.bot.command('week', async (ctx) => {
      const sessions = await this.getWeekSessions(ctx.from.id)
      const msg = this.formatWeekMessage(sessions)
      await ctx.reply(msg, { parse_mode: 'Markdown' })
    })

    // Help command
    this.bot.command('help', async (ctx) => {
      const helpMsg = `
🌊 *WavePing Commands*

*Setup & Preferences:*
/start - Welcome and setup
/setup - Configure your preferences
/prefs - View/edit current preferences

*Sessions:*
/today - Today's matching sessions
/tomorrow - Tomorrow's sessions  
/week - 7-day outlook

*Quick Actions:*
/stoke - Get pumped with surf wisdom
/conditions - Current conditions at The Wave

*Help:*
/help - Show this help message

Ready to catch some waves? 🏄‍♂️
      `
      await ctx.reply(helpMsg, { parse_mode: 'Markdown' })
    })

    // Fun commands
    this.bot.command('stoke', async (ctx) => {
      const stokeMessages = [
        '🔥 "The best surfer out there is the one having the most fun!" - Phil Edwards',
        '🌊 "You can\'t stop the waves, but you can learn to surf." - Jon Kabat-Zinn',
        '🤙 "Surfing is the most blissful experience you can have on this planet." - John McCarthy',
        '⚡ "The wave doesn\'t care what you did yesterday. Show up today!" - Unknown',
        '🏄 "Every wave is different. Find your rhythm." - Pipeline wisdom',
        '🌟 "Surf more, worry less!" - Beach philosophy'
      ]
      const randomMessage = stokeMessages[Math.floor(Math.random() * stokeMessages.length)]
      await ctx.reply(randomMessage)
    })
  }

  private async startSetup(ctx: WavePingContext) {
    const keyboard = this.buildLevelKeyboard([])
    
    ctx.session = ctx.session || {}
    ctx.session.setup = {
      levels: [],
      sides: [],
      days: [],
      timeWindows: [],
      notifications: ['24h'], // Default notification
      step: 'levels'
    }

    await ctx.reply(
      '📊 *Step 1/5: Session Levels*\n\n' +
      'Select all the session levels you\'re interested in:',
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    )
  }

  private setupCallbackHandlers() {
    // Level selection
    this.bot.action(/^level_(.+)$/, async (ctx) => {
      const level = ctx.match[1] as SessionLevel
      const setup = ctx.session?.setup || { levels: [], step: 'levels' }
      
      if (setup.levels.includes(level)) {
        setup.levels = setup.levels.filter(l => l !== level)
      } else {
        setup.levels.push(level)
      }

      const keyboard = this.buildLevelKeyboard(setup.levels)
      await ctx.editMessageReplyMarkup(keyboard)
      await ctx.answerCbQuery()
    })

    // Next step handlers
    this.bot.action('next_sides', this.handleNextSides.bind(this))
    this.bot.action('next_days', this.handleNextDays.bind(this))
    this.bot.action('next_times', this.handleNextTimes.bind(this))
    this.bot.action('next_notifications', this.handleNextNotifications.bind(this))
    this.bot.action('finish_setup', this.handleFinishSetup.bind(this))

    // Side selection
    this.bot.action(/^side_(.+)$/, this.handleSideSelection.bind(this))
    
    // Day selection
    this.bot.action(/^day_(.+)$/, this.handleDaySelection.bind(this))
    
    // Time selection
    this.bot.action(/^time_(.+)$/, this.handleTimeSelection.bind(this))
    
    // Notification selection
    this.bot.action(/^notification_(.+)$/, this.handleNotificationSelection.bind(this))

    // Session actions
    this.bot.action(/^going_(.+)$/, this.handleGoingToSession.bind(this))
    this.bot.action(/^skip_(.+)$/, this.handleSkipSession.bind(this))
  }

  private buildLevelKeyboard(selected: SessionLevel[]) {
    const levels = [
      { display: 'Beginner', value: 'beginner' as SessionLevel },
      { display: 'Improver', value: 'improver' as SessionLevel },
      { display: 'Intermediate', value: 'intermediate' as SessionLevel },
      { display: 'Advanced', value: 'advanced' as SessionLevel },
      { display: 'Advanced Plus', value: 'advanced_plus' as SessionLevel },
      { display: 'Expert', value: 'expert' as SessionLevel },
      { display: 'Expert Turns', value: 'expert_turns' as SessionLevel },
      { display: 'Expert Barrels', value: 'expert_barrels' as SessionLevel },
      { display: 'Women Only', value: 'women_only' as SessionLevel },
      { display: 'Improver Lesson', value: 'improver_lesson' as SessionLevel },
      { display: 'Intermediate Lesson', value: 'intermediate_lesson' as SessionLevel },
    ]

    const buttons = levels.map(level => {
      const check = selected.includes(level.value) ? '✅' : '☐'
      return [Markup.button.callback(`${check} ${level.display}`, `level_${level.value}`)]
    })

    buttons.push([Markup.button.callback('➡️ Next: Preferred Side', 'next_sides')])
    return Markup.inlineKeyboard(buttons).reply_markup
  }

  private async handleNextSides(ctx: WavePingContext) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🏄 Left Side', 'side_L')],
      [Markup.button.callback('🏄 Right Side', 'side_R')],
      [Markup.button.callback('🤷 Any Side', 'side_A')],
      [Markup.button.callback('➡️ Next: Available Days', 'next_days')]
    ]).reply_markup

    await ctx.editMessageText(
      '🏄 *Step 2/5: Preferred Side*\n\n' +
      'Which side do you prefer? (You can select multiple)',
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    )
    await ctx.answerCbQuery()
  }

  private async handleSideSelection(ctx: WavePingContext) {
    const side = ctx.match[1]
    const setup = ctx.session?.setup || { sides: [] }
    
    if (setup.sides.includes(side)) {
      setup.sides = setup.sides.filter(s => s !== side)
    } else {
      setup.sides.push(side)
    }

    const buttons = [
      [Markup.button.callback(
        `${setup.sides.includes('L') ? '✅' : '☐'} Left Side`, 'side_L'
      )],
      [Markup.button.callback(
        `${setup.sides.includes('R') ? '✅' : '☐'} Right Side`, 'side_R'
      )],
      [Markup.button.callback(
        `${setup.sides.includes('A') ? '✅' : '☐'} Any Side`, 'side_A'
      )],
      [Markup.button.callback('➡️ Next: Available Days', 'next_days')]
    ]

    const keyboard = Markup.inlineKeyboard(buttons).reply_markup
    await ctx.editMessageReplyMarkup(keyboard)
    await ctx.answerCbQuery()
  }

  private async handleNextDays(ctx: WavePingContext) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('☐ Mon', 'day_0'), Markup.button.callback('☐ Tue', 'day_1')],
      [Markup.button.callback('☐ Wed', 'day_2'), Markup.button.callback('☐ Thu', 'day_3')],
      [Markup.button.callback('☐ Fri', 'day_4'), Markup.button.callback('☐ Sat', 'day_5')],
      [Markup.button.callback('☐ Sun', 'day_6')],
      [Markup.button.callback('✅ Any day works', 'day_any')],
      [Markup.button.callback('➡️ Next: Time Preferences', 'next_times')]
    ]).reply_markup

    await ctx.editMessageText(
      '📅 *Step 3/5: Available Days*\n\n' +
      'Which days work for you? (Select multiple or any day)',
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    )
    await ctx.answerCbQuery()
  }

  private async handleDaySelection(ctx: WavePingContext) {
    const day = ctx.match[1]
    const setup = ctx.session?.setup || { days: [] }
    
    if (day === 'any') {
      setup.days = [] // Clear specific days if "any day" is selected
    } else {
      const dayNum = parseInt(day)
      if (setup.days.includes(dayNum)) {
        setup.days = setup.days.filter(d => d !== dayNum)
      } else {
        setup.days.push(dayNum)
      }
    }

    // Rebuild keyboard with current selections
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const buttons = [
      [0, 1].map(d => Markup.button.callback(
        `${setup.days.includes(d) ? '✅' : '☐'} ${dayNames[d]}`, `day_${d}`
      )),
      [2, 3].map(d => Markup.button.callback(
        `${setup.days.includes(d) ? '✅' : '☐'} ${dayNames[d]}`, `day_${d}`
      )),
      [4, 5].map(d => Markup.button.callback(
        `${setup.days.includes(d) ? '✅' : '☐'} ${dayNames[d]}`, `day_${d}`
      )),
      [Markup.button.callback(
        `${setup.days.includes(6) ? '✅' : '☐'} ${dayNames[6]}`, `day_6`
      )],
      [Markup.button.callback(
        `${setup.days.length === 0 ? '✅' : '☐'} Any day works`, 'day_any'
      )],
      [Markup.button.callback('➡️ Next: Time Preferences', 'next_times')]
    ]

    const keyboard = Markup.inlineKeyboard(buttons).reply_markup
    await ctx.editMessageReplyMarkup(keyboard)
    await ctx.answerCbQuery()
  }

  private async handleNextTimes(ctx: WavePingContext) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🌅 Early (05:00-09:00)', 'time_early')],
      [Markup.button.callback('☀️ Morning (09:00-12:00)', 'time_morning')],
      [Markup.button.callback('🌞 Afternoon (12:00-17:00)', 'time_afternoon')],
      [Markup.button.callback('🌆 Evening (17:00-22:00)', 'time_evening')],
      [Markup.button.callback('🕐 Any time works', 'time_any')],
      [Markup.button.callback('➡️ Next: Notifications', 'next_notifications')]
    ]).reply_markup

    await ctx.editMessageText(
      '🕐 *Step 4/5: Time Preferences*\n\n' +
      'When do you prefer to surf? (Select multiple or any time)',
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    )
    await ctx.answerCbQuery()
  }

  private async handleTimeSelection(ctx: WavePingContext) {
    const timeSlot = ctx.match[1]
    const setup = ctx.session?.setup || { timeWindows: [] }
    
    const timeWindows = {
      early: { start_time: '05:00', end_time: '09:00' },
      morning: { start_time: '09:00', end_time: '12:00' },
      afternoon: { start_time: '12:00', end_time: '17:00' },
      evening: { start_time: '17:00', end_time: '22:00' }
    }

    if (timeSlot === 'any') {
      setup.timeWindows = []
    } else {
      const window = timeWindows[timeSlot]
      if (window) {
        const existingIndex = setup.timeWindows.findIndex(
          tw => tw.start_time === window.start_time
        )
        if (existingIndex >= 0) {
          setup.timeWindows.splice(existingIndex, 1)
        } else {
          setup.timeWindows.push(window)
        }
      }
    }

    await ctx.answerCbQuery()
  }

  private async handleNextNotifications(ctx: WavePingContext) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('☐ 1 week before', 'notification_1w')],
      [Markup.button.callback('☐ 48 hours before', 'notification_48h')],
      [Markup.button.callback('✅ 24 hours before', 'notification_24h')],
      [Markup.button.callback('☐ 12 hours before', 'notification_12h')],
      [Markup.button.callback('☐ 2 hours before', 'notification_2h')],
      [Markup.button.callback('✅ Finish Setup', 'finish_setup')]
    ]).reply_markup

    await ctx.editMessageText(
      '🔔 *Step 5/5: Notification Timing*\n\n' +
      'When would you like to be notified? (Select multiple)',
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    )
    await ctx.answerCbQuery()
  }

  private async handleNotificationSelection(ctx: WavePingContext) {
    const timing = ctx.match[1] as NotificationTiming
    const setup = ctx.session?.setup || { notifications: [] }
    
    if (setup.notifications.includes(timing)) {
      setup.notifications = setup.notifications.filter(n => n !== timing)
    } else {
      setup.notifications.push(timing)
    }

    await ctx.answerCbQuery()
  }

  private async handleFinishSetup(ctx: WavePingContext) {
    const setup = ctx.session?.setup
    if (!setup) {
      return ctx.reply('Setup data not found. Please start over with /setup')
    }

    // Save preferences to database
    const telegramId = ctx.from.id
    try {
      await this.saveUserPreferences(telegramId, setup)
      
      await ctx.editMessageText(
        '🎉 *Setup Complete!*\n\n' +
        'Your WavePing alerts are now active! 🌊\n\n' +
        'You\'ll receive notifications for sessions matching your preferences.\n\n' +
        'Use /prefs to view or edit your preferences anytime.\n' +
        'Use /today to see today\'s matching sessions.',
        { parse_mode: 'Markdown' }
      )
      
      // Clear session data
      delete ctx.session?.setup
    } catch (error) {
      console.error('Error saving preferences:', error)
      await ctx.reply('Sorry, there was an error saving your preferences. Please try again.')
    }
    
    await ctx.answerCbQuery()
  }

  private async handleGoingToSession(ctx: WavePingContext) {
    const sessionId = ctx.match[1]
    // TODO: Implement session attendance tracking
    await ctx.answerCbQuery('Great! Marked as going 🏄')
  }

  private async handleSkipSession(ctx: WavePingContext) {
    const sessionId = ctx.match[1]
    // TODO: Implement session skip tracking
    await ctx.answerCbQuery('Skipped this session')
  }

  // Database helper methods
  private async getUserPreferences(telegramId: number): Promise<UserPreferences | null> {
    const { data: profile } = await this.supabase
      .from('profiles')
      .select(`
        *,
        user_levels(level),
        user_sides(side),
        user_days(day_of_week),
        user_time_windows(start_time, end_time),
        user_notifications(timing)
      `)
      .eq('telegram_id', telegramId)
      .single()

    if (!profile) return null

    return {
      levels: profile.user_levels?.map(ul => ul.level) || [],
      sides: profile.user_sides?.map(us => us.side) || [],
      days: profile.user_days?.map(ud => ud.day_of_week) || [],
      timeWindows: profile.user_time_windows || [],
      notifications: profile.user_notifications?.map(un => un.timing) || [],
      minSpots: profile.min_spots
    }
  }

  private async saveUserPreferences(telegramId: number, setup: any) {
    // Get user ID
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('telegram_id', telegramId)
      .single()

    if (!profile) throw new Error('User not found')

    const userId = profile.id

    // Delete existing preferences
    await Promise.all([
      this.supabase.from('user_levels').delete().eq('user_id', userId),
      this.supabase.from('user_sides').delete().eq('user_id', userId),
      this.supabase.from('user_days').delete().eq('user_id', userId),
      this.supabase.from('user_time_windows').delete().eq('user_id', userId),
      this.supabase.from('user_notifications').delete().eq('user_id', userId)
    ])

    // Insert new preferences
    const promises = []

    if (setup.levels?.length) {
      promises.push(
        this.supabase.from('user_levels').insert(
          setup.levels.map(level => ({ user_id: userId, level }))
        )
      )
    }

    if (setup.sides?.length) {
      promises.push(
        this.supabase.from('user_sides').insert(
          setup.sides.map(side => ({ user_id: userId, side }))
        )
      )
    }

    if (setup.days?.length) {
      promises.push(
        this.supabase.from('user_days').insert(
          setup.days.map(day_of_week => ({ user_id: userId, day_of_week }))
        )
      )
    }

    if (setup.timeWindows?.length) {
      promises.push(
        this.supabase.from('user_time_windows').insert(
          setup.timeWindows.map(tw => ({ user_id: userId, ...tw }))
        )
      )
    }

    if (setup.notifications?.length) {
      promises.push(
        this.supabase.from('user_notifications').insert(
          setup.notifications.map(timing => ({ user_id: userId, timing }))
        )
      )
    }

    await Promise.all(promises)
  }

  private formatPreferencesMessage(prefs: UserPreferences): string {
    const formatLevels = (levels: SessionLevel[]) => 
      levels.map(l => l.replace('_', ' ')).join(', ') || 'None'
    
    const formatSides = (sides: string[]) => {
      if (!sides.length) return 'Any'
      return sides.map(s => s === 'L' ? 'Left' : s === 'R' ? 'Right' : 'Any').join(', ')
    }

    const formatDays = (days: number[]) => {
      if (!days.length) return 'Any day'
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      return days.map(d => dayNames[d]).join(', ')
    }

    const formatTimes = (windows: any[]) => {
      if (!windows.length) return 'Any time'
      return windows.map(w => `${w.start_time}-${w.end_time}`).join(', ')
    }

    return `⚙️ *Your Current Preferences*\n\n` +
      `📊 *Levels:* ${formatLevels(prefs.levels)}\n` +
      `🏄 *Sides:* ${formatSides(prefs.sides)}\n` +
      `📅 *Days:* ${formatDays(prefs.days)}\n` +
      `🕐 *Times:* ${formatTimes(prefs.timeWindows)}\n` +
      `👥 *Min spots:* ${prefs.minSpots}\n` +
      `🔔 *Notifications:* ${prefs.notifications.join(', ')}`
  }

  private async getTodaysSessions(telegramId: number) {
    // TODO: Implement session fetching with user preferences
    return []
  }

  private async getTomorrowsSessions(telegramId: number) {
    // TODO: Implement session fetching with user preferences
    return []
  }

  private async getWeekSessions(telegramId: number) {
    // TODO: Implement week session fetching
    return []
  }

  private formatSessionsMessage(sessions: any[], timeframe: string): string {
    if (!sessions.length) {
      return `🌊 No matching sessions found for ${timeframe.toLowerCase()}.`
    }

    return `🌊 *${timeframe}'s Sessions*\n\n` + 
      sessions.map(session => 
        `📅 ${session.date} at ${session.start_time}\n` +
        `📊 ${session.session_name}\n` +
        `👥 ${session.spots_available} spots available\n` +
        `[Book Now](${session.book_url})\n`
      ).join('\n')
  }

  private formatWeekMessage(sessions: any[]): string {
    // TODO: Implement week formatting
    return '📅 *7-Day Outlook*\n\nNo sessions found for this week.'
  }

  public async start() {
    console.log('Starting WavePing bot...')
    await this.bot.launch()
    console.log('WavePing bot is running! 🌊')

    // Graceful stop
    process.once('SIGINT', () => this.bot.stop('SIGINT'))
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'))
  }

  public getBot() {
    return this.bot
  }
}