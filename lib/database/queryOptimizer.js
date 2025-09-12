/**
 * Database Query Optimizer
 * Provides optimized database queries and caching strategies
 */

class QueryOptimizer {
  constructor(supabase) {
    this.supabase = supabase
    this.cache = new Map()
    this.cacheExpiry = 5 * 60 * 1000 // 5 minutes default cache
  }

  /**
   * Get user with all preferences in a single optimized query
   * Reduces multiple queries to one with proper joins
   */
  async getUserWithPreferences(telegramId) {
    const cacheKey = `user_${telegramId}`
    const cached = this.getFromCache(cacheKey)
    if (cached) return cached

    const { data, error } = await this.supabase
      .from('profiles')
      .select(`
        *,
        user_levels (level),
        user_sides (side),
        user_days (day_of_week),
        user_time_windows (start_time, end_time),
        user_notifications (timing),
        user_digest_preferences (digest_type)
      `)
      .eq('telegram_id', telegramId)
      .single()

    if (error) throw error

    this.setCache(cacheKey, data)
    return data
  }

  /**
   * Batch fetch users with preferences
   * More efficient than fetching users individually
   */
  async getBatchUsersWithPreferences(userIds) {
    if (!userIds || userIds.length === 0) return []

    const { data, error } = await this.supabase
      .from('profiles')
      .select(`
        *,
        user_levels (level),
        user_sides (side),
        user_days (day_of_week),
        user_time_windows (start_time, end_time),
        user_notifications (timing),
        user_digest_preferences (digest_type)
      `)
      .in('id', userIds)

    if (error) throw error

    // Cache individual users
    data.forEach(user => {
      this.setCache(`user_${user.telegram_id}`, user)
    })

    return data
  }

  /**
   * Get digest users with all preferences in optimized query
   * Combines multiple queries into one with proper filtering
   */
  async getDigestUsersOptimized(digestType) {
    const cacheKey = `digest_${digestType}`
    const cached = this.getFromCache(cacheKey)
    if (cached) return cached

    const { data, error } = await this.supabase
      .from('profiles')
      .select(`
        *,
        user_levels (level),
        user_sides (side),
        user_days (day_of_week),
        user_time_windows (start_time, end_time),
        user_notifications (timing),
        user_digest_preferences!inner (digest_type)
      `)
      .eq('notification_enabled', true)
      .eq('user_digest_preferences.digest_type', digestType)
      .not('user_notifications', 'is', null)

    if (error) throw error

    const filteredData = (data || []).filter(user => 
      user.user_notifications && user.user_notifications.length > 0
    )

    this.setCache(cacheKey, filteredData, 2 * 60 * 1000) // 2 minute cache for digest users
    return filteredData
  }

  /**
   * Get sessions with availability in date range
   * Uses indexed columns for better performance
   */
  async getSessionsInDateRange(startDate, endDate, minSpots = 0) {
    const cacheKey = `sessions_${startDate}_${endDate}_${minSpots}`
    const cached = this.getFromCache(cacheKey)
    if (cached) return cached

    const query = this.supabase
      .from('sessions')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })
      .order('time', { ascending: true })

    if (minSpots > 0) {
      query.gte('spots_available', minSpots)
    }

    const { data, error } = await query

    if (error) throw error

    this.setCache(cacheKey, data, 60 * 1000) // 1 minute cache for sessions
    return data
  }

  /**
   * Batch check for sent notifications
   * More efficient than checking individually
   */
  async batchCheckNotificationsSent(userId, sessionIds, notificationType) {
    if (!sessionIds || sessionIds.length === 0) return new Map()

    const { data, error } = await this.supabase
      .from('notifications_sent')
      .select('session_id, notification_type')
      .eq('user_id', userId)
      .in('session_id', sessionIds)

    if (error) throw error

    // Create a map for O(1) lookup
    const sentMap = new Map()
    data?.forEach(notification => {
      const key = `${notification.session_id}_${notification.notification_type}`
      sentMap.set(key, true)
    })

    return sentMap
  }

  /**
   * Batch insert notifications sent
   * More efficient than individual inserts
   */
  async batchInsertNotificationsSent(notifications) {
    if (!notifications || notifications.length === 0) return

    const { error } = await this.supabase
      .from('notifications_sent')
      .insert(notifications)

    if (error) throw error
  }

  /**
   * Update user preferences with optimistic locking
   * Prevents race conditions in concurrent updates
   */
  async updateUserPreferencesAtomic(userId, updates, expectedVersion) {
    const { data, error } = await this.supabase.rpc('update_user_preferences_atomic', {
      p_user_id: userId,
      p_updates: updates,
      p_expected_version: expectedVersion
    })

    if (error) throw error

    // Invalidate cache for this user
    this.invalidateUserCache(userId)

    return data
  }

  /**
   * Get upcoming sessions with user match count
   * Helps prioritize popular sessions
   */
  async getSessionsWithDemand(days = 7) {
    const startDate = new Date().toISOString().split('T')[0]
    const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    const { data, error } = await this.supabase
      .from('sessions')
      .select(`
        *,
        session_interests (
          user_id
        )
      `)
      .gte('date', startDate)
      .lte('date', endDate)
      .gt('spots_available', 0)
      .order('date', { ascending: true })

    if (error) throw error

    // Add demand metric
    return data?.map(session => ({
      ...session,
      demand: session.session_interests?.length || 0,
      demand_ratio: session.spots_available > 0 
        ? (session.session_interests?.length || 0) / session.spots_available 
        : 0
    })) || []
  }

  /**
   * Cache management utilities
   */
  getFromCache(key) {
    const cached = this.cache.get(key)
    if (!cached) return null

    if (Date.now() > cached.expiry) {
      this.cache.delete(key)
      return null
    }

    return cached.data
  }

  setCache(key, data, ttl = this.cacheExpiry) {
    this.cache.set(key, {
      data,
      expiry: Date.now() + ttl
    })
  }

  invalidateUserCache(userId) {
    // Remove all cache entries related to this user
    for (const [key] of this.cache) {
      if (key.includes(`user_${userId}`) || key.includes(userId)) {
        this.cache.delete(key)
      }
    }
  }

  clearCache() {
    this.cache.clear()
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats() {
    let validEntries = 0
    let expiredEntries = 0
    const now = Date.now()

    for (const [, cached] of this.cache) {
      if (cached.expiry > now) {
        validEntries++
      } else {
        expiredEntries++
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries,
      expiredEntries,
      cacheHitRate: this.calculateHitRate()
    }
  }

  // Track cache hits/misses for monitoring
  hits = 0
  misses = 0

  calculateHitRate() {
    const total = this.hits + this.misses
    return total > 0 ? (this.hits / total * 100).toFixed(2) + '%' : '0%'
  }
}

module.exports = QueryOptimizer