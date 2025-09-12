#!/usr/bin/env node
/**
 * Simple bot test to verify inline keyboard functionality
 */

require('dotenv').config({ path: '.env.local' })
const { Telegraf, Markup } = require('telegraf')

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN)

// Test start command with inline keyboard
bot.command('start', async (ctx) => {
  const message = `🌊 *Welcome to WavePing!* 🏄‍♂️

Your smart companion for The Wave Bristol surf sessions.

Ready to catch the perfect wave?`

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard([
      [
        Markup.button.callback('🌊 Today', 'menu_today'),
        Markup.button.callback('🌅 Tomorrow', 'menu_tomorrow')
      ],
      [
        Markup.button.callback('📅 Week View', 'menu_week'),
        Markup.button.callback('⚙️ Preferences', 'menu_preferences')
      ],
      [
        Markup.button.callback('☕ Support WavePing', 'menu_support')
      ]
    ])
  })
})

// Test support command with inline keyboard
bot.command('support', async (ctx) => {
  const message = `☕ *Support WavePing* 💙

Help keep the waves coming! Your support helps maintain and improve WavePing for the entire surf community.

🏄‍♂️ **What your support provides:**
• Real-time session monitoring
• Personalized surf alerts  
• Weekly wave forecasts
• Feature development

Every coffee keeps the servers running! ☕`

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.url('☕ Buy Me a Coffee', 'https://buymeacoffee.com/waveping')],
      [Markup.button.url('💖 GitHub Sponsors', 'https://github.com/sponsors/waveping')],
      [Markup.button.callback('💬 Contact Developer', 'support_contact')],
      [Markup.button.callback('📈 Feature Request', 'support_feature')],
      [Markup.button.callback('🏠 Main Menu', 'menu_main')]
    ])
  })
})

// Handle callback queries
bot.on('callback_query', async (ctx) => {
  console.log('Callback received:', ctx.callbackQuery.data)
  
  // Answer the callback query to remove loading state
  await ctx.answerCbQuery()
  
  const data = ctx.callbackQuery.data
  
  switch (data) {
    case 'menu_main':
      await ctx.editMessageText(
        `🌊 *WavePing Main Menu* 🏄‍♂️

Your surf session command center. What would you like to check?`,
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [
              Markup.button.callback('🌊 Today', 'menu_today'),
              Markup.button.callback('🌅 Tomorrow', 'menu_tomorrow')
            ],
            [
              Markup.button.callback('📅 Week View', 'menu_week'),
              Markup.button.callback('⚙️ Preferences', 'menu_preferences')
            ],
            [
              Markup.button.callback('☕ Support WavePing', 'menu_support')
            ]
          ])
        }
      )
      break
      
    case 'menu_support':
      await ctx.editMessageText(
        `☕ *Support WavePing* 💙

Help keep the waves coming! Your support helps maintain and improve WavePing for the entire surf community.

🏄‍♂️ **What your support provides:**
• Real-time session monitoring
• Personalized surf alerts  
• Weekly wave forecasts
• Feature development

Every coffee keeps the servers running! ☕`,
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.url('☕ Buy Me a Coffee', 'https://buymeacoffee.com/waveping')],
            [Markup.button.url('💖 GitHub Sponsors', 'https://github.com/sponsors/waveping')],
            [Markup.button.callback('💬 Contact Developer', 'support_contact')],
            [Markup.button.callback('📈 Feature Request', 'support_feature')],
            [Markup.button.callback('🏠 Main Menu', 'menu_main')]
          ])
        }
      )
      break
      
    case 'support_contact':
      await ctx.editMessageText(
        `💬 *Contact Developer*

Got feedback, suggestions, or need help? 

📧 **Email:** support@waveping.app
💬 **Telegram:** @WavePingSupport

We're here to help! 🌊`,
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.url('📧 Email Support', 'mailto:support@waveping.app')],
            [Markup.button.url('💬 Telegram Support', 'https://t.me/WavePingSupport')],
            [Markup.button.callback('🔙 Back to Support', 'menu_support')]
          ])
        }
      )
      break
      
    case 'support_feature':
      await ctx.editMessageText(
        `📈 *Feature Request*

Have an idea to make WavePing even better?

We'd love to hear from you! 🚀

💡 **Ideas we're considering:**
• Advanced weather integration
• Buddy system for surf partners
• Equipment recommendations
• Competition alerts

Submit your ideas and help shape the future of WavePing! 🌊`,
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.url('📈 Submit Feature Request', 'https://t.me/WavePingSupport')],
            [Markup.button.callback('🔙 Back to Support', 'menu_support')]
          ])
        }
      )
      break
      
    default:
      await ctx.answerCbQuery(`🔧 Test: ${data} - Button works!`)
  }
})

// Error handling
bot.catch((err, ctx) => {
  console.error('Bot error:', err)
  ctx.reply('Something went wrong! Please try again.').catch(() => {})
})

console.log('🧪 Starting WavePing test bot...')
bot.launch()

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

console.log('✅ Bot is running! Try /start or /support')