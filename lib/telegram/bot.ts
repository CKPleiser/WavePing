import { Telegraf, Context, Markup, session } from 'telegraf'
import { createAdminClient } from '../supabase/client'
import type { SessionLevel, NotificationTiming, UserPreferences } from '../supabase/types'

export interface SessionData {
  setup?: {
    levels: SessionLevel[]
    sides: string[]
    days: number[]
    timeWindows: { start_time: string; end_time: string }[]
    notifications: NotificationTiming[]
    step: string
  }
}

export interface WavePingContext extends Context {
  session: SessionData
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
    
    // Add session middleware
    this.bot.use(session())
    
    this.setupCommands()
    this.setupCallbackHandlers()
  }

  private setupCommands() {
    // Start command - welcome and setup
    this.bot.command('start', async (ctx) => {
      const telegramId = ctx.from?.id
      if (!telegramId) return ctx.reply('Unable to identify user.')
      const username = ctx.from?.username

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
      const preferences = await this.getUserPreferences(ctx.from?.id || 0)
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
      console.log(`🤖 /today command called by user ${ctx.from?.id}`)
      const sessions = await this.getTodaysSessions(ctx.from?.id || 0)
      console.log(`📅 Got ${sessions.length} sessions for today`)
      const msg = this.formatSessionsMessage(sessions, 'Today')
      console.log(`💬 Sending message: ${msg.substring(0, 100)}...`)
      await ctx.reply(msg, { parse_mode: 'Markdown' })
    })

    // Tomorrow's sessions
    this.bot.command('tomorrow', async (ctx) => {
      const sessions = await this.getTomorrowsSessions(ctx.from?.id || 0)
      const msg = this.formatSessionsMessage(sessions, 'Tomorrow')
      await ctx.reply(msg, { parse_mode: 'Markdown' })
    })

    // Week view
    this.bot.command('week', async (ctx) => {
      const sessions = await this.getWeekSessions(ctx.from?.id || 0)
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
    // Initialize session if it doesn't exist
    if (!ctx.session) {
      ctx.session = {}
    }
    
    // Initialize session setup
    ctx.session.setup = {
      levels: [],
      sides: [],
      days: [],
      timeWindows: [],
      notifications: ['24h'], // Default notification
      step: 'levels'
    }
    
    const keyboard = this.buildLevelKeyboard([])

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
      const level = (ctx as any).match[1] as SessionLevel
      
      // Ensure session exists first
      if (!ctx.session) {
        ctx.session = {}
      }
      
      // Ensure session setup exists
      if (!ctx.session.setup) {
        ctx.session.setup = {
          levels: [],
          sides: [],
          days: [],
          timeWindows: [],
          notifications: ['24h'],
          step: 'levels'
        }
      }
      
      // Toggle level selection
      if (ctx.session.setup.levels.includes(level)) {
        ctx.session.setup.levels = ctx.session.setup.levels.filter(l => l !== level)
      } else {
        ctx.session.setup.levels.push(level)
      }

      const keyboard = this.buildLevelKeyboard(ctx.session.setup.levels)
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

    // Preference editing handlers
    this.bot.action('edit_levels', this.handleEditLevels.bind(this))
    this.bot.action('edit_sides', this.handleEditSides.bind(this))
    this.bot.action('edit_days', this.handleEditDays.bind(this))
    this.bot.action('edit_times', this.handleEditTimes.bind(this))
    this.bot.action('edit_notifications', this.handleEditNotifications.bind(this))
    
    // Save handlers for preference editing
    this.bot.action('save_levels', this.handleSaveLevels.bind(this))
    this.bot.action('save_sides', this.handleSaveSides.bind(this))
    this.bot.action('save_days', this.handleSaveDays.bind(this))
    this.bot.action('save_times', this.handleSaveTimes.bind(this))
    this.bot.action('save_notifications', this.handleSaveNotifications.bind(this))
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

    const buttons = levels.map((level: any) => {
      const check = selected.includes(level.value) ? '✅' : '☐'
      return [Markup.button.callback(`${check} ${level.display}`, `level_${level.value}`)]
    })

    buttons.push([Markup.button.callback('➡️ Next: Preferred Side', 'next_sides')])
    return Markup.inlineKeyboard(buttons).reply_markup
  }

  private async handleNextSides(ctx: WavePingContext) {
    // Initialize with no selection or existing selection
    const currentSide = ctx.session?.setup?.sides?.[0] || ''
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(`${currentSide === 'L' ? '🔘' : '⚪'} Left Side`, 'side_L')],
      [Markup.button.callback(`${currentSide === 'R' ? '🔘' : '⚪'} Right Side`, 'side_R')],
      [Markup.button.callback(`${currentSide === 'A' ? '🔘' : '⚪'} Any Side`, 'side_A')],
      [Markup.button.callback('➡️ Next: Available Days', 'next_days')]
    ]).reply_markup

    await ctx.editMessageText(
      '🏄 *Step 2/5: Preferred Side*\n\n' +
      'Which side do you prefer? (Select one),',
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    )
    await ctx.answerCbQuery()
  }

  private async handleSideSelection(ctx: WavePingContext) {
    const side = (ctx as any).match[1]
    
    // Ensure session exists first
    if (!ctx.session) {
      ctx.session = {}
    }
    
    // Ensure session setup exists
    if (!ctx.session.setup) {
      ctx.session.setup = {
        levels: [],
        sides: [],
        days: [],
        timeWindows: [],
        notifications: ['24h'],
        step: 'sides'
      }
    }
    
    // Single selection - replace any existing selection
    ctx.session.setup.sides = [side]

    const buttons = [
      [Markup.button.callback(
        `${ctx.session.setup.sides[0] === 'L' ? '🔘' : '⚪'} Left Side`, 'side_L'
      )],
      [Markup.button.callback(
        `${ctx.session.setup.sides[0] === 'R' ? '🔘' : '⚪'} Right Side`, 'side_R'
      )],
      [Markup.button.callback(
        `${ctx.session.setup.sides[0] === 'A' ? '🔘' : '⚪'} Any Side`, 'side_A'
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
    const day = (ctx as any).match[1]
    
    // Ensure session exists first
    if (!ctx.session) {
      ctx.session = {}
    }
    
    // Ensure session setup exists
    if (!ctx.session.setup) {
      ctx.session.setup = {
        levels: [],
        sides: [],
        days: [],
        timeWindows: [],
        notifications: ['24h'],
        step: 'days'
      }
    }
    
    if (day === 'any') {
      ctx.session.setup.days = [] // Clear specific days if "any day" is selected
    } else {
      const dayNum = parseInt(day)
      if (ctx.session.setup.days.includes(dayNum)) {
        ctx.session.setup.days = ctx.session.setup.days.filter(d => d !== dayNum)
      } else {
        ctx.session.setup.days.push(dayNum)
      }
    }

    // Rebuild keyboard with current selections
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const buttons = [
      [0, 1].map((d: number) => Markup.button.callback(
        `${ctx.session.setup?.days.includes(d) ? '✅' : '☐'} ${dayNames[d]}`, `day_${d}`
      )),
      [2, 3].map((d: number) => Markup.button.callback(
        `${ctx.session.setup?.days.includes(d) ? '✅' : '☐'} ${dayNames[d]}`, `day_${d}`
      )),
      [4, 5].map((d: number) => Markup.button.callback(
        `${ctx.session.setup?.days.includes(d) ? '✅' : '☐'} ${dayNames[d]}`, `day_${d}`
      )),
      [Markup.button.callback(
        `${ctx.session.setup?.days.includes(6) ? '✅' : '☐'} ${dayNames[6]}`, `day_6`
      )],
      [Markup.button.callback(
        `${ctx.session.setup?.days.length === 0 ? '✅' : '☐'} Any day works`, 'day_any'
      )],
      [Markup.button.callback('➡️ Next: Time Preferences', 'next_times')]
    ]

    const keyboard = Markup.inlineKeyboard(buttons).reply_markup
    await ctx.editMessageReplyMarkup(keyboard)
    await ctx.answerCbQuery()
  }

  private async handleNextTimes(ctx: WavePingContext) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('☐ Early (05:00-09:00)', 'time_early')],
      [Markup.button.callback('☐ Morning (09:00-12:00)', 'time_morning')],
      [Markup.button.callback('☐ Afternoon (12:00-17:00)', 'time_afternoon')],
      [Markup.button.callback('☐ Evening (17:00-22:00)', 'time_evening')],
      [Markup.button.callback('☐ Any time works', 'time_any')],
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
    const timeSlot = (ctx as any).match[1]
    
    // Ensure session exists first
    if (!ctx.session) {
      ctx.session = {}
    }
    
    // Ensure session setup exists
    if (!ctx.session.setup) {
      ctx.session.setup = {
        levels: [],
        sides: [],
        days: [],
        timeWindows: [],
        notifications: ['24h'],
        step: 'times'
      }
    }
    
    const timeWindows = {
      early: { start_time: '05:00', end_time: '09:00' },
      morning: { start_time: '09:00', end_time: '12:00' },
      afternoon: { start_time: '12:00', end_time: '17:00' },
      evening: { start_time: '17:00', end_time: '22:00' }
    }

    if (timeSlot === 'any') {
      ctx.session.setup.timeWindows = []
    } else {
      const window = timeWindows[timeSlot as keyof typeof timeWindows]
      if (window) {
        const existingIndex = ctx.session.setup.timeWindows.findIndex(
          tw => tw.start_time === window.start_time
        )
        if (existingIndex >= 0) {
          ctx.session.setup.timeWindows.splice(existingIndex, 1)
        } else {
          ctx.session.setup.timeWindows.push(window)
        }
      }
    }

    // Helper function to check if a time slot is selected
    const isTimeSelected = (slot: string) => {
      if (slot === 'any') return ctx.session.setup?.timeWindows?.length === 0
      const window = timeWindows[slot as keyof typeof timeWindows]
      return window && ctx.session.setup?.timeWindows?.some(tw => tw.start_time === window.start_time)
    }

    // Rebuild keyboard with current selections
    const buttons = [
      [Markup.button.callback(
        `${isTimeSelected('early') ? '✅' : '☐'} Early (05:00-09:00)`, 'time_early'
      )],
      [Markup.button.callback(
        `${isTimeSelected('morning') ? '✅' : '☐'} Morning (09:00-12:00)`, 'time_morning'
      )],
      [Markup.button.callback(
        `${isTimeSelected('afternoon') ? '✅' : '☐'} Afternoon (12:00-17:00)`, 'time_afternoon'
      )],
      [Markup.button.callback(
        `${isTimeSelected('evening') ? '✅' : '☐'} Evening (17:00-22:00)`, 'time_evening'
      )],
      [Markup.button.callback(
        `${isTimeSelected('any') ? '✅' : '☐'} Any time works`, 'time_any'
      )],
      [Markup.button.callback('➡️ Next: Notifications', 'next_notifications')]
    ]

    const keyboard = Markup.inlineKeyboard(buttons).reply_markup
    await ctx.editMessageReplyMarkup(keyboard)
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
    const timing = (ctx as any).match[1] as NotificationTiming
    const setup = ctx.session?.setup || { notifications: [] as NotificationTiming[] }
    
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
    const telegramId = ctx.from?.id
    if (!telegramId) {
      return ctx.reply('Unable to identify user. Please try again.')
    }
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
    const sessionId = (ctx as any).match[1]
    // TODO: Implement session attendance tracking
    await ctx.answerCbQuery('Great! Marked as going 🏄')
  }

  private async handleSkipSession(ctx: WavePingContext) {
    const sessionId = (ctx as any).match[1]
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
      levels: profile.user_levels?.map((ul: any) => ul.level) || [],
      sides: profile.user_sides?.map((us: any) => us.side) || [],
      days: profile.user_days?.map((ud: any) => ud.day_of_week) || [],
      timeWindows: profile.user_time_windows || [],
      notifications: profile.user_notifications?.map((un: any) => un.timing) || [],
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
          setup.levels.map((level: any) => ({ user_id: userId, level }))
        )
      )
    }

    if (setup.sides?.length) {
      promises.push(
        this.supabase.from('user_sides').insert(
          setup.sides.map((side: any) => ({ user_id: userId, side }))
        )
      )
    }

    if (setup.days?.length) {
      promises.push(
        this.supabase.from('user_days').insert(
          setup.days.map((day_of_week: any) => ({ user_id: userId, day_of_week }))
        )
      )
    }

    if (setup.timeWindows?.length) {
      promises.push(
        this.supabase.from('user_time_windows').insert(
          setup.timeWindows.map((tw: any) => ({ user_id: userId, ...tw }))
        )
      )
    }

    if (setup.notifications?.length) {
      promises.push(
        this.supabase.from('user_notifications').insert(
          setup.notifications.map((timing: any) => ({ user_id: userId, timing }))
        )
      )
    }

    await Promise.all(promises)
  }

  private formatPreferencesMessage(prefs: UserPreferences): string {
    const formatLevels = (levels: SessionLevel[]) => 
      levels.map((l: any) => l.replace('_', ' ')).join(', ') || 'None'
    
    const formatSides = (sides: string[]) => {
      if (!sides.length) return 'Any'
      return sides.map((s: any) => s === 'L' ? 'Left' : s === 'R' ? 'Right' : 'Any').join(', ')
    }

    const formatDays = (days: number[]) => {
      if (!days.length) return 'Any day'
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      return days.map((d: any) => dayNames[d]).join(', ')
    }

    const formatTimes = (windows: any[]) => {
      if (!windows.length) return 'Any time'
      return windows.map((w: any) => `${w.start_time}-${w.end_time}`).join(', ')
    }

    return `⚙️ *Your Current Preferences*\n\n` +
      `📊 *Levels:* ${formatLevels(prefs.levels)}\n` +
      `🏄 *Sides:* ${formatSides(prefs.sides)}\n` +
      `📅 *Days:* ${formatDays(prefs.days)}\n` +
      `🕐 *Times:* ${formatTimes(prefs.timeWindows)}\n` +
      `👥 *Min spots:* ${prefs.minSpots}\n` +
      `🔔 *Notifications:* ${prefs.notifications.join(', ')}`
  }

  // Preference editing handlers
  private async handleEditLevels(ctx: WavePingContext) {
    try {
      const telegramId = ctx.from?.id
      if (!telegramId) return ctx.reply('Unable to identify user.')
      
      // Get current user levels
      const { data: userLevels } = await this.supabase
        .from('user_levels')
        .select('level')
        .eq('user_id', (await this.getUserId(telegramId)))
      
      const currentLevels = userLevels?.map((ul: any) => ul.level) || []
      
      // Initialize session state for editing
      if (!ctx.session) {
        ctx.session = {}
      }
      ctx.session.setup = {
        levels: currentLevels,
        sides: [],
        days: [],
        timeWindows: [],
        notifications: ['24h'],
        step: 'levels'
      }
      
      const keyboard = this.buildLevelKeyboard(currentLevels)
      
      // Add save button
      const keyboardData = keyboard.inline_keyboard
      keyboardData.push([Markup.button.callback('💾 Save Changes', 'save_levels')])
      
      await ctx.editMessageText(
        '⚙️ *Edit Session Levels*\n\n' +
        'Select all the session levels you\'re interested in:',
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboardData }
        }
      )
      await ctx.answerCbQuery()
    } catch (error) {
      console.error('Error in handleEditLevels:', error)
      await ctx.answerCbQuery('Error loading levels')
    }
  }

  private async handleEditSides(ctx: WavePingContext) {
    try {
      const telegramId = ctx.from?.id
      if (!telegramId) return ctx.reply('Unable to identify user.')
      
      // Get current user side
      const { data: userSides } = await this.supabase
        .from('user_sides')
        .select('side')
        .eq('user_id', (await this.getUserId(telegramId)))
      
      const currentSide = userSides?.[0]?.side || ''
      
      // Initialize session state
      if (!ctx.session) {
        ctx.session = {}
      }
      ctx.session.setup = {
        levels: [],
        sides: currentSide ? [currentSide] : [],
        days: [],
        timeWindows: [],
        notifications: ['24h'],
        step: 'sides'
      }
      
      const buttons = [
        [Markup.button.callback(`${currentSide === 'L' ? '🔘' : '⚪'} Left Side`, 'side_L')],
        [Markup.button.callback(`${currentSide === 'R' ? '🔘' : '⚪'} Right Side`, 'side_R')],
        [Markup.button.callback(`${currentSide === 'A' ? '🔘' : '⚪'} Any Side`, 'side_A')],
        [Markup.button.callback('💾 Save Changes', 'save_sides')]
      ]
      
      await ctx.editMessageText(
        '🏄 *Edit Preferred Side*\n\n' +
        'Which side do you prefer? (Select one)',
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard(buttons).reply_markup
        }
      )
      await ctx.answerCbQuery()
    } catch (error) {
      console.error('Error in handleEditSides:', error)
      await ctx.answerCbQuery('Error loading sides')
    }
  }

  private async handleEditDays(ctx: WavePingContext) {
    try {
      const telegramId = ctx.from?.id
      if (!telegramId) return ctx.reply('Unable to identify user.')
      
      // Get current user days
      const { data: userDays } = await this.supabase
        .from('user_days')
        .select('day_of_week')
        .eq('user_id', (await this.getUserId(telegramId)))
      
      const currentDays = userDays?.map((ud: any) => ud.day_of_week) || []
      
      // Initialize session state
      if (!ctx.session) {
        ctx.session = {}
      }
      ctx.session.setup = {
        levels: [],
        sides: [],
        days: currentDays,
        timeWindows: [],
        notifications: ['24h'],
        step: 'days'
      }
      
      // Build days keyboard with current selections
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      const buttons = [
        [0, 1].map((d: number) => Markup.button.callback(
          `${currentDays.includes(d) ? '✅' : '☐'} ${dayNames[d]}`, `day_${d}`
        )),
        [2, 3].map((d: number) => Markup.button.callback(
          `${currentDays.includes(d) ? '✅' : '☐'} ${dayNames[d]}`, `day_${d}`
        )),
        [4, 5].map((d: number) => Markup.button.callback(
          `${currentDays.includes(d) ? '✅' : '☐'} ${dayNames[d]}`, `day_${d}`
        )),
        [Markup.button.callback(
          `${currentDays.includes(6) ? '✅' : '☐'} ${dayNames[6]}`, 'day_6'
        )],
        [Markup.button.callback(
          `${currentDays.length === 0 ? '✅' : '☐'} Any day works`, 'day_any'
        )],
        [Markup.button.callback('💾 Save Changes', 'save_days')]
      ]
      
      await ctx.editMessageText(
        '📅 *Edit Available Days*\n\n' +
        'Which days work for you? (Select multiple or any day)',
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard(buttons).reply_markup
        }
      )
      await ctx.answerCbQuery()
    } catch (error) {
      console.error('Error in handleEditDays:', error)
      await ctx.answerCbQuery('Error loading days')
    }
  }

  private async handleEditTimes(ctx: WavePingContext) {
    try {
      const telegramId = ctx.from?.id
      if (!telegramId) return ctx.reply('Unable to identify user.')
      
      // Get current user time windows
      const { data: userTimes } = await this.supabase
        .from('user_time_windows')
        .select('start_time, end_time')
        .eq('user_id', (await this.getUserId(telegramId)))
      
      // Initialize session state
      if (!ctx.session) {
        ctx.session = {}
      }
      ctx.session.setup = {
        levels: [],
        sides: [],
        days: [],
        timeWindows: userTimes || [],
        notifications: ['24h'],
        step: 'times'
      }
      
      // Helper function to check if a time slot is selected
      const timeWindows = {
        early: { start_time: '05:00', end_time: '09:00' },
        morning: { start_time: '09:00', end_time: '12:00' },
        afternoon: { start_time: '12:00', end_time: '17:00' },
        evening: { start_time: '17:00', end_time: '22:00' }
      }
      
      const isTimeSelected = (slot: string) => {
        if (slot === 'any') return userTimes?.length === 0
        const window = timeWindows[slot as keyof typeof timeWindows]
        return window && userTimes?.some((tw: any) => tw.start_time === window.start_time)
      }
      
      const buttons = [
        [Markup.button.callback(
          `${isTimeSelected('early') ? '✅' : '☐'} Early (05:00-09:00)`, 'time_early'
        )],
        [Markup.button.callback(
          `${isTimeSelected('morning') ? '✅' : '☐'} Morning (09:00-12:00)`, 'time_morning'
        )],
        [Markup.button.callback(
          `${isTimeSelected('afternoon') ? '✅' : '☐'} Afternoon (12:00-17:00)`, 'time_afternoon'
        )],
        [Markup.button.callback(
          `${isTimeSelected('evening') ? '✅' : '☐'} Evening (17:00-22:00)`, 'time_evening'
        )],
        [Markup.button.callback(
          `${isTimeSelected('any') ? '✅' : '☐'} Any time works`, 'time_any'
        )],
        [Markup.button.callback('💾 Save Changes', 'save_times')]
      ]
      
      await ctx.editMessageText(
        '🕐 *Edit Time Preferences*\n\n' +
        'When do you prefer to surf? (Select multiple or any time)',
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard(buttons).reply_markup
        }
      )
      await ctx.answerCbQuery()
    } catch (error) {
      console.error('Error in handleEditTimes:', error)
      await ctx.answerCbQuery('Error loading times')
    }
  }

  private async handleEditNotifications(ctx: WavePingContext) {
    try {
      const telegramId = ctx.from?.id
      if (!telegramId) return ctx.reply('Unable to identify user.')
      
      // Get current user notifications
      const { data: userNotifications } = await this.supabase
        .from('user_notifications')
        .select('timing')
        .eq('user_id', (await this.getUserId(telegramId)))
      
      const currentNotifications = userNotifications?.map((un: any) => un.timing) || ['24h']
      
      // Initialize session state
      if (!ctx.session) {
        ctx.session = {}
      }
      ctx.session.setup = {
        levels: [],
        sides: [],
        days: [],
        timeWindows: [],
        notifications: currentNotifications,
        step: 'notifications'
      }
      
      const buttons = [
        [Markup.button.callback(
          `${currentNotifications.includes('1w') ? '✅' : '☐'} 1 week before`, 'notification_1w'
        )],
        [Markup.button.callback(
          `${currentNotifications.includes('48h') ? '✅' : '☐'} 48 hours before`, 'notification_48h'
        )],
        [Markup.button.callback(
          `${currentNotifications.includes('24h') ? '✅' : '☐'} 24 hours before`, 'notification_24h'
        )],
        [Markup.button.callback(
          `${currentNotifications.includes('12h') ? '✅' : '☐'} 12 hours before`, 'notification_12h'
        )],
        [Markup.button.callback(
          `${currentNotifications.includes('2h') ? '✅' : '☐'} 2 hours before`, 'notification_2h'
        )],
        [Markup.button.callback('💾 Save Changes', 'save_notifications')]
      ]
      
      await ctx.editMessageText(
        '🔔 *Edit Notification Timing*\n\n' +
        'When would you like to be notified? (Select multiple)',
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard(buttons).reply_markup
        }
      )
      await ctx.answerCbQuery()
    } catch (error) {
      console.error('Error in handleEditNotifications:', error)
      await ctx.answerCbQuery('Error loading notifications')
    }
  }

  private async getUserId(telegramId: number): Promise<string> {
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('telegram_id', telegramId)
      .single()
    
    return profile?.id || ''
  }

  // Save handlers for preference editing
  private async handleSaveLevels(ctx: WavePingContext) {
    try {
      const userId = await this.getUserId(ctx.from?.id || 0)
      const selectedLevels = ctx.session?.setup?.levels || []
      
      // Delete existing levels
      await this.supabase.from('user_levels').delete().eq('user_id', userId)
      
      // Insert new levels
      if (selectedLevels.length > 0) {
        const levelData = selectedLevels.map((level: any) => ({ user_id: userId, level }))
        await this.supabase.from('user_levels').insert(levelData)
      }
      
      await ctx.editMessageText('✅ Session levels saved successfully!')
      await ctx.answerCbQuery('Levels saved!')
      
      // Return to preferences view after 2 seconds
      setTimeout(() => this.showPreferences(ctx), 2000)
    } catch (error) {
      console.error('Error saving levels:', error)
      await ctx.answerCbQuery('Error saving levels')
    }
  }

  private async handleSaveSides(ctx: WavePingContext) {
    try {
      const userId = await this.getUserId(ctx.from?.id || 0)
      const selectedSide = ctx.session?.setup?.sides?.[0]
      
      // Delete existing sides
      await this.supabase.from('user_sides').delete().eq('user_id', userId)
      
      // Insert new side
      if (selectedSide) {
        await this.supabase.from('user_sides').insert({ user_id: userId, side: selectedSide })
      }
      
      await ctx.editMessageText('✅ Side preference saved successfully!')
      await ctx.answerCbQuery('Side saved!')
      
      setTimeout(() => this.showPreferences(ctx), 2000)
    } catch (error) {
      console.error('Error saving side:', error)
      await ctx.answerCbQuery('Error saving side')
    }
  }

  private async handleSaveDays(ctx: WavePingContext) {
    try {
      const userId = await this.getUserId(ctx.from?.id || 0)
      const selectedDays = ctx.session?.setup?.days || []
      
      // Delete existing days
      await this.supabase.from('user_days').delete().eq('user_id', userId)
      
      // Insert new days
      if (selectedDays.length > 0) {
        const dayData = selectedDays.map((day: any) => ({ user_id: userId, day_of_week: day }))
        await this.supabase.from('user_days').insert(dayData)
      }
      
      await ctx.editMessageText('✅ Available days saved successfully!')
      await ctx.answerCbQuery('Days saved!')
      
      setTimeout(() => this.showPreferences(ctx), 2000)
    } catch (error) {
      console.error('Error saving days:', error)
      await ctx.answerCbQuery('Error saving days')
    }
  }

  private async handleSaveTimes(ctx: WavePingContext) {
    try {
      const userId = await this.getUserId(ctx.from?.id || 0)
      const selectedTimeWindows = ctx.session?.setup?.timeWindows || []
      
      // Delete existing time windows
      await this.supabase.from('user_time_windows').delete().eq('user_id', userId)
      
      // Insert new time windows
      if (selectedTimeWindows.length > 0) {
        const timeData = selectedTimeWindows.map((tw: any) => ({ 
          user_id: userId, 
          start_time: tw.start_time, 
          end_time: tw.end_time 
        }))
        await this.supabase.from('user_time_windows').insert(timeData)
      }
      
      await ctx.editMessageText('✅ Time preferences saved successfully!')
      await ctx.answerCbQuery('Times saved!')
      
      setTimeout(() => this.showPreferences(ctx), 2000)
    } catch (error) {
      console.error('Error saving times:', error)
      await ctx.answerCbQuery('Error saving times')
    }
  }

  private async handleSaveNotifications(ctx: WavePingContext) {
    try {
      const userId = await this.getUserId(ctx.from?.id || 0)
      const selectedNotifications = ctx.session?.setup?.notifications || ['24h']
      
      // Delete existing notifications
      await this.supabase.from('user_notifications').delete().eq('user_id', userId)
      
      // Insert new notifications
      const notificationData = selectedNotifications.map((timing: any) => ({ user_id: userId, timing }))
      await this.supabase.from('user_notifications').insert(notificationData)
      
      await ctx.editMessageText('✅ Notification preferences saved successfully!')
      await ctx.answerCbQuery('Notifications saved!')
      
      setTimeout(() => this.showPreferences(ctx), 2000)
    } catch (error) {
      console.error('Error saving notifications:', error)
      await ctx.answerCbQuery('Error saving notifications')
    }
  }

  private async showPreferences(ctx: WavePingContext) {
    // Redirect back to /prefs view - reuse the preferences command handler
    const telegramId = ctx.from?.id
    if (!telegramId) return ctx.reply('Unable to identify user.')
    const preferences = await this.getUserPreferences(telegramId)
    if (!preferences) return ctx.reply('No preferences found. Please run /setup first.')
    const msg = this.formatPreferencesMessage(preferences)
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⚙️ Edit Levels', 'edit_levels')],
      [Markup.button.callback('🏄 Edit Sides', 'edit_sides')],
      [Markup.button.callback('📅 Edit Days', 'edit_days')],
      [Markup.button.callback('🕐 Edit Times', 'edit_times')],
      [Markup.button.callback('🔔 Edit Notifications', 'edit_notifications')]
    ]).reply_markup
    
    await ctx.editMessageText(msg, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    })
  }

  private async getTodaysSessions(telegramId: number) {
    try {
      const today = new Date()
      const todayStr = today.toISOString().split('T')[0] // YYYY-MM-DD format
      const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1 // Convert Sunday=0 to Monday=0 format
      
      console.log(`🔍 Getting sessions for ${todayStr} (day ${dayOfWeek}) for user ${telegramId}`)
      
      // Get user preferences
      const { data: userPrefs } = await this.supabase
        .from('profiles')
        .select(`
          *,
          user_levels (level),
          user_sides (side), 
          user_days (day_of_week),
          user_time_windows (start_time, end_time)
        `)
        .eq('telegram_id', telegramId)
        .single()
      
      // Get all today's sessions
      const { data: allSessions, error } = await this.supabase
        .from('sessions')
        .select('*')
        .eq('date', todayStr)
        .order('start_time', { ascending: true })
      
      if (error) {
        console.error('Error fetching sessions:', error)
        return []
      }

      if (!allSessions?.length) {
        console.log(`📅 No sessions found for ${todayStr}`)
        return []
      }

      // Filter sessions based on user preferences
      let filteredSessions = allSessions

      // Filter by user's available days
      if (userPrefs?.user_days?.length > 0) {
        const userDays = userPrefs.user_days.map((d: any) => d.day_of_week)
        if (!userDays.includes(dayOfWeek)) {
          console.log(`🚫 Today (${dayOfWeek}) not in user's available days: [${userDays.join(', ')}]`)
          return []
        }
      }

      // Filter by user's preferred session levels (if any set)
      if (userPrefs?.user_levels?.length > 0) {
        const userLevels = userPrefs.user_levels.map((l: any) => l.level)
        console.log(`🎯 Filtering by user levels: [${userLevels.join(', ')}]`)
        
        filteredSessions = filteredSessions.filter((session: any) => {
          const sessionName = session.session_name.toLowerCase()
          return userLevels.some((level: any) => {
            switch(level) {
              case 'beginner': return sessionName.includes('beginner')
              case 'improver': return sessionName.includes('improver') && !sessionName.includes('lesson')
              case 'intermediate': return sessionName.includes('intermediate') && !sessionName.includes('lesson')
              case 'advanced': return sessionName.includes('advanced')
              case 'advanced_plus': return sessionName.includes('advanced plus')
              case 'expert': return sessionName.includes('expert')
              case 'expert_turns': return sessionName.includes('expert turns')
              case 'expert_barrels': return sessionName.includes('expert barrels')
              case 'women_only': return sessionName.includes('women')
              case 'improver_lesson': return sessionName.includes('improver') && sessionName.includes('lesson')
              case 'intermediate_lesson': return sessionName.includes('intermediate') && sessionName.includes('lesson')
              default: return false
            }
          })
        })
      }

      // Filter by user's time preferences (if any set)
      if (userPrefs?.user_time_windows?.length > 0) {
        filteredSessions = filteredSessions.filter((session: any) => {
          const sessionTime = session.start_time
          return userPrefs.user_time_windows.some((window: any) => {
            return sessionTime >= window.start_time && sessionTime <= window.end_time
          })
        })
      }

      console.log(`🌊 Found ${allSessions.length} total sessions, ${filteredSessions.length} match user preferences`)
      
      return filteredSessions || []
    } catch (error) {
      console.error('Error in getTodaysSessions:', error)
      return []
    }
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
      return `🌊 No matching sessions found for ${timeframe.toLowerCase()}.\n\n` +
             `Try adjusting your preferences with /prefs to see more sessions.`
    }

    const formatTime = (timeStr: string) => {
      const time = timeStr.substring(0, 5) // HH:MM format
      return time
    }

    const formatDate = (dateStr: string) => {
      const date = new Date(dateStr + 'T00:00:00Z')
      return date.toLocaleDateString('en-GB', { 
        weekday: 'short', 
        day: 'numeric', 
        month: 'short'
      })
    }

    const getSessionLevel = (sessionName: string) => {
      // Map session names to skill levels
      const name = sessionName.toLowerCase()
      if (name.includes('beginner')) return '🟢 Beginner'
      if (name.includes('improver') && !name.includes('lesson')) return '🔵 Improver'
      if (name.includes('intermediate') && !name.includes('lesson')) return '🟠 Intermediate'
      if (name.includes('advanced')) return '🔴 Advanced'
      if (name.includes('expert')) return '⚫ Expert'
      if (name.includes('lesson')) return '📚 Lesson'
      if (name.includes('women')) return '👩 Women Only'
      return '🏄 Open Session'
    }

    const formatSpots = (spots: number | null) => {
      if (spots === null || spots === undefined) return '🎫 Spots TBA'
      if (spots === 0) return '❌ Fully Booked'
      if (spots <= 3) return `🔥 ${spots} spots left`
      return `✅ ${spots} spots available`
    }

    return `🌊 *${timeframe}'s Sessions*\n\n` + 
      sessions.map((session: any) => 
        `${getSessionLevel(session.session_name)} *${formatTime(session.start_time)}*\n` +
        `📅 ${formatDate(session.date)}\n` +
        `${formatSpots(session.spots_available)}\n` +
        (session.book_url ? `🔗 [Book Now](${session.book_url})` : '🔗 Booking link coming soon') +
        '\n\n'
      ).join('')
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