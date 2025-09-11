// HTML escaping for Telegram messages
const toHTML = (s = '') => {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Safe message edit with fallback
async function safeEdit(ctx, msgId, text, opts) {
  try {
    await ctx.telegram.editMessageText(ctx.chat.id, msgId, undefined, text, opts)
  } catch (error) {
    console.log('Edit failed, falling back to reply:', error.message)
    await ctx.reply(text, opts)
  }
}

// Rate limiting
const rateLimits = new Map()
const RATE_LIMIT_MS = 3000

function checkRateLimit(key) {
  const now = Date.now()
  const lastTime = rateLimits.get(key)
  
  if (lastTime && now - lastTime < RATE_LIMIT_MS) {
    return false
  }
  
  rateLimits.set(key, now)
  return true
}

module.exports = {
  toHTML,
  safeEdit,
  checkRateLimit
}