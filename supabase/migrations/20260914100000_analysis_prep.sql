-- Migration: analysis prerequisites for KDE + Knox.
--
-- 1. committed_at — one timestamptz per incident. The PNP export splits the
--    commission time across date_committed + time_committed; Knox needs a single
--    instant. Philippine Standard Time (UTC+8, no DST).
--
-- 2. coord_flag — marks coordinates that are data artifacts, not real locations.
--    The export pins a batch of incidents to a default/centroid point (54 rows
--    share 9.006126,125.660995). Left in, that one stack dominates any density
--    surface and manufactures near-repeat pairs that never happened.
--
-- Safe to re-run.

-- =========================================================
-- 1. committed_at
-- =========================================================
alter table public.incidents add column if not exists committed_at timestamptz;

create or replace function public.set_committed_at()
returns trigger
language plpgsql
as $$
begin
  if new.date_committed is not null then
    new.committed_at :=
      (new.date_committed + coalesce(new.time_committed, '00:00:00'::time))
      at time zone 'Asia/Manila';
  else
    new.committed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_committed_at on public.incidents;
create trigger trg_set_committed_at
  before insert or update of date_committed, time_committed
  on public.incidents
  for each row
  execute function public.set_committed_at();

-- Backfill rows loaded before this migration.
update public.incidents
set committed_at =
  (date_committed + coalesce(time_committed, '00:00:00'::time)) at time zone 'Asia/Manila'
where date_committed is not null
  and committed_at is null;

create index if not exists incidents_committed_at_idx
  on public.incidents (committed_at);

-- =========================================================
-- 2. coord_flag
-- =========================================================
alter table public.incidents add column if not exists coord_flag text;

-- Re-runnable: call after every ingest.
--   'missing' — no coordinates at all
--   'stacked' — shares an exact coordinate with >= min_repeats other incidents,
--               which in this dataset means a default pin, not a real address.
create or replace function public.refresh_coord_flags(min_repeats int default 10)
returns table (flag text, rows bigint)
language plpgsql
as $$
begin
  update public.incidents set coord_flag = null where coord_flag is not null;

  update public.incidents
  set coord_flag = 'missing'
  where lat is null or lng is null;

  update public.incidents i
  set coord_flag = 'stacked'
  from (
    select lat, lng
    from public.incidents
    where lat is not null and lng is not null
    group by lat, lng
    having count(*) >= min_repeats
  ) s
  where i.lat = s.lat and i.lng = s.lng;

  return query
    select coord_flag, count(*)
    from public.incidents
    where coord_flag is not null
    group by coord_flag;
end;
$$;

select * from public.refresh_coord_flags();

create index if not exists incidents_coord_flag_idx
  on public.incidents (coord_flag);
