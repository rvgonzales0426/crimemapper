-- Migration: initial incidents schema for Crime Mapper
-- Target: Supabase (PostgreSQL + PostGIS + pgvector)
-- Safe to run in the Supabase SQL editor or via `supabase db push`.

-- =========================================================
-- 1. Extensions
-- =========================================================
create extension if not exists postgis;        -- spatial types + functions
create extension if not exists vector;         -- pgvector (embeddings)
create extension if not exists "uuid-ossp";    -- uuid helpers (quoted: name has a hyphen)

-- =========================================================
-- 2. Table: incidents
-- =========================================================
create table if not exists public.incidents (
  id              uuid primary key default gen_random_uuid(),
  blotterno       text unique,
  date_encoded    timestamptz,
  region          text,
  ppo             text,
  stn             text,
  municipal       text,
  barangay        text,
  street          text,
  type_of_place   text,
  date_reported   date,
  time_reported   time,
  date_committed  date,
  time_committed  time,
  incident_type   text,
  offense         text,
  offense_type    text,
  modus           text,
  victim_raw      text,
  suspect_raw     text,
  narrative       text,
  case_status     text,
  case_solve_type text,
  lat             float8,
  lng             float8,
  geom            geometry(Point, 4326),
  embedding       vector(1536),
  created_at      timestamptz default now()
);

-- =========================================================
-- 3. Indexes
-- =========================================================
-- Spatial index on geom
create index if not exists incidents_geom_gist
  on public.incidents using gist (geom);

-- Composite index on the common analysis filters
create index if not exists incidents_brgy_date_offense_idx
  on public.incidents (barangay, date_committed, offense);

-- =========================================================
-- 4. Trigger: auto-populate geom from lat/lng
-- =========================================================
create or replace function public.set_geom_from_latlng()
returns trigger
language plpgsql
as $$
begin
  if new.lat is not null and new.lng is not null then
    -- NOTE: ST_MakePoint takes (X, Y) = (longitude, latitude)
    new.geom := st_setsrid(st_makepoint(new.lng, new.lat), 4326);
  else
    new.geom := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_geom on public.incidents;
create trigger trg_set_geom
  before insert or update of lat, lng
  on public.incidents
  for each row
  execute function public.set_geom_from_latlng();

-- =========================================================
-- 5. Row Level Security
-- =========================================================
-- The browser app uses the anon key. Without RLS, anon can read AND write
-- everything. Enable RLS and grant read-only access to anon/authenticated.
-- Writes (import/ETL) should use the service_role key, which bypasses RLS.
alter table public.incidents enable row level security;

drop policy if exists "incidents_read" on public.incidents;
create policy "incidents_read"
  on public.incidents
  for select
  to anon, authenticated
  using (true);
