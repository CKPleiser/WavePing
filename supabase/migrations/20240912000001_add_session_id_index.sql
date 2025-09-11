-- Add unique index on sessions.id for UPSERT operations
-- This enables efficient UPSERT operations without conflicts
create unique index if not exists sessions_id_uidx on sessions(id);

-- Add index for efficient date range queries
create index if not exists idx_sessions_date_active on sessions(date, is_active);

-- Optional: Add RPC function for deactivating missing sessions (as suggested by ChatGPT)
create or replace function deactivate_missing_sessions(p_from date, p_to date, p_seen_ids text[])
returns void language plpgsql as $$
begin
  update sessions s
     set is_active = false,
         last_updated = now()
   where s.date between p_from and p_to
     and s.is_active = true
     and not (s.id = any (p_seen_ids));
end $$;