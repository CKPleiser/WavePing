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
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() })
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
  await ctx.reply('🔍 Getting your matched sessions for today...')
  
  try {
    const today = new Date().toISOString().split('T')[0]
    const telegramId = ctx.from.id
    
    // Get user preferences
    const userProfile = await getUserProfile(telegramId)
    if (!userProfile) {
      return ctx.reply('⚠️ Please run /setup first to set your preferences!')
    }
    
    // Get user's selected levels
    const { data: userLevels } = await supabase
      .from('user_levels')
      .select('level')
      .eq('user_id', userProfile.id)
    
    const selectedLevels = userLevels?.map(ul => ul.level) || []
    
    // Get sessions for today
    let query = supabase
      .from('sessions')
      .select('*')
      .gte('date_time', `${today}T00:00:00`)
      .lt('date_time', `${today}T23:59:59`)
      .gt('available_spots', 0) // Only show sessions with spots
      .order('date_time')
    
    // Filter by user's levels if they have preferences
    if (selectedLevels.length > 0) {
      query = query.in('session_level', selectedLevels)
    }
    
    const { data: sessions, error } = await query
    
    if (error) {
      console.error('Error fetching sessions:', error)
      return ctx.reply('❌ Error loading sessions. Try again later.')
    }
    
    if (!sessions || sessions.length === 0) {
      let noSessionsMsg = `📅 *No matching sessions for today (${today})*\n\n`
      
      if (selectedLevels.length > 0) {
        noSessionsMsg += `🔍 *Your filters:* ${selectedLevels.join(', ')}\n\n`
        noSessionsMsg += `💡 Try:\n`
        noSessionsMsg += `• Checking /tomorrow instead\n`
        noSessionsMsg += `• Adjusting your level preferences with /setup\n`
      } else {
        noSessionsMsg += `⚠️ You haven't set any level preferences!\n`
        noSessionsMsg += `Use /setup to select your surf levels.`
      }
      
      return ctx.reply(noSessionsMsg, { parse_mode: 'Markdown' })
    }
    
    let message = `🏄‍♂️ *Your Sessions for Today (${today})*\n`
    message += `🔍 *Filtered for:* ${selectedLevels.join(', ')}\n\n`
    
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
  await ctx.reply('🔍 Getting your matched sessions for tomorrow...')
  
  try {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]
    const telegramId = ctx.from.id
    
    // Get user preferences
    const userProfile = await getUserProfile(telegramId)
    if (!userProfile) {
      return ctx.reply('⚠️ Please run /setup first to set your preferences!')
    }
    
    // Get user's selected levels
    const { data: userLevels } = await supabase
      .from('user_levels')
      .select('level')
      .eq('user_id', userProfile.id)
    
    const selectedLevels = userLevels?.map(ul => ul.level) || []
    
    // Get sessions for tomorrow
    let query = supabase
      .from('sessions')
      .select('*')
      .gte('date_time', `${tomorrowStr}T00:00:00`)
      .lt('date_time', `${tomorrowStr}T23:59:59`)
      .gt('available_spots', 0) // Only show sessions with spots
      .order('date_time')
    
    // Filter by user's levels if they have preferences
    if (selectedLevels.length > 0) {
      query = query.in('session_level', selectedLevels)
    }
    
    const { data: sessions, error } = await query
    
    if (error) {
      console.error('Error fetching sessions:', error)
      return ctx.reply('❌ Error loading sessions. Try again later.')
    }
    
    if (!sessions || sessions.length === 0) {
      let noSessionsMsg = `📅 *No matching sessions for tomorrow (${tomorrowStr})*\n\n`
      
      if (selectedLevels.length > 0) {
        noSessionsMsg += `🔍 *Your filters:* ${selectedLevels.join(', ')}\n\n`
        noSessionsMsg += `💡 Try:\n`
        noSessionsMsg += `• Checking other days\n`
        noSessionsMsg += `• Adjusting your level preferences with /setup\n`
      } else {
        noSessionsMsg += `⚠️ You haven't set any level preferences!\n`
        noSessionsMsg += `Use /setup to select your surf levels.`
      }
      
      return ctx.reply(noSessionsMsg, { parse_mode: 'Markdown' })
    }
    
    let message = `🏄‍♂️ *Your Sessions for Tomorrow (${tomorrowStr})*\n`
    message += `🔍 *Filtered for:* ${selectedLevels.join(', ')}\n\n`
    
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
  try {
    await ctx.answerCbQuery('✅ Saved successfully!')
    
    // Get user's saved levels for confirmation
    const userProfile = await getUserProfile(ctx.from.id)
    const { data: userLevels } = await supabase
      .from('user_levels')
      .select('level')
      .eq('user_id', userProfile.id)
    
    const savedLevels = userLevels?.map(ul => ul.level) || []
    
    let confirmationMsg = '✅ *Preferences Saved Successfully!*\n\n'
    confirmationMsg += '📊 *Your selected levels:*\n'
    
    if (savedLevels.length > 0) {
      savedLevels.forEach(level => {
        const emoji = {
          'beginner': '🟢',
          'improver': '🔵',
          'intermediate': '🟡',
          'advanced': '🟠',
          'expert': '🔴'
        }[level] || '⚪'
        confirmationMsg += `${emoji} ${level.charAt(0).toUpperCase() + level.slice(1)}\n`
      })
    } else {
      confirmationMsg += '_No levels selected_\n'
    }
    
    confirmationMsg += '\n📱 *Next steps:*\n'
    confirmationMsg += '• Use /today to see matching sessions\n'
    confirmationMsg += '• Use /tomorrow for tomorrow\'s sessions\n'
    confirmationMsg += '• Use /prefs to adjust preferences\n'
    confirmationMsg += '\n🔔 You\'ll be notified when spots open up!'
    
    await ctx.editMessageText(confirmationMsg, { parse_mode: 'Markdown' })
    
  } catch (error) {
    console.error('Error in levels_done:', error)
    await ctx.editMessageText('✅ Levels saved! Use /prefs to view.')
  }
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

// Start server
const PORT = process.env.PORT || 3000
const HOST = '0.0.0.0'

// Production: use webhook
app.use(express.json())

// Webhook endpoint
app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body, res)
})

// Start server
const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT}`)
  
  if (process.env.NODE_ENV === 'production') {
    // Set webhook in production
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL || `https://waveping-production.up.railway.app/webhook`
    bot.telegram.setWebhook(webhookUrl)
      .then(() => console.log(`📱 Webhook set to: ${webhookUrl}`))
      .catch(err => console.error('❌ Failed to set webhook:', err))
  } else {
    // Use polling in development
    bot.launch()
    console.log('🤖 Bot started with polling')
  }
})

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))