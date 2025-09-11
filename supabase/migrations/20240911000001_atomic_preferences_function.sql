-- Create atomic preferences save function
-- This prevents partial preference saves if the process dies midway
CREATE OR REPLACE FUNCTION save_preferences(
  p_user_id uuid,
  p_levels text[],
  p_sides text[],
  p_days int[],
  p_time_windows jsonb,
  p_notifications text[]
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Start transaction
  BEGIN
    -- Delete existing preferences
    DELETE FROM user_levels WHERE user_id = p_user_id;
    DELETE FROM user_sides WHERE user_id = p_user_id;
    DELETE FROM user_days WHERE user_id = p_user_id;
    DELETE FROM user_time_windows WHERE user_id = p_user_id;
    DELETE FROM user_notifications WHERE user_id = p_user_id;

    -- Insert new levels
    IF array_length(p_levels, 1) > 0 THEN
      INSERT INTO user_levels(user_id, level)
        SELECT p_user_id, unnest(p_levels);
    END IF;

    -- Insert new sides
    IF array_length(p_sides, 1) > 0 THEN
      INSERT INTO user_sides(user_id, side)
        SELECT p_user_id, unnest(p_sides);
    END IF;

    -- Insert new days
    IF array_length(p_days, 1) > 0 THEN
      INSERT INTO user_days(user_id, day_of_week)
        SELECT p_user_id, unnest(p_days);
    END IF;

    -- Insert new time windows
    IF p_time_windows IS NOT NULL AND jsonb_array_length(p_time_windows) > 0 THEN
      INSERT INTO user_time_windows(user_id, start_time, end_time)
        SELECT p_user_id, (tw->>'start_time')::time, (tw->>'end_time')::time
        FROM jsonb_array_elements(p_time_windows) tw;
    END IF;

    -- Insert new notifications
    IF array_length(p_notifications, 1) > 0 THEN
      INSERT INTO user_notifications(user_id, timing)
        SELECT p_user_id, unnest(p_notifications);
    END IF;
  END;
END;
$$;