# WavePing Database Documentation

## Overview

WavePing uses Supabase (PostgreSQL) as its primary database with Row Level Security (RLS), real-time capabilities, and comprehensive audit logging. The schema is designed for scalability, data integrity, and optimal query performance.

## Database Schema

### Core Tables

#### 👤 User Management

##### `profiles`
Central user account management with Telegram integration.

```sql
CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id BIGINT UNIQUE NOT NULL,
    telegram_username TEXT,
    notification_enabled BOOLEAN DEFAULT true,
    min_spots INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Indexes:**
- `profiles_telegram_id_idx` (UNIQUE)
- `profiles_notification_enabled_idx` (for digest queries)

**RLS Policies:**
- Users can only access their own profile data
- Service role has full access for notifications

##### `user_levels`
Many-to-many relationship for user skill level preferences.

```sql
CREATE TABLE user_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    level user_level_enum NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TYPE user_level_enum AS ENUM (
    'beginner', 'improver', 'intermediate', 'advanced', 'expert', 'pro'
);
```

**Constraints:**
- Unique combination of `user_id` and `level`
- Foreign key cascade delete

##### `user_sides`
Wave side preferences (left, right, any).

```sql
CREATE TABLE user_sides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    side CHAR(1) CHECK (side IN ('L', 'R', 'A')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

##### `user_days`
Day-of-week availability preferences.

```sql
CREATE TABLE user_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    day_of_week INTEGER CHECK (day_of_week >= 0 AND day_of_week <= 6),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Note:** `day_of_week` follows JavaScript convention (0 = Sunday, 6 = Saturday)

##### `user_time_windows`
Time range preferences for session matching.

```sql
CREATE TABLE user_time_windows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_time_window CHECK (start_time < end_time)
);
```

##### `user_notifications`
Notification timing preferences (digest delivery times).

```sql
CREATE TABLE user_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    timing notification_timing_enum NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TYPE notification_timing_enum AS ENUM (
    'morning', 'evening'
);
```

#### 🏄‍♂️ Session Management

##### `sessions`
Scraped session data with availability tracking.

```sql
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_date DATE NOT NULL,
    session_time TIME NOT NULL,
    session_name TEXT,
    level user_level_enum,
    side CHAR(1) CHECK (side IN ('L', 'R', 'N')),
    spots_available INTEGER DEFAULT 0,
    spots_total INTEGER,
    price_adult DECIMAL(5,2),
    price_junior DECIMAL(5,2),
    instructor TEXT,
    session_url TEXT,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Indexes:**
- `sessions_date_time_idx` (session_date, session_time)
- `sessions_level_idx` (level)
- `sessions_spots_available_idx` (for availability queries)
- `sessions_last_updated_idx` (for incremental updates)

**Constraints:**
- Unique combination of `session_date`, `session_time`, `level`, `side`
- Check constraint for valid spot counts

##### `notifications_sent`
Deduplication tracking for sent notifications.

```sql
CREATE TABLE notifications_sent (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    notification_type notification_type_enum NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TYPE notification_type_enum AS ENUM (
    'session_alert', 'morning_digest', 'evening_digest'
);
```

**Indexes:**
- `notifications_sent_user_session_idx` (user_id, session_id, notification_type) UNIQUE
- `notifications_sent_date_idx` (sent_at) for cleanup

#### 📊 Enhanced Features

##### `user_sessions`
Session attendance tracking with rating system.

```sql
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    attended BOOLEAN DEFAULT false,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

##### `weather_cache`
Cached weather data for session enhancement.

```sql
CREATE TABLE weather_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_date DATE NOT NULL,
    temperature DECIMAL(4,1),
    wind_speed DECIMAL(4,1),
    wind_direction TEXT,
    conditions TEXT,
    cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '6 hours'
);
```

### Views

#### `user_preferences_view`
Comprehensive user preference aggregation for efficient queries.

```sql
CREATE VIEW user_preferences_view AS
SELECT 
    p.id as user_id,
    p.telegram_id,
    p.notification_enabled,
    p.min_spots,
    
    -- Aggregate levels
    ARRAY_AGG(DISTINCT ul.level ORDER BY ul.level) FILTER (WHERE ul.level IS NOT NULL) as levels,
    
    -- Aggregate sides  
    ARRAY_AGG(DISTINCT us.side ORDER BY us.side) FILTER (WHERE us.side IS NOT NULL) as sides,
    
    -- Aggregate days
    ARRAY_AGG(DISTINCT ud.day_of_week ORDER BY ud.day_of_week) FILTER (WHERE ud.day_of_week IS NOT NULL) as days,
    
    -- Time windows as JSON
    JSON_AGG(
        JSON_BUILD_OBJECT('start_time', utw.start_time, 'end_time', utw.end_time)
        ORDER BY utw.start_time
    ) FILTER (WHERE utw.start_time IS NOT NULL) as time_windows,
    
    -- Notification timings
    ARRAY_AGG(DISTINCT un.timing ORDER BY un.timing) FILTER (WHERE un.timing IS NOT NULL) as notification_timings
    
FROM profiles p
LEFT JOIN user_levels ul ON p.id = ul.user_id
LEFT JOIN user_sides us ON p.id = us.user_id  
LEFT JOIN user_days ud ON p.id = ud.user_id
LEFT JOIN user_time_windows utw ON p.id = utw.user_id
LEFT JOIN user_notifications un ON p.id = un.user_id
GROUP BY p.id, p.telegram_id, p.notification_enabled, p.min_spots;
```

#### `available_sessions_view`
Sessions with availability and enhancement data.

```sql
CREATE VIEW available_sessions_view AS
SELECT 
    s.*,
    CASE 
        WHEN s.session_date = CURRENT_DATE THEN 'today'
        WHEN s.session_date = CURRENT_DATE + INTERVAL '1 day' THEN 'tomorrow'
        ELSE 'future'
    END as session_timeframe,
    
    -- Weather integration
    wc.temperature,
    wc.wind_speed,
    wc.conditions,
    
    -- Booking URL construction
    'https://ticketing.thewave.com/ticketSale/tickets?date=' || s.session_date || '&time=' || s.session_time as booking_url
    
FROM sessions s
LEFT JOIN weather_cache wc ON s.session_date = wc.session_date AND wc.expires_at > NOW()
WHERE s.spots_available > 0
  AND s.session_date >= CURRENT_DATE
ORDER BY s.session_date, s.session_time;
```

## Database Functions

### Core Matching Functions

#### `get_users_for_session_notification(session_row)`
Returns users who should receive notifications for a specific session.

```sql
CREATE OR REPLACE FUNCTION get_users_for_session_notification(session_row sessions)
RETURNS TABLE(
    user_id UUID,
    telegram_id BIGINT,
    session_matches BOOLEAN,
    match_reasons TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        upv.user_id,
        upv.telegram_id,
        (
            -- Check if user matches session criteria
            (session_row.level = ANY(upv.levels) OR upv.levels IS NULL) AND
            (session_row.side = ANY(upv.sides) OR 'A' = ANY(upv.sides) OR upv.sides IS NULL) AND
            (EXTRACT(DOW FROM session_row.session_date) = ANY(upv.days) OR upv.days IS NULL) AND
            (
                upv.time_windows IS NULL OR
                EXISTS (
                    SELECT 1 FROM JSON_ARRAY_ELEMENTS(upv.time_windows) tw
                    WHERE session_row.session_time BETWEEN 
                        (tw->>'start_time')::TIME AND (tw->>'end_time')::TIME
                )
            ) AND
            session_row.spots_available >= upv.min_spots
        ) as session_matches,
        
        -- Build array of match reasons for debugging
        ARRAY[
            CASE WHEN session_row.level = ANY(upv.levels) THEN 'level_match' END,
            CASE WHEN session_row.side = ANY(upv.sides) OR 'A' = ANY(upv.sides) THEN 'side_match' END,
            CASE WHEN EXTRACT(DOW FROM session_row.session_date) = ANY(upv.days) THEN 'day_match' END,
            CASE WHEN session_row.spots_available >= upv.min_spots THEN 'spots_match' END
        ] as match_reasons
        
    FROM user_preferences_view upv
    WHERE upv.notification_enabled = true
      -- Ensure user hasn't already been notified about this session
      AND NOT EXISTS (
          SELECT 1 FROM notifications_sent ns
          WHERE ns.user_id = upv.user_id
            AND ns.session_id = session_row.id
            AND ns.notification_type = 'session_alert'
      );
END;
$$ LANGUAGE plpgsql;
```

#### `get_users_for_digest(digest_type)`
Returns users subscribed to specific digest types.

```sql
CREATE OR REPLACE FUNCTION get_users_for_digest(digest_type notification_timing_enum)
RETURNS TABLE(
    user_id UUID,
    telegram_id BIGINT,
    preferences JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        upv.user_id,
        upv.telegram_id,
        JSON_BUILD_OBJECT(
            'levels', upv.levels,
            'sides', upv.sides,
            'days', upv.days,
            'time_windows', upv.time_windows,
            'min_spots', upv.min_spots
        )::JSONB as preferences
        
    FROM user_preferences_view upv
    WHERE upv.notification_enabled = true
      AND digest_type = ANY(upv.notification_timings)
      -- Rate limiting: don't send digest more than once per 4 hours
      AND NOT EXISTS (
          SELECT 1 FROM notifications_sent ns
          WHERE ns.user_id = upv.user_id
            AND ns.notification_type = (digest_type || '_digest')::notification_type_enum
            AND ns.sent_at > NOW() - INTERVAL '4 hours'
      );
END;
$$ LANGUAGE plpgsql;
```

### Utility Functions

#### `update_user_streak(user_id)`
Calculate and update user's consecutive session attendance.

```sql
CREATE OR REPLACE FUNCTION update_user_streak(target_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    streak_count INTEGER := 0;
    session_record RECORD;
BEGIN
    -- Calculate consecutive attended sessions from most recent
    FOR session_record IN 
        SELECT attended, created_at::DATE as session_date
        FROM user_sessions us
        JOIN sessions s ON us.session_id = s.id
        WHERE us.user_id = target_user_id
        ORDER BY s.session_date DESC, s.session_time DESC
    LOOP
        IF session_record.attended THEN
            streak_count := streak_count + 1;
        ELSE
            EXIT; -- Break streak on first non-attended session
        END IF;
    END LOOP;
    
    -- Update user profile with calculated streak
    UPDATE profiles 
    SET current_streak = streak_count,
        updated_at = NOW()
    WHERE id = target_user_id;
    
    RETURN streak_count;
END;
$$ LANGUAGE plpgsql;
```

#### `cleanup_old_notifications(days_to_keep)`
Remove old notification records for database maintenance.

```sql
CREATE OR REPLACE FUNCTION cleanup_old_notifications(days_to_keep INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM notifications_sent 
    WHERE sent_at < NOW() - (days_to_keep || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
```

## Triggers & Automation

### Automatic Timestamp Updates

```sql
-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to relevant tables
CREATE TRIGGER update_profiles_updated_at 
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sessions_updated_at 
    BEFORE UPDATE ON sessions  
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Notification Deduplication

```sql
-- Automatically create notification records when sessions are matched
CREATE OR REPLACE FUNCTION create_session_notification()
RETURNS TRIGGER AS $$
BEGIN
    -- This would be called by application logic after sending notification
    INSERT INTO notifications_sent (user_id, session_id, notification_type)
    VALUES (NEW.user_id, NEW.session_id, 'session_alert')
    ON CONFLICT (user_id, session_id, notification_type) DO NOTHING;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## Indexes & Performance

### Query Optimization

#### Primary Indexes
```sql
-- User lookup performance
CREATE INDEX CONCURRENTLY profiles_telegram_id_idx ON profiles (telegram_id);
CREATE INDEX CONCURRENTLY profiles_notification_enabled_idx ON profiles (notification_enabled) WHERE notification_enabled = true;

-- Session queries
CREATE INDEX CONCURRENTLY sessions_date_time_level_idx ON sessions (session_date, session_time, level);
CREATE INDEX CONCURRENTLY sessions_availability_idx ON sessions (spots_available) WHERE spots_available > 0;
CREATE INDEX CONCURRENTLY sessions_future_idx ON sessions (session_date) WHERE session_date >= CURRENT_DATE;

-- Notification deduplication
CREATE UNIQUE INDEX CONCURRENTLY notifications_sent_unique_idx ON notifications_sent (user_id, session_id, notification_type);
CREATE INDEX CONCURRENTLY notifications_sent_cleanup_idx ON notifications_sent (sent_at) WHERE sent_at < NOW() - INTERVAL '30 days';
```

#### Composite Indexes for Complex Queries
```sql
-- User preference joins
CREATE INDEX CONCURRENTLY user_levels_user_level_idx ON user_levels (user_id, level);
CREATE INDEX CONCURRENTLY user_days_user_day_idx ON user_days (user_id, day_of_week);
CREATE INDEX CONCURRENTLY user_time_windows_user_time_idx ON user_time_windows (user_id, start_time, end_time);

-- Session matching performance
CREATE INDEX CONCURRENTLY sessions_matching_idx ON sessions (level, side, session_date, session_time) WHERE spots_available > 0;
```

### Query Examples

#### Find Sessions for User
```sql
-- Optimized query using the view and indexes
SELECT s.* 
FROM available_sessions_view s
JOIN user_preferences_view upv ON upv.user_id = $1
WHERE s.session_date BETWEEN $2 AND $3
  AND (s.level = ANY(upv.levels) OR upv.levels IS NULL)
  AND (s.side = ANY(upv.sides) OR 'A' = ANY(upv.sides) OR upv.sides IS NULL)
  AND (EXTRACT(DOW FROM s.session_date) = ANY(upv.days) OR upv.days IS NULL)
  AND s.spots_available >= upv.min_spots
ORDER BY s.session_date, s.session_time;
```

#### Digest Recipients Query
```sql
-- Get users for morning digest with their preferences
SELECT upv.telegram_id, upv.preferences
FROM user_preferences_view upv
WHERE upv.notification_enabled = true
  AND 'morning' = ANY(upv.notification_timings)
  AND NOT EXISTS (
      SELECT 1 FROM notifications_sent ns
      WHERE ns.user_id = upv.user_id
        AND ns.notification_type = 'morning_digest'
        AND ns.sent_at > NOW() - INTERVAL '4 hours'
  );
```

## Security & Privacy

### Row Level Security (RLS)

```sql
-- Enable RLS on all user-facing tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sides ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_time_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

-- Users can only access their own data
CREATE POLICY user_data_access ON profiles FOR ALL USING (telegram_id = current_setting('app.current_user_telegram_id', true)::BIGINT);
CREATE POLICY user_levels_access ON user_levels FOR ALL USING (user_id = (SELECT id FROM profiles WHERE telegram_id = current_setting('app.current_user_telegram_id', true)::BIGINT));

-- Service role bypasses RLS for notifications
CREATE POLICY service_access ON profiles FOR ALL TO service_role USING (true);
```

### Data Privacy

#### Anonymization Function
```sql
CREATE OR REPLACE FUNCTION anonymize_user_data(target_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    -- Replace sensitive data with anonymized versions
    UPDATE profiles 
    SET telegram_username = 'deleted_user_' || SUBSTRING(id::TEXT, 1, 8),
        telegram_id = -ABS(EXTRACT(EPOCH FROM NOW()))::BIGINT, -- Negative to avoid conflicts
        notification_enabled = false
    WHERE id = target_user_id;
    
    -- Keep preferences but mark as anonymized
    INSERT INTO user_data_deletions (original_user_id, deleted_at, deletion_reason)
    VALUES (target_user_id, NOW(), 'user_requested');
    
    RETURN true;
END;
$$ LANGUAGE plpgsql;
```

## Monitoring & Maintenance

### Database Health Checks

```sql
-- Table size monitoring
CREATE VIEW database_stats AS
SELECT 
    schemaname,
    tablename,
    attname,
    n_distinct,
    correlation,
    most_common_vals
FROM pg_stats 
WHERE schemaname = 'public'
ORDER BY tablename, attname;

-- Query performance monitoring  
CREATE VIEW slow_queries AS
SELECT 
    query,
    calls,
    total_time,
    mean_time,
    max_time,
    stddev_time
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 20;
```

### Maintenance Procedures

#### Daily Maintenance
```sql
-- Run daily at 2 AM
SELECT cleanup_old_notifications(30); -- Keep 30 days
VACUUM ANALYZE notifications_sent;
VACUUM ANALYZE sessions;
```

#### Weekly Maintenance  
```sql
-- Update table statistics
ANALYZE;

-- Check for missing indexes
SELECT schemaname, tablename, attname, n_distinct, correlation
FROM pg_stats 
WHERE correlation < 0.1 AND n_distinct > 100;
```

## Migration Strategy

### Schema Versioning
Migrations are stored in `/supabase/migrations/` with semantic versioning:
- `YYYYMMDDHHMMSS_description.sql` format
- Forward-only migrations (no rollbacks)
- Feature flags for gradual rollouts

### Example Migration
```sql
-- 20241201000002_add_user_streaks.sql
BEGIN;

-- Add streak tracking to profiles
ALTER TABLE profiles ADD COLUMN current_streak INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN longest_streak INTEGER DEFAULT 0;

-- Create index for streak queries  
CREATE INDEX CONCURRENTLY profiles_streak_idx ON profiles (current_streak DESC) WHERE current_streak > 0;

-- Backfill existing user streaks
UPDATE profiles SET current_streak = (
    SELECT COALESCE(update_user_streak(profiles.id), 0)
) WHERE id IN (
    SELECT DISTINCT user_id FROM user_sessions WHERE attended = true
);

COMMIT;
```

This database documentation provides a comprehensive guide to WavePing's data architecture, including schema design, performance optimization, security considerations, and maintenance procedures.