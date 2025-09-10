const express = require('express')
const { Telegraf, session, Markup } = require('telegraf')
const { createClient } = require('@supabase/supabase-js')

const app = express()
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN)

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Add session middleware
bot.use(session())

// Homepage
app.get('/', (req, res) => {
  res.json({ 
    name: 'WavePing Bot',
    status: 'running',
    description: 'Smart Telegram bot for The Wave Bristol surf session alerts',
    bot: '@WavePingBot'
  })
})

// Health check endpoint  
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() })
})

// Basic bot commands
bot.start((ctx) => {
  ctx.reply('🌊 Welcome to WavePing! Use /setup to get started.')
})

bot.command('prefs', async (ctx) => {
  try {
    const preferences = await getUserPreferences(ctx.from.id)
    
    if (!preferences) {
      return ctx.reply("You haven't set up preferences yet. Use /setup to get started.")
    }

    const message = formatPreferencesMessage(preferences)
    
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('⚙️ Edit Levels', 'edit_levels')],
        [Markup.button.callback('🏄 Edit Sides', 'edit_sides')],
        [Markup.button.callback('📅 Edit Days', 'edit_days')],
        [Markup.button.callback('🕐 Edit Times', 'edit_times')],
        [Markup.button.callback('🔔 Edit Notifications', 'edit_notifications')]
      ]).reply_markup
    })
  } catch (error) {
    console.error('Error showing preferences:', error)
    ctx.reply('Error loading preferences. Try again later.')
  }
})

bot.command('today', async (ctx) => {
  ctx.reply('🔍 Getting today\'s sessions...')
  
  try {
    const today = new Date().toISOString().split('T')[0]
    
    // Get sessions for today
    const { data: sessions, error } = await supabase
      .from('sessions')
      .select('*')
      .gte('date_time', `${today}T00:00:00`)
      .lt('date_time', `${today}T23:59:59`)
      .order('date_time')
    
    if (error) {
      console.error('Error fetching sessions:', error)
      return ctx.reply('❌ Error loading sessions. Try again later.')
    }
    
    if (!sessions || sessions.length === 0) {
      // Show sample data if no sessions in database
      const sampleSessions = [
        { time: '09:00', level: 'Beginner', side: 'Left', spots: 3 },
        { time: '10:30', level: 'Intermediate', side: 'Right', spots: 1 },
        { time: '14:00', level: 'Advanced', side: 'Any', spots: 5 },
        { time: '16:30', level: 'Expert', side: 'Left', spots: 2 }
      ]
      
      let message = `🏄‍♂️ *Today's Sessions (${today})*\n\n`
      message += `📝 *Sample data - real sessions coming soon*\n\n`
      
      sampleSessions.forEach(session => {
        message += `🕐 *${session.time}* - ${session.level}\n`
        message += `📍 Side: ${session.side} | 🎫 Spots: ${session.spots}\n\n`
      })
      
      return ctx.reply(message, { parse_mode: 'Markdown' })
    }
    
    let message = `🏄‍♂️ *Today's Sessions (${today})*\n\n`
    
    sessions.forEach(session => {
      const time = new Date(session.date_time).toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })
      const spots = session.available_spots || 0
      const level = session.session_level || 'Unknown'
      const side = session.side || 'Any'
      
      message += `🕐 *${time}* - ${level}\n`
      message += `📍 Side: ${side} | 🎫 Spots: ${spots}\n\n`
    })
    
    ctx.reply(message, { parse_mode: 'Markdown' })
    
  } catch (error) {
    console.error('Error in today command:', error)
    ctx.reply('❌ Error loading today\'s sessions.')
  }
})

bot.command('tomorrow', async (ctx) => {
  ctx.reply('🔍 Getting tomorrow\'s sessions...')
  
  try {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]
    
    // Get sessions for tomorrow
    const { data: sessions, error } = await supabase
      .from('sessions')
      .select('*')
      .gte('date_time', `${tomorrowStr}T00:00:00`)
      .lt('date_time', `${tomorrowStr}T23:59:59`)
      .order('date_time')
    
    if (error) {
      console.error('Error fetching sessions:', error)
      return ctx.reply('❌ Error loading sessions. Try again later.')
    }
    
    if (!sessions || sessions.length === 0) {
      // Show sample data if no sessions in database
      const sampleSessions = [
        { time: '08:30', level: 'Improver', side: 'Right', spots: 4 },
        { time: '11:00', level: 'Intermediate', side: 'Left', spots: 2 },
        { time: '13:30', level: 'Advanced', side: 'Any', spots: 6 },
        { time: '15:00', level: 'Expert', side: 'Right', spots: 1 },
        { time: '17:30', level: 'Beginner', side: 'Any', spots: 8 }
      ]
      
      let message = `🏄‍♂️ *Tomorrow's Sessions (${tomorrowStr})*\n\n`
      message += `📝 *Sample data - real sessions coming soon*\n\n`
      
      sampleSessions.forEach(session => {
        message += `🕐 *${session.time}* - ${session.level}\n`
        message += `📍 Side: ${session.side} | 🎫 Spots: ${session.spots}\n\n`
      })
      
      return ctx.reply(message, { parse_mode: 'Markdown' })
    }
    
    let message = `🏄‍♂️ *Tomorrow's Sessions (${tomorrowStr})*\n\n`
    
    sessions.forEach(session => {
      const time = new Date(session.date_time).toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })
      const spots = session.available_spots || 0
      const level = session.session_level || 'Unknown'
      const side = session.side || 'Any'
      
      message += `🕐 *${time}* - ${level}\n`
      message += `📍 Side: ${side} | 🎫 Spots: ${spots}\n\n`
    })
    
    ctx.reply(message, { parse_mode: 'Markdown' })
    
  } catch (error) {
    console.error('Error in tomorrow command:', error)
    ctx.reply('❌ Error loading tomorrow\'s sessions.')
  }
})


bot.command('setup', async (ctx) => {
  try {
    // Create user profile if doesn't exist
    const { error } = await supabase
      .from('profiles')
      .upsert({
        telegram_id: ctx.from.id,
        telegram_username: ctx.from.username || null
      }, { 
        onConflict: 'telegram_id',
        ignoreDuplicates: false 
      })

    if (error) {
      console.error('Error creating profile:', error)
      return ctx.reply('Error setting up profile. Try again later.')
    }

    // Start with level selection
    await ctx.reply('⚙️ *Let\'s set up your preferences!*\n\nFirst, select your session levels:', {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('🟢 Beginner', 'level_beginner')],
        [Markup.button.callback('🔵 Improver', 'level_improver')],
        [Markup.button.callback('🟡 Intermediate', 'level_intermediate')],
        [Markup.button.callback('🟠 Advanced', 'level_advanced')],
        [Markup.button.callback('🔴 Expert', 'level_expert')],
        [Markup.button.callback('💾 Save Levels', 'save_levels')]
      ]).reply_markup
    })
  } catch (error) {
    console.error('Error in setup:', error)
    ctx.reply('Error starting setup. Try again later.')
  }
})

// Callback handlers
bot.action('edit_levels', async (ctx) => {
  await ctx.answerCbQuery('Loading levels...')
  await ctx.editMessageText('⚙️ *Edit Session Levels*\n\nSelect your session levels:', {
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('🟢 Beginner', 'level_beginner')],
      [Markup.button.callback('🔵 Improver', 'level_improver')],
      [Markup.button.callback('🟡 Intermediate', 'level_intermediate')],
      [Markup.button.callback('🟠 Advanced', 'level_advanced')],
      [Markup.button.callback('🔴 Expert', 'level_expert')],
      [Markup.button.callback('💾 Save', 'save_levels')]
    ]).reply_markup
  })
})

// Level selection handlers - just save directly to database
bot.action(/level_(.+)/, async (ctx) => {
  try {
    const level = ctx.match[1]
    const telegramId = ctx.from.id
    
    await ctx.answerCbQuery(`Selected: ${level}`)
    
    // Get or create user profile
    let userProfile = await getUserProfile(telegramId)
    if (!userProfile) {
      const { data } = await supabase
        .from('profiles')
        .insert({ telegram_id: telegramId, telegram_username: ctx.from.username })
        .select()
        .single()
      userProfile = data
    }
    
    // Check if level already exists
    const { data: existingLevel } = await supabase
      .from('user_levels')
      .select('*')
      .eq('user_id', userProfile.id)
      .eq('level', level)
      .single()
    
    if (existingLevel) {
      // Remove level
      await supabase
        .from('user_levels')
        .delete()
        .eq('user_id', userProfile.id)
        .eq('level', level)
    } else {
      // Add level
      await supabase
        .from('user_levels')
        .insert({ user_id: userProfile.id, level: level })
    }
    
    // Get current levels and update message
    const { data: userLevels } = await supabase
      .from('user_levels')
      .select('level')
      .eq('user_id', userProfile.id)
    
    const currentLevels = userLevels?.map(ul => ul.level) || []
    const selectedText = currentLevels.length > 0 
      ? `\n\n*Currently selected*: ${currentLevels.join(', ')}`
      : ''
    
    console.log('Current levels from DB:', currentLevels)
    
    await ctx.editMessageText(`⚙️ *Edit Session Levels*\n\nClick levels to toggle them:${selectedText}`, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`${currentLevels.includes('beginner') ? '✅ ' : ''}🟢 Beginner`, 'level_beginner')],
        [Markup.button.callback(`${currentLevels.includes('improver') ? '✅ ' : ''}🔵 Improver`, 'level_improver')],
        [Markup.button.callback(`${currentLevels.includes('intermediate') ? '✅ ' : ''}🟡 Intermediate`, 'level_intermediate')],
        [Markup.button.callback(`${currentLevels.includes('advanced') ? '✅ ' : ''}🟠 Advanced`, 'level_advanced')],
        [Markup.button.callback(`${currentLevels.includes('expert') ? '✅ ' : ''}🔴 Expert`, 'level_expert')],
        [Markup.button.callback('✅ Done', 'levels_done')]
      ]).reply_markup
    })
    
  } catch (error) {
    console.error('Error in level selection:', error)
    await ctx.answerCbQuery('Error. Try again.')
  }
})

// Done with levels
bot.action('levels_done', async (ctx) => {
  await ctx.answerCbQuery('Levels saved!')
  await ctx.editMessageText('✅ *Levels saved!*\n\nUse /prefs to view all your preferences.')
})

// Save levels handler
bot.action('save_levels', async (ctx) => {
  await ctx.answerCbQuery('Saving levels...')
  
  if (!ctx.session.selectedLevels || ctx.session.selectedLevels.length === 0) {
    return ctx.editMessageText('❌ Please select at least one level first!')
  }
  
  try {
    // Delete existing levels
    await supabase
      .from('user_levels')
      .delete()
      .eq('user_id', (await getUserProfile(ctx.from.id))?.id)
    
    // Insert new levels
    const userProfile = await getUserProfile(ctx.from.id)
    if (userProfile) {
      const levelInserts = ctx.session.selectedLevels.map(level => ({
        user_id: userProfile.id,
        level: level
      }))
      
      await supabase.from('user_levels').insert(levelInserts)
    }
    
    await ctx.editMessageText(`✅ *Levels saved!*\n\nYour selected levels: ${ctx.session.selectedLevels.join(', ')}\n\nUse /prefs to continue setting up other preferences.`)
    
    // Clear session
    ctx.session.selectedLevels = []
    
  } catch (error) {
    console.error('Error saving levels:', error)
    ctx.editMessageText('❌ Error saving levels. Try again later.')
  }
})

// Helper functions
async function getUserProfile(telegramId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('telegram_id', telegramId)
    .single()
  
  if (error) {
    console.error('Error fetching user profile:', error)
    return null
  }
  
  return data
}

async function getUserPreferences(telegramId) {
  const { data, error } = await supabase
    .from('profiles')
    .select(`
      *,
      user_levels (level),
      user_sides (side), 
      user_days (day_of_week),
      user_time_windows (start_time, end_time),
      user_notifications (timing)
    `)
    .eq('telegram_id', telegramId)
    .single()
  
  if (error) {
    console.error('Error fetching user preferences:', error)
    return null
  }
  
  return data
}

function formatPreferencesMessage(preferences) {
  const levels = preferences.user_levels?.map(ul => ul.level).join(', ') || 'None set'
  const sides = preferences.user_sides?.map(us => us.side === 'L' ? 'Left' : us.side === 'R' ? 'Right' : 'Any').join(', ') || 'Any'
  const days = preferences.user_days?.map(ud => {
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    return dayNames[ud.day_of_week]
  }).join(', ') || 'Any day'
  const times = preferences.user_time_windows?.map(utw => `${utw.start_time}-${utw.end_time}`).join(', ') || 'Any time'
  const notifications = preferences.user_notifications?.map(un => un.timing).join(', ') || '24h'

  return `⚙️ *Your Current Preferences*

📊 *Levels*: ${levels}
🏄 *Sides*: ${sides}
📅 *Days*: ${days}
🕐 *Times*: ${times}
👥 *Min spots*: ${preferences.min_spots || 1}
🔔 *Notifications*: ${notifications}`
}

// Start server and bot
const PORT = process.env.PORT || 3000

if (process.env.NODE_ENV === 'production') {
  // Production: use webhook
  app.use(express.json())
  app.post('/webhook', (req, res) => {
    bot.handleUpdate(req.body, res)
  })
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`)
    
    // Set webhook
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL || `https://waveping-production.up.railway.app/webhook`
    bot.telegram.setWebhook(webhookUrl).then(() => {
      console.log(`📱 Webhook set to: ${webhookUrl}`)
    }).catch(console.error)
  })
} else {
  // Development: use polling
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`)
    bot.launch()
    console.log('🤖 Bot started with polling')
  })
}

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))