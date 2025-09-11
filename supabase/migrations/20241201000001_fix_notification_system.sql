-- Fix notification system to properly support both timing preferences and digest delivery
-- Revert the enum to support session timing preferences and add digest preferences table

-- Drop and recreate the enum with proper values
DROP TYPE IF EXISTS notification_timing CASCADE;
CREATE TYPE notification_timing AS ENUM ('1w', '48h', '24h', '12h', '2h');

-- Recreate the columns with the timing enum
ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS new_timing notification_timing;
ALTER TABLE notifications_sent ADD COLUMN IF NOT EXISTS new_timing notification_timing;

-- Clear existing data since it's incompatible
DELETE FROM user_notifications;
DELETE FROM notifications_sent;

-- Drop old timing columns and rename new ones
ALTER TABLE user_notifications DROP COLUMN IF EXISTS timing;
ALTER TABLE user_notifications RENAME COLUMN new_timing TO timing;

ALTER TABLE notifications_sent DROP COLUMN IF EXISTS timing;  
ALTER TABLE notifications_sent RENAME COLUMN new_timing TO timing;

-- Create digest preferences table to track when users want to receive digests
CREATE TABLE IF NOT EXISTS user_digest_preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
    digest_type text NOT NULL CHECK (digest_type IN ('morning', 'evening')),
    created_at timestamptz DEFAULT NOW(),
    UNIQUE(user_id, digest_type)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_digest_preferences_user_id ON user_digest_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_digest_preferences_type ON user_digest_preferences(digest_type);

-- Update the function to work with both timing and digest preferences
DROP FUNCTION IF EXISTS get_matching_users(sessions);
DROP FUNCTION IF EXISTS get_users_for_session_notification;

-- Function to get users for digest notifications
CREATE OR REPLACE FUNCTION get_users_for_digest(digest_type_param text)
RETURNS TABLE(
    user_id uuid,
    telegram_id bigint,
    min_spots integer,
    notification_timings notification_timing[]
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT
        p.id,
        p.telegram_id,
        p.min_spots,
        array_agg(DISTINCT un.timing) FILTER (WHERE un.timing IS NOT NULL) AS notification_timings
    FROM profiles p
    JOIN user_digest_preferences udp ON udp.user_id = p.id
    LEFT JOIN user_notifications un ON un.user_id = p.id
    WHERE p.notification_enabled = true
    AND udp.digest_type = digest_type_param
    GROUP BY p.id, p.telegram_id, p.min_spots;
END;
$$;

-- Function to get users for session-based notifications (for the /api/cron/send-notifications endpoint)
CREATE OR REPLACE FUNCTION get_users_for_session_notification(
    session_level text,
    session_side text, 
    session_date date,
    session_start_time time,
    notification_timing_param notification_timing
)
RETURNS TABLE(
    user_id uuid, 
    telegram_id bigint,
    notification_timings notification_timing[]
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT
        p.id,
        p.telegram_id,
        array_agg(DISTINCT un.timing) AS notification_timings
    FROM profiles p
    JOIN user_levels ul ON ul.user_id = p.id
    LEFT JOIN user_sides us ON us.user_id = p.id
    LEFT JOIN user_days ud ON ud.user_id = p.id
    LEFT JOIN user_time_windows utw ON utw.user_id = p.id
    JOIN user_notifications un ON un.user_id = p.id
    WHERE p.notification_enabled = true
    AND un.timing = notification_timing_param
    AND ul.level = session_level
    AND (us.side IS NULL OR us.side = session_side OR us.side = 'Any')
    AND (ud.day_of_week IS NULL OR ud.day_of_week = EXTRACT(DOW FROM session_date))
    AND (utw.start_time IS NULL OR utw.end_time IS NULL OR 
         session_start_time BETWEEN utw.start_time AND utw.end_time)
    GROUP BY p.id, p.telegram_id;
END;
$$;