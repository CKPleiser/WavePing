import { format, addHours, addWeeks } from 'date-fns'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'

const LONDON_TZ = 'Europe/London'

/**
 * Get current time in London timezone
 */
export function nowInLondon(): Date {
  const nowUtc = new Date()
  return toZonedTime(nowUtc, LONDON_TZ)
}

/**
 * Convert any date/string to London timezone
 */
export function toLondon(date: Date | string): Date {
  return toZonedTime(new Date(date), LONDON_TZ)
}

/**
 * Convert London time back to UTC
 */
export function fromLondonToUtc(date: Date): Date {
  return fromZonedTime(date, LONDON_TZ)
}

/**
 * Format date in London timezone for display
 */
export function formatLondonDate(isoDate: string): string {
  return format(toLondon(isoDate + 'T00:00'), 'EEEE, MMMM do')
}

/**
 * Get notification timing deltas in London timezone
 */
export function getTimingDeltas(nowLon: Date) {
  return {
    '1w': addWeeks(nowLon, 1),
    '48h': addHours(nowLon, 48),
    '24h': addHours(nowLon, 24),
    '12h': addHours(nowLon, 12),
    '2h': addHours(nowLon, 2)
  }
}

/**
 * Create notification window with configurable width
 * Wider windows prevent missing notifications due to cron drift
 */
export function createNotificationWindow(targetLon: Date, windowMinutes: number = 45) {
  const windowMs = windowMinutes * 60 * 1000
  return {
    windowStartLon: new Date(targetLon.getTime() - windowMs),
    windowEndLon: new Date(targetLon.getTime() + windowMs)
  }
}