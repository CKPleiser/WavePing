-- Fix Database Issues for WavePing
-- Run this in your Supabase SQL Editor

-- 1. Add unique index for UPSERT operations (if not exists)
create unique index if not exists sessions_id_uidx on sessions(id);

-- 2. Add efficient date range index
create index if not exists idx_sessions_date_active on sessions(date, is_active);

-- 3. Clean up any existing sessions with NULL spots (these are the problem records)
delete from sessions where spots_available is null or total_spots is null;

-- 4. Show remaining sessions count
select count(*) as remaining_sessions from sessions where date >= current_date;

-- 5. Verify index exists
select 
    indexname,
    indexdef
from pg_indexes 
where tablename = 'sessions' 
and indexname in ('sessions_id_uidx', 'idx_sessions_date_active');

-- After running this, use the refresh script:
-- railway run node scripts/refresh-database.js