import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

const TZ = 'Europe/London'

/**
 * Get today's date in ISO format (YYYY-MM-DD) for the Wave's timezone
 * The Wave operates in Europe/London (BST/GMT)
 */
export function todayIso(tz = TZ): string {
  return dayjs().tz(tz).format('YYYY-MM-DD')
}

/**
 * Get tomorrow's date in ISO format (YYYY-MM-DD) for the Wave's timezone
 */
export function tomorrowIso(tz = TZ): string {
  return dayjs().tz(tz).add(1, 'day').format('YYYY-MM-DD')
}

/**
 * Get day of week with Monday=0, Sunday=6 for a given date in timezone
 * Converts from dayjs format (Sunday=0) to Wave business logic (Monday=0)
 */
export function dowMon0(dateIso: string, tz = TZ): number {
  const d = dayjs.tz(dateIso, tz).day() // Sun=0..Sat=6
  return d === 0 ? 6 : d - 1 // Convert to Mon=0..Sun=6
}

/**
 * Get current date and day-of-week for filtering sessions
 */
export function getCurrentDateInfo(tz = TZ) {
  const dateIso = todayIso(tz)
  const dayOfWeek = dowMon0(dateIso, tz)
  return { dateIso, dayOfWeek }
}

/**
 * Get tomorrow's date and day-of-week for filtering sessions
 */
export function getTomorrowDateInfo(tz = TZ) {
  const dateIso = tomorrowIso(tz)
  const dayOfWeek = dowMon0(dateIso, tz)
  return { dateIso, dayOfWeek }
}