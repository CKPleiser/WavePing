/**
 * Unified Telegram helper functions
 * Consolidates duplicate functionality from utils/helpers.js and lib/utils/telegram.ts
 */

// HTML escaping for Telegram messages
const toHTML = (s = '') => {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Markdown escaping for Telegram messages
const toMarkdown = (s = '') => {
  if (s === null || s === undefined) return ''
  return String(s).replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1')
}

// Safely edit message text, ignoring "message is not modified" errors
async function safeEditText(ctx, text, extra = {}) {
  try {
    if (ctx.editMessageText) {
      // Called from bot context
      await ctx.editMessageText(text, extra)
    } else if (ctx.telegram) {
      // Called with explicit message ID
      const { msgId, chatId } = extra
      await ctx.telegram.editMessageText(chatId || ctx.chat.id, msgId, undefined, text, extra)
    }
  } catch (error) {
    if (!/message is not modified/i.test(error?.description || '')) {
      throw error
    }
    // Silently ignore "message not modified" errors
  }
}

// Safely edit message reply markup, ignoring "message is not modified" errors
async function safeEditMarkup(ctx, markup) {
  try {
    await ctx.editMessageReplyMarkup(markup)
  } catch (error) {
    if (!/message is not modified/i.test(error?.description || '')) {
      throw error
    }
  }
}

// Send long messages in chunks to avoid Telegram's 4096 character limit
async function sendChunked(ctx, text, extra = {}) {
  const MAX_LENGTH = 4096
  const chunks = []
  
  // Split text into chunks at newline boundaries when possible
  let currentChunk = ''
  const lines = text.split('\n')
  
  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > MAX_LENGTH) {
      if (currentChunk) {
        chunks.push(currentChunk)
        currentChunk = line
      } else {
        // Single line is too long, force split
        for (let i = 0; i < line.length; i += MAX_LENGTH) {
          chunks.push(line.slice(i, i + MAX_LENGTH))
        }
      }
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk)
  }
  
  // Send each chunk
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1
    await ctx.reply(chunks[i], isLast ? extra : { ...extra, disable_notification: true })
  }
}

// Rate limiting
const rateLimits = new Map()
const RATE_LIMIT_MS = 3000

function checkRateLimit(key, limitMs = RATE_LIMIT_MS) {
  const now = Date.now()
  const lastTime = rateLimits.get(key)
  
  if (lastTime && now - lastTime < limitMs) {
    return false
  }
  
  rateLimits.set(key, now)
  return true
}

// Setup session management
function createSetupSession(overrides = {}) {
  return {
    levels: [],
    sides: [],
    days: [],
    timeWindows: [],
    notifications: ['24h'],
    minSpots: 1,
    step: 'levels',
    createdAt: Date.now(),
    ...overrides
  }
}

function isSetupExpired(setup, ttlMinutes = 15) {
  if (!setup?.createdAt) return true
  return Date.now() - setup.createdAt > ttlMinutes * 60 * 1000
}

module.exports = {
  toHTML,
  toMarkdown,
  safeEditText,
  safeEditMarkup,
  sendChunked,
  checkRateLimit,
  createSetupSession,
  isSetupExpired
}