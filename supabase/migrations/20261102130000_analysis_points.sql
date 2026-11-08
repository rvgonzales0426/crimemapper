-- Migration: points for client-side spatial statistics (Knox near-repeat test).
--
-- The Knox Monte Carlo test needs ~99 permutations over every pair of incidents
-- — tens of millions of operations, past the API statement timeout on this
-- instance — so it runs in a browser Web Worker (src/lib/knox.js). PostGIS does
-- the parts it is good at: filtering, and projecting to metres.
--
-- incidents_analysis_points() returns ONE json array (no row cap) of
--   { id, blotterno, lat, lng, x, y, date_committed, barangay, offenses }
-- where x, y are EPSG:32651 (UTM 51N) metres.
--
-- One point per blotter entry: a blotter filed under several offenses is a
-- single event, and counting it once per offense would manufacture "near
-- repeats" at 0 m / 0 days. `offenses` lists all of the blotter's offenses.
--
-- Filters match the map (same columns as the Incidents table search), plus
-- p_category ('crime' | 'traffic' | null) as on the Dashboard. Flagged
-- coordinates (missing / stacked default pin) are always excluded.

create or replace function public.incidents_analysis_points(
  p_date_from    date default null,
  p_date_to      date default null,
  p_barangay     text default null,
  p_offense      text default null,
  p_case_status  text default null,
  p_search       text default null,
  p_category     text default null
)
returns json
language sql
stable
as $$
  with f as (
    select i.*, coalesce(i.blotterno, i.id::text) as k
    from public.incidents i
    where i.geom is not null
      and i.coord_flag is null
      and i.date_committed is not null
      and (p_date_from   is null or i.date_committed >= p_date_from)
      and (p_date_to     is null or i.date_committed <= p_date_to)
      and (p_barangay    is null or i.barangay    = p_barangay)
      and (p_offense     is null or i.offense     = p_offense)
      and (p_case_status is null or i.case_status = p_case_status)
      and (p_category is null
           or (p_category = 'traffic' and coalesce(i.incident_type ilike '%vehicular accident%', false))
           or (p_category = 'crime' and not coalesce(i.incident_type ilike '%vehicular accident%', false)))
      and (p_search is null or (
            i.blotterno     ilike '%' || p_search || '%' or
            i.barangay      ilike '%' || p_search || '%' or
            i.offense       ilike '%' || p_search || '%' or
            i.incident_type ilike '%' || p_search || '%' or
            i.victim_raw    ilike '%' || p_search || '%' or
            i.suspect_raw   ilike '%' || p_search || '%' or
            i.narrative     ilike '%' || p_search || '%' or
            i.case_status   ilike '%' || p_search || '%'))
  ),
  rep as (
    select distinct on (k) k, id, blotterno, lat, lng, geom, date_committed, barangay
    from f
    order by k, id
  ),
  offs as (
    select k, string_agg(distinct offense, '; ') as offenses
    from f
    group by k
  )
  select coalesce(json_agg(json_build_object(
           'id',             r.id,
           'blotterno',      r.blotterno,
           'lat',            r.lat,
           'lng',            r.lng,
           'x',              round(st_x(st_transform(r.geom, 32651))::numeric, 1),
           'y',              round(st_y(st_transform(r.geom, 32651))::numeric, 1),
           'date_committed', r.date_committed,
           'barangay',       r.barangay,
           'offenses',       o.offenses)
         order by r.date_committed, r.id), '[]')
  from rep r
  join offs o using (k);
$$;

notify pgrst, 'reload schema';
