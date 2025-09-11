export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          telegram_id: number
          telegram_username: string | null
          email: string | null
          min_spots: number
          notification_enabled: boolean
          streak_count: number
          total_sessions: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          telegram_id: number
          telegram_username?: string | null
          email?: string | null
          min_spots?: number
          notification_enabled?: boolean
          streak_count?: number
          total_sessions?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          telegram_id?: number
          telegram_username?: string | null
          email?: string | null
          min_spots?: number
          notification_enabled?: boolean
          streak_count?: number
          total_sessions?: number
          created_at?: string
          updated_at?: string
        }
      }
      sessions: {
        Row: {
          id: string
          date: string
          start_time: string
          end_time: string | null
          session_name: string
          level: SessionLevel
          side: string | null
          total_spots: number | null
          spots_available: number | null
          book_url: string | null
          instructor: string | null
          water_temp: number | null
          weather_data: Json | null
          first_seen: string
          last_updated: string
          is_active: boolean
        }
        Insert: {
          id: string
          date: string
          start_time: string
          end_time?: string | null
          session_name: string
          level?: SessionLevel
          side?: string | null
          total_spots?: number | null
          spots_available?: number | null
          book_url?: string | null
          instructor?: string | null
          water_temp?: number | null
          weather_data?: Json | null
          first_seen?: string
          last_updated?: string
          is_active?: boolean
        }
        Update: {
          id?: string
          date?: string
          start_time?: string
          end_time?: string | null
          session_name?: string
          level?: SessionLevel
          side?: string | null
          total_spots?: number | null
          spots_available?: number | null
          book_url?: string | null
          instructor?: string | null
          water_temp?: number | null
          weather_data?: Json | null
          first_seen?: string
          last_updated?: string
          is_active?: boolean
        }
      }
      user_levels: {
        Row: {
          user_id: string
          level: SessionLevel
        }
        Insert: {
          user_id: string
          level: SessionLevel
        }
        Update: {
          user_id?: string
          level?: SessionLevel
        }
      }
      user_sides: {
        Row: {
          user_id: string
          side: string
        }
        Insert: {
          user_id: string
          side: string
        }
        Update: {
          user_id?: string
          side?: string
        }
      }
      user_days: {
        Row: {
          user_id: string
          day_of_week: number
        }
        Insert: {
          user_id: string
          day_of_week: number
        }
        Update: {
          user_id?: string
          day_of_week?: number
        }
      }
      user_time_windows: {
        Row: {
          id: string
          user_id: string
          start_time: string
          end_time: string
        }
        Insert: {
          id?: string
          user_id: string
          start_time: string
          end_time: string
        }
        Update: {
          id?: string
          user_id?: string
          start_time?: string
          end_time?: string
        }
      }
      user_notifications: {
        Row: {
          user_id: string
          timing: NotificationTiming
        }
        Insert: {
          user_id: string
          timing: NotificationTiming
        }
        Update: {
          user_id?: string
          timing?: NotificationTiming
        }
      }
      user_sessions: {
        Row: {
          id: string
          user_id: string
          session_id: string
          status: string | null
          rating: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          session_id: string
          status?: string | null
          rating?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          session_id?: string
          status?: string | null
          rating?: string | null
          created_at?: string
        }
      }
      notifications_sent: {
        Row: {
          id: string
          user_id: string
          session_id: string
          timing: NotificationTiming
          sent_at: string
        }
        Insert: {
          id?: string
          user_id: string
          session_id: string
          timing: NotificationTiming
          sent_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          session_id?: string
          timing?: NotificationTiming
          sent_at?: string
        }
      }
      session_changes: {
        Row: {
          id: string
          session_id: string | null
          change_type: string | null
          old_spots: number | null
          new_spots: number | null
          detected_at: string
        }
        Insert: {
          id?: string
          session_id?: string | null
          change_type?: string | null
          old_spots?: number | null
          new_spots?: number | null
          detected_at?: string
        }
        Update: {
          id?: string
          session_id?: string | null
          change_type?: string | null
          old_spots?: number | null
          new_spots?: number | null
          detected_at?: string
        }
      }
      weather_cache: {
        Row: {
          id: string
          date: string
          air_temp: number | null
          water_temp: number | null
          wind_speed: number | null
          wind_direction: string | null
          conditions: string | null
          icon: string | null
          cached_at: string
        }
        Insert: {
          id?: string
          date: string
          air_temp?: number | null
          water_temp?: number | null
          wind_speed?: number | null
          wind_direction?: string | null
          conditions?: string | null
          icon?: string | null
          cached_at?: string
        }
        Update: {
          id?: string
          date?: string
          air_temp?: number | null
          water_temp?: number | null
          wind_speed?: number | null
          wind_direction?: string | null
          conditions?: string | null
          icon?: string | null
          cached_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_matching_users: {
        Args: {
          session_record: Database['public']['Tables']['sessions']['Row']
        }
        Returns: {
          user_id: string
          telegram_id: number
          notification_timings: NotificationTiming[]
        }[]
      }
      update_user_streak: {
        Args: {
          user_uuid: string
        }
        Returns: void
      }
      save_preferences: {
        Args: {
          p_user_id: string
          p_levels: string[]
          p_sides: string[]
          p_days: number[]
          p_time_windows: Json
          p_notifications: string[]
        }
        Returns: void
      }
    }
    Enums: {
      session_level: SessionLevel
      notification_timing: NotificationTiming
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type SessionLevel =
  | 'beginner'
  | 'improver'
  | 'intermediate'
  | 'advanced'
  | 'advanced_plus'
  | 'expert'
  | 'expert_turns'
  | 'expert_barrels'
  | 'women_only'
  | 'improver_lesson'
  | 'intermediate_lesson'
  | 'advanced_coaching'
  | 'high_performance_coaching'

export type NotificationTiming = '1w' | '48h' | '24h' | '12h' | '2h'

export type SessionRow = Database['public']['Tables']['sessions']['Row']
export type ProfileRow = Database['public']['Tables']['profiles']['Row']
export type UserSessionRow = Database['public']['Tables']['user_sessions']['Row']

// Utility types for working with the data
export interface UserPreferences {
  levels: SessionLevel[]
  sides: string[]
  days: number[]
  timeWindows: { start_time: string; end_time: string }[]
  notifications: NotificationTiming[]
  minSpots: number
}

export interface SessionWithWeather extends SessionRow {
  weather?: {
    air_temp: number
    water_temp: number
    wind_speed: number
    wind_direction: string
    conditions: string
    icon: string
  }
}