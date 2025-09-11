-- Add unique constraint to prevent duplicate notifications
-- This ensures idempotency for notification sending
ALTER TABLE notifications_sent 
  ADD CONSTRAINT notifications_sent_unique UNIQUE (user_id, session_id, timing);