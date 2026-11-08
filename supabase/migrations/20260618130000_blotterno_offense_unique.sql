-- Migration: a single blotter entry can have multiple offenses (e.g. reckless
-- imprudence filed as both "physical injury" and "damage to property"), so
-- blotterno is NOT unique per row. Replace the single-column unique(blotterno)
-- with a composite unique(blotterno, offense). Idempotent; run on the existing
-- (empty) table before loading data.

-- Drop the original constraint created by `blotterno text unique`.
alter table public.incidents drop constraint if exists incidents_blotterno_key;

-- Add the composite unique constraint (guarded so re-runs don't error).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'incidents_blotterno_offense_key'
  ) then
    alter table public.incidents
      add constraint incidents_blotterno_offense_key unique (blotterno, offense);
  end if;
end $$;
