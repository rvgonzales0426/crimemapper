-- Migration: aggregates for the Dashboard page.
--
-- incidents_dashboard() returns every figure the Dashboard shows as ONE json
-- value (so PostgREST's row cap never applies), scoped by:
--   p_date_from / p_date_to — date_committed window (inclusive; null = open)
--   p_category              — 'crime' | 'traffic' | null (all)
--
-- 'traffic' means incident_type "(Incident) Vehicular Accident" — about 63% of
-- the current data. Separating it keeps road accidents from drowning out crime
-- patterns.
--
-- When both dates are given, `prev` holds the same figures for the window of
-- equal length immediately before it (e.g. 2024 when 2025 is selected), so the
-- stat tiles can show period-over-period change.
--
-- PNP efficiency measures: a Solved case also counts as Cleared, so
--   CCE (crime clearance efficiency) = (Cleared + Solved) / total
--   CSE (crime solution efficiency)  =  Solved / total

create or replace function public.incidents_dashboard(
  p_date_from date default null,
  p_date_to   date default null,
  p_category  text default null
)
returns json
language sql
stable
as $$
  with base as (
    select i.date_committed, i.time_committed, i.barangay, i.offense,
           i.offense_type, i.case_status,
           coalesce(i.incident_type ilike '%vehicular accident%', false) as is_traffic
    from public.incidents i
  ),
  scoped as (
    select * from base
    where p_category is null
       or (p_category = 'traffic' and is_traffic)
       or (p_category = 'crime' and not is_traffic)
  ),
  cur as (
    select * from scoped
    where (p_date_from is null or date_committed >= p_date_from)
      and (p_date_to   is null or date_committed <= p_date_to)
  ),
  prev as (
    select * from scoped
    where p_date_from is not null and p_date_to is not null
      and date_committed between p_date_from - (p_date_to - p_date_from + 1)
                             and p_date_from - 1
  ),
  months as (
    select m
    from generate_series(
      date_trunc('month', coalesce(p_date_from, (select min(date_committed) from cur))),
      date_trunc('month', coalesce(p_date_to,   (select max(date_committed) from cur))),
      interval '1 month') m
  )
  select json_build_object(
    'total',       (select count(*) from cur),
    'crime',       (select count(*) from cur where not is_traffic),
    'traffic',     (select count(*) from cur where is_traffic),
    'solved',      (select count(*) from cur where case_status = 'Solved'),
    'cleared',     (select count(*) from cur where case_status in ('Solved', 'Cleared')),
    'under_investigation',
                   (select count(*) from cur where case_status = 'Under Investigation'),

    'prev', case when p_date_from is null or p_date_to is null then null else (
      select json_build_object(
        'total',   count(*),
        'crime',   count(*) filter (where not is_traffic),
        'traffic', count(*) filter (where is_traffic),
        'solved',  count(*) filter (where case_status = 'Solved'),
        'cleared', count(*) filter (where case_status in ('Solved', 'Cleared')))
      from prev) end,

    'by_status', (
      select coalesce(json_agg(json_build_object('label', s, 'count', n) order by n desc), '[]')
      from (select coalesce(case_status, 'Unknown') as s, count(*) as n
            from cur group by 1) t),

    'by_month', (
      select coalesce(json_agg(json_build_object(
               'month', to_char(months.m, 'YYYY-MM'), 'count', coalesce(c.n, 0))
             order by months.m), '[]')
      from months
      left join (select date_trunc('month', date_committed) as mm, count(*) as n
                 from cur group by 1) c on c.mm = months.m),

    'by_barangay', (
      select coalesce(json_agg(json_build_object('label', b, 'count', n) order by n desc, b), '[]')
      from (select barangay as b, count(*) as n from cur
            where barangay is not null group by 1 order by 2 desc, 1 limit 10) t),

    'by_offense', (
      select coalesce(json_agg(json_build_object('label', o, 'offense_type', ot, 'count', n)
                               order by n desc, o), '[]')
      from (select offense as o, min(offense_type) as ot, count(*) as n from cur
            where offense is not null group by 1 order by 3 desc, 1 limit 10) t),

    -- isodow: 1 = Monday .. 7 = Sunday. Rows without a time are left out.
    'by_dow_hour', (
      select coalesce(json_agg(json_build_object('dow', d, 'hour', h, 'count', n)), '[]')
      from (select extract(isodow from date_committed)::int as d,
                   extract(hour from time_committed)::int as h,
                   count(*) as n
            from cur where time_committed is not null group by 1, 2) t),

    -- Full extent of the data (ignores the date filter) for the period picker.
    'date_min', (select min(date_committed) from base),
    'date_max', (select max(date_committed) from base)
  );
$$;

notify pgrst, 'reload schema';
