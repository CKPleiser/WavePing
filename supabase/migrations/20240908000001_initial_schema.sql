-- WavePing Initial Schema
-- Enable necessary extensions
create extension if not exists "uuid-ossp";

-- Session levels enum
create type session_level as enum (
    'beginner',
    'improver', 
    'intermediate',
    'advanced',
    'advanced_plus',
    'expert',
    'expert_turns',
    'expert_barrels',
    'women_only',
    'improver_lesson',
    'intermediate_lesson',
    'advanced_coaching',
    'high_performance_coaching'
);

-- Notification timing enum
create type notification_timing as enum ('1w', '48h', '24h', '12h', '2h');

-- User profiles table (extends Supabase Auth)
create table profiles (
    id uuid primary key default uuid_generate_v4(),
    telegram_id bigint unique not null,
    telegram_username text,
    email text,
    min_spots integer default 1,
    notification_enabled boolean default true,
    streak_count integer default 0,
    total_sessions integer default 0,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- User preferences tables
create table user_levels (
    user_id uuid references profiles(id) on delete cascade,
    level session_level,
    primary key (user_id, level)
);

create table user_sides (
    user_id uuid references profiles(id) on delete cascade,
    side char(1) check (side in ('L', 'R', 'A')), -- L=Left, R=Right, A=Any
    primary key (user_id, side)
);

create table user_days (
    user_id uuid references profiles(id) on delete cascade,
    day_of_week integer check (day_of_week between 0 and 6), -- 0=Monday, 6=Sunday
    primary key (user_id, day_of_week)
);

create table user_time_windows (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid references profiles(id) on delete cascade,
    start_time time not null,
    end_time time not null,
    constraint valid_time_window check (end_time > start_time)
);

create table user_notifications (
    user_id uuid references profiles(id) on delete cascade,
    timing notification_timing,
    primary key (user_id, timing)
);

-- Sessions table (scraped from The Wave)
create table sessions (
    id text primary key, -- hash of date+time+name for uniqueness
    date date not null,
    start_time time not null,
    end_time time,
    session_name text not null,
    level session_level,
    side char(1),
    total_spots integer,
    spots_available integer,
    book_url text,
    instructor text,
    water_temp decimal(3,1),
    weather_data jsonb,
    first_seen timestamptz default now(),
    last_updated timestamptz default now(),
    is_active boolean default true
);

-- Indexes for performance
create index idx_sessions_date_time on sessions(date, start_time);
create index idx_sessions_level on sessions(level);
create index idx_sessions_active on sessions(is_active);
create index idx_profiles_telegram_id on profiles(telegram_id);
create index idx_sessions_spots on sessions(spots_available) where spots_available > 0;

-- Notification tracking
create table notifications_sent (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid references profiles(id) on delete cascade,
    session_id text references sessions(id) on delete cascade,
    timing notification_timing,
    sent_at timestamptz default now(),
    unique(user_id, session_id, timing)
);

-- User session attendance tracking
create table user_sessions (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid references profiles(id) on delete cascade,
    session_id text references sessions(id) on delete cascade,
    status text check (status in ('going', 'skipped', 'attended', 'missed')),
    rating text check (rating in ('fire', 'good', 'meh')),
    created_at timestamptz default now(),
    unique(user_id, session_id)
);

-- Session changes audit log
create table session_changes (
    id uuid primary key default uuid_generate_v4(),
    session_id text references sessions(id),
    change_type text check (change_type in ('new', 'spots_increased', 'spots_decreased', 'cancelled')),
    old_spots integer,
    new_spots integer,
    detected_at timestamptz default now()
);

-- Weather data cache
create table weather_cache (
    id uuid primary key default uuid_generate_v4(),
    date date not null,
    air_temp decimal(3,1),
    water_temp decimal(3,1),
    wind_speed integer,
    wind_direction text,
    conditions text,
    icon text,
    cached_at timestamptz default now(),
    unique(date)
);

-- Function to get matching users for a session
create or replace function get_matching_users(session_record sessions)
returns table(
    user_id uuid, 
    telegram_id bigint, 
    notification_timings notification_timing[]
)
language plpgsql
as $$
begin
    return query
    select distinct
        p.id,
        p.telegram_id,
        array_agg(distinct un.timing) as notification_timings
    from profiles p
    join user_levels ul on ul.user_id = p.id
    left join user_sides us on us.user_id = p.id
    left join user_days ud on ud.user_id = p.id
    left join user_time_windows utw on utw.user_id = p.id
    join user_notifications un on un.user_id = p.id
    where 
        p.notification_enabled = true
        and ul.level = session_record.level
        and (
            not exists (select 1 from user_sides where user_id = p.id)
            or session_record.side in (select side from user_sides where user_id = p.id)
            or 'A' in (select side from user_sides where user_id = p.id)
        )
        and (
            not exists (select 1 from user_days where user_id = p.id)
            or extract(dow from session_record.date) in (select day_of_week from user_days where user_id = p.id)
        )
        and (
            not exists (select 1 from user_time_windows where user_id = p.id)
            or exists (
                select 1 from user_time_windows 
                where user_id = p.id 
                and session_record.start_time between start_time and end_time
            )
        )
        and session_record.spots_available >= p.min_spots
    group by p.id, p.telegram_id;
end;
$$;

-- Function to update user streak
create or replace function update_user_streak(user_uuid uuid)
returns void
language plpgsql
as $$
declare
    consecutive_days integer := 0;
    last_session_date date;
    current_date_check date := current_date;
begin
    -- Get the most recent session attendance
    select max(s.date) into last_session_date
    from user_sessions us
    join sessions s on s.id = us.session_id
    where us.user_id = user_uuid and us.status = 'attended';
    
    -- Calculate streak
    if last_session_date is not null then
        -- Count consecutive days with sessions
        with daily_sessions as (
            select distinct s.date
            from user_sessions us
            join sessions s on s.id = us.session_id
            where us.user_id = user_uuid 
              and us.status = 'attended'
              and s.date <= current_date_check
            order by s.date desc
        )
        select count(*) into consecutive_days
        from daily_sessions ds
        where ds.date >= (
            select min(date_series.date)
            from generate_series(
                current_date_check - interval '30 days',
                current_date_check,
                interval '1 day'
            ) as date_series(date)
            where not exists (
                select 1 from daily_sessions ds2 
                where ds2.date = date_series.date::date
            )
            limit 1
        );
    end if;
    
    -- Update the user's streak
    update profiles 
    set streak_count = consecutive_days,
        updated_at = now()
    where id = user_uuid;
end;
$$;

-- Trigger to update updated_at timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language 'plpgsql';

create trigger update_profiles_updated_at 
    before update on profiles
    for each row execute function update_updated_at_column();

-- RLS (Row Level Security) policies
alter table profiles enable row level security;
alter table user_levels enable row level security;
alter table user_sides enable row level security;
alter table user_days enable row level security;
alter table user_time_windows enable row level security;
alter table user_notifications enable row level security;
alter table user_sessions enable row level security;

-- Allow users to manage their own data
create policy "Users can view own profile" on profiles
    for all using (telegram_id = current_setting('app.telegram_id', true)::bigint);

create policy "Users can manage own preferences" on user_levels
    for all using (user_id in (
        select id from profiles where telegram_id = current_setting('app.telegram_id', true)::bigint
    ));

-- Similar policies for other user tables
create policy "Users can manage own sides" on user_sides
    for all using (user_id in (
        select id from profiles where telegram_id = current_setting('app.telegram_id', true)::bigint
    ));

create policy "Users can manage own days" on user_days
    for all using (user_id in (
        select id from profiles where telegram_id = current_setting('app.telegram_id', true)::bigint
    ));

create policy "Users can manage own time windows" on user_time_windows
    for all using (user_id in (
        select id from profiles where telegram_id = current_setting('app.telegram_id', true)::bigint
    ));

create policy "Users can manage own notifications" on user_notifications
    for all using (user_id in (
        select id from profiles where telegram_id = current_setting('app.telegram_id', true)::bigint
    ));

create policy "Users can manage own sessions" on user_sessions
    for all using (user_id in (
        select id from profiles where telegram_id = current_setting('app.telegram_id', true)::bigint
    ));

-- Allow public read access to sessions and weather data
alter table sessions enable row level security;
create policy "Sessions are viewable by everyone" on sessions for select using (true);

alter table weather_cache enable row level security;
create policy "Weather is viewable by everyone" on weather_cache for select using (true);

-- Service role can access everything
create policy "Service role can access all profiles" on profiles
    for all using (current_setting('role') = 'service_role');

-- Insert some sample data for testing
insert into weather_cache (date, air_temp, water_temp, wind_speed, wind_direction, conditions, icon) values
    (current_date, 18.5, 14.2, 15, 'WSW', 'Partly cloudy', 'partly-cloudy-day'),
    (current_date + 1, 20.1, 14.5, 12, 'W', 'Sunny', 'clear-day'),
    (current_date + 2, 16.8, 13.9, 20, 'NW', 'Cloudy', 'cloudy');