-- Fix the ambiguous column reference in get_matching_users function
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
        array_agg(DISTINCT un.timing) as notification_timings
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
            OR session_record.side IN (SELECT side FROM user_sides WHERE user_sides.user_id = p.id)
            OR 'A' IN (SELECT side FROM user_sides WHERE user_sides.user_id = p.id)
        )
        AND (
            NOT EXISTS (SELECT 1 FROM user_days WHERE user_id = p.id)
            OR extract(dow from session_record.date) IN (SELECT day_of_week FROM user_days WHERE user_days.user_id = p.id)
        )
        AND (
            NOT EXISTS (SELECT 1 FROM user_time_windows WHERE user_id = p.id)
            OR EXISTS (
                SELECT 1 FROM user_time_windows utw2
                WHERE utw2.user_id = p.id 
                AND session_record.start_time BETWEEN utw2.start_time AND utw2.end_time
            )
        )
        AND session_record.spots_available >= p.min_spots
    GROUP BY p.id, p.telegram_id;
END;
$$;