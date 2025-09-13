/**
 * Type definitions for WavePing application
 */

// User profile types
export interface UserProfile {
  id: string
  telegram_id: number
  notification_enabled: boolean
  min_spots: number
  user_levels?: UserLevel[]
  user_sides?: UserSide[]
  user_days?: UserDay[]
  user_time_windows?: UserTimeWindow[]
  user_digest_filters?: UserDigestFilter[]
}

export interface UserLevel {
  level: 'beginner' | 'improver' | 'intermediate' | 'advanced' | 'expert' | 'pro'
}

export interface UserSide {
  side: 'L' | 'R' | 'Any'
}

export interface UserDay {
  day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6  // 0 = Sunday, 6 = Saturday
}

export interface UserTimeWindow {
  start_time: string  // HH:MM format
  end_time: string    // HH:MM format
}

export interface UserDigestFilter {
  timing: '1w' | '48h' | '24h' | '12h' | '2h'
}

// Session types
export interface WaveSession {
  id?: string
  session_id: string
  date: string
  dateISO: string
  dateLabel?: string
  time: string
  session_name: string
  level: string
  side: string
  spots_available: number
  spots_total: number
  booking_url: string
  created_at?: string
  updated_at?: string
}

// Digest types
export interface DigestPreference {
  user_id: string
  digest_type: 'morning' | 'evening' | 'none'
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface DigestResult {
  telegramId: number
  status: 'sent' | 'failed'
  error?: string
  sessionsToday?: number
  sessionsTomorrow?: number
  sessionsUpcoming?: number
}

export interface NotificationResult {
  success: boolean
  results: DigestResult[]
}

// Setup session types
export interface SetupSession {
  levels: string[]
  sides: string[]
  days: number[]
  timeWindows: UserTimeWindow[]
  notifications: string[]
  minSpots: number
  step: 'levels' | 'sides' | 'days' | 'time' | 'notifications' | 'spots' | 'complete'
  createdAt: number
}

// Request types
export interface AuthenticatedRequest extends Express.Request {
  user?: UserProfile
}

// Telegram context extensions
export interface BotContext {
  session?: SetupSession
  user?: UserProfile
}