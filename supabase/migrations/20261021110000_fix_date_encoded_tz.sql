-- Migration: correct the 8-hour offset in date_encoded for rows already loaded.
--
-- The PNP export stores dateEncoded as text like "2023-01-02 03:52:35" in
-- Philippine Standard Time (encoding activity peaks 06:00-10:00, near-zero
-- 02:00-05:00). ingest.js used to send that without an offset, so Postgres read
-- it as UTC and every instant landed 8 hours late. ingest.js now appends +08:00.
--
-- This shifts the rows loaded before that fix back by 8 hours. It runs once:
-- the column comment is used as a marker, so re-running is a no-op. Only rows
-- inserted before the ingest fix (created_at cutoff) are touched, so data loaded
-- with the fixed script is never shifted.

do $$
declare
  marker text := 'tz-fixed 2026-10-21';
begin
  if coalesce(col_description('public.incidents'::regclass,
       (select attnum from pg_attribute
        where attrelid = 'public.incidents'::regclass and attname = 'date_encoded')),
     '') not like '%' || marker || '%' then

    update public.incidents
    set date_encoded = date_encoded - interval '8 hours'
    where date_encoded is not null
      and created_at < timestamptz '2026-10-21 00:00:00+08';

    execute format(
      'comment on column public.incidents.date_encoded is %L',
      'When the record was encoded (Asia/Manila source, stored as timestamptz). ' || marker
    );
  end if;
end $$;
