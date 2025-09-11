-- Update notification system to support digest approach
-- Change notification timing enum to support morning/evening digests

-- Drop existing notification timing enum and recreate
ALTER TABLE user_notifications DROP CONSTRAINT IF EXISTS user_notifications_timing_check;
ALTER TABLE notifications_sent DROP CONSTRAINT IF EXISTS notifications_sent_timing_check;

-- Drop and recreate the enum with new values
DROP TYPE IF EXISTS notification_timing CASCADE;
CREATE TYPE notification_timing AS ENUM ('morning', 'evening');

-- Recreate the columns with the new enum
ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS new_timing notification_timing;
ALTER TABLE notifications_sent ADD COLUMN IF NOT EXISTS new_timing notification_timing;

-- Migrate existing data to new format (default to morning digest)
UPDATE user_notifications SET new_timing = 'morning' WHERE new_timing IS NULL;
UPDATE notifications_sent SET new_timing = 'morning' WHERE new_timing IS NULL;

-- Drop old timing columns and rename new ones
ALTER TABLE user_notifications DROP COLUMN IF EXISTS timing;
ALTER TABLE user_notifications RENAME COLUMN new_timing TO timing;

ALTER TABLE notifications_sent DROP COLUMN IF EXISTS timing;  
ALTER TABLE notifications_sent RENAME COLUMN new_timing TO timing;

-- Update the function signature
DROP FUNCTION IF EXISTS get_matching_users(sessions);

-- Recreate the function with updated logic for digest notifications
CREATE OR REPLACE FUNCTION get_matching_users(session_record sessions)
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
    WHERE 
        p.notification_enabled = true
        AND ul.level = session_record.level
        AND (
            NOT EXISTS (SELECT 1 FROM user_sides WHERE user_id = p.id)
            OR session_record.side IN (SELECT side FROM user_sides WHERE user_id = p.id)
            OR 'A' IN (SELECT side FROM user_sides WHERE user_id = p.id)
        )
        AND (
            NOT EXISTS (SELECT 1 FROM user_days WHERE user_id = p.id)
            OR extract(dow FROM session_record.date) IN (SELECT day_of_week FROM user_days WHERE user_id = p.id)
        )
        AND (
            NOT EXISTS (SELECT 1 FROM user_time_windows WHERE user_id = p.id)
            OR EXISTS (
                SELECT 1 FROM user_time_windows 
                WHERE user_id = p.id 
                AND session_record.start_time BETWEEN start_time AND end_time
            )
        )
        AND session_record.spots_available >= p.min_spots
    GROUP BY p.id, p.telegram_id;
END;
$$;