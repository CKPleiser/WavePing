import { Context } from 'telegraf'

/**
 * Send long messages in chunks to avoid Telegram's 4096 character limit
 */
export async function replyChunked(ctx: Context, text: string, extra?: any) {
  const MAX = 4096
  for (let i = 0; i < text.length; i += MAX) {
    await ctx.reply(text.slice(i, i + MAX), extra)
  }
}

/**
 * Safely edit message text, ignoring "message is not modified" errors
 */
export async function safeEditText(ctx: any, text: string, extra?: any) {
  try {
    await ctx.editMessageText(text, extra)
  } catch (e: any) {
    if (!/message is not modified/i.test(e?.description || '')) throw e
  }
}

/**
 * Safely edit message reply markup, ignoring "message is not modified" errors
 */
export async function safeEditMarkup(ctx: any, markup: any) {
  try {
    await ctx.editMessageReplyMarkup(markup)
  } catch (e: any) {
    if (!/message is not modified/i.test(e?.description || '')) throw e
  }
}

/**
 * Escape Markdown special characters in dynamic text
 * Prevents formatting issues when interpolating user data
 */
export function mdEscape(s: string): string {
  return s.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1')
}

/**
 * Check if setup session is expired (15 minute TTL)
 */
export function isSetupExpired(setup: any): boolean {
  if (!setup?.createdAt) return false
  return Date.now() - setup.createdAt > 15 * 60 * 1000
}

/**
 * Initialize setup session with timestamp
 */
export function createSetupSession(overrides: any = {}) {
  return {
    levels: [],
    sides: [],
    days: [],
    timeWindows: [],
    notifications: ['24h'],
    step: 'levels',
    createdAt: Date.now(),
    ...overrides
  }
}