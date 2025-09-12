#!/usr/bin/env node
/**
 * Debug Support Command - Test inline keyboard specifically
 */

require('dotenv').config({ path: '.env.local' })
const { Telegraf, Markup } = require('telegraf')

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN)

// Test different approaches to support command
bot.command('test1', async (ctx) => {
  console.log('🧪 TEST1: Basic support message with inline keyboard')
  
  const supportMessage = `☕ *Support WavePing* 💙

🌊 Thank you for using WavePing! This bot helps surfers at The Wave Bristol get the perfect session notifications.

*How WavePing helps you:*
• 🔔 Smart session alerts for your skill level
• 📱 Daily surf digests delivered when you want
• 🎯 Personalized recommendations
• 🔄 Real-time availability tracking

*Support the Development:*
WavePing is built with ❤️ by an independent developer. Your support helps:

• 🔧 Keep the bot running 24/7
• ✨ Add new features you request  
• 🛡️ Maintain reliable notifications
• 🌊 Improve the surf experience for everyone

*Ways to Support:*`

  try {
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
    console.log('✅ TEST1: Support message sent successfully')
  } catch (error) {
    console.error('❌ TEST1: Error:', error.message)
  }
})

// Test without markdown parsing
bot.command('test2', async (ctx) => {
  console.log('🧪 TEST2: Support message without markdown')
  
  try {
    await ctx.reply('Support WavePing - Simple test message', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.url('☕ Coffee', 'https://buymeacoffee.com/waveping')],
        [Markup.button.callback('💬 Contact', 'support_contact')]
      ])
    })
    console.log('✅ TEST2: Simple message sent successfully')
  } catch (error) {
    console.error('❌ TEST2: Error:', error.message)
  }
})

// Test just keyboard
bot.command('test3', async (ctx) => {
  console.log('🧪 TEST3: Just keyboard test')
  
  try {
    await ctx.reply('Keyboard Test:', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('Button 1', 'btn1')],
        [Markup.button.callback('Button 2', 'btn2')]
      ])
    })
    console.log('✅ TEST3: Keyboard test sent successfully')
  } catch (error) {
    console.error('❌ TEST3: Error:', error.message)
  }
})

// Handle callback queries
bot.on('callback_query', async (ctx) => {
  console.log('🎯 Callback received:', ctx.callbackQuery.data)
  
  await ctx.answerCbQuery(`You clicked: ${ctx.callbackQuery.data}`)
  
  await ctx.editMessageText(`✅ Button "${ctx.callbackQuery.data}" was clicked successfully!`, {
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Back to Test', 'back_test')]
    ])
  })
})

// Error handling
bot.catch((err, ctx) => {
  console.error('🚨 Bot error:', err)
  console.error('🔍 Context:', {
    updateType: ctx.updateType,
    userId: ctx.from?.id,
    message: ctx.message?.text,
    callback: ctx.callbackQuery?.data
  })
})

console.log('🧪 Starting debug bot...')
console.log('🔧 Available commands: /test1, /test2, /test3')

bot.launch()

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

console.log('✅ Debug bot running!')