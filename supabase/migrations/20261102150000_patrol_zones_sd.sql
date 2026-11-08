-- Migration: patrol-zone threshold by standard deviations, not share of peak.
--
-- Butuan's surface has one dominant peak (Ampayon) ~4-5x the next hotspots, so
-- "weight >= x% of peak" only ever found that one zone. The standard KDE
-- hotspot threshold (Chainey) is mean + k standard deviations of the cell
-- densities; k = 1 / 2 / 3 gives broad / standard / tight zones. The mean and
-- SD are taken over the whole surface (every cell within 3 bandwidths of an
-- incident, min_weight 0), i.e. the populated study area.
--
-- incidents_patrol_zones() replaces p_threshold with p_sd; the output shape is
-- unchanged, plus a 'threshold' field (the density cut-off, incidents/km^2).

drop function if exists public.incidents_patrol_zones(
  double precision, double precision, double precision, date, date, text, text, text, text, text, int);

create or replace function public.incidents_patrol_zones(
  p_sd            double precision default 2,
  bandwidth_m     double precision default 400,
  cell_m          double precision default 150,
  p_date_from     date    default null,
  p_date_to       date    default null,
  p_barangay      text    default null,
  p_offense       text    default null,
  p_case_status   text    default null,
  p_search        text    default null,
  p_category      text    default null,
  p_min_incidents int     default 5
)
returns json
language sql
stable
set statement_timeout = '15s'
as $$
  with surface as (
    select st_transform(st_makeenvelope(k.west, k.south, k.east, k.north, 4326), 32651) as g,
           k.density
    from public.incidents_kde(
      bandwidth_m, cell_m, p_date_from, p_date_to, p_barangay, p_offense,
      p_case_status, p_search, false, 0, p_category) k
  ),
  cutoff as (
    select avg(density) + least(greatest(p_sd, 0), 5) * stddev_pop(density) as d
    from surface
  ),
  cells as (
    select s.g, s.density
    from surface s cross join cutoff c
    where s.density >= c.d
  ),
  merged as (
    select row_number() over () as zid, g
    from (
      select (st_dump(st_buffer(st_buffer(st_union(g), cell_m / 2), -cell_m / 2))).geom as g
      from cells
    ) d
  ),
  pts as (
    select coalesce(i.blotterno, i.id::text) as k, i.offense, i.barangay,
           i.date_committed, i.time_committed, st_transform(i.geom, 32651) as g
    from public.incidents i
    where i.geom is not null
      and i.coord_flag is null
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
  inzone as (
    select m.zid, p.*
    from merged m
    join pts p on st_intersects(m.g, p.g)
  ),
  stats as (
    select zid, count(distinct k) as incidents from inzone group by zid
  ),
  total as (
    select count(distinct k) as n from pts
  )
  select coalesce(json_agg(z order by (z->>'incidents')::int desc, (z->>'zid')::int), '[]')
  from (
    select json_build_object(
      'zid',          m.zid,
      'geojson',      st_asgeojson(st_transform(m.g, 4326), 6)::json,
      'area_km2',     round((st_area(m.g) / 1e6)::numeric, 3),
      'threshold',    round(c.d::numeric, 2),
      'peak_density', (select max(x.density) from cells x
                       where st_contains(m.g, st_centroid(x.g))),
      'incidents',    s.incidents,
      'total',        t.n,
      'top_offenses', (
        select coalesce(json_agg(json_build_object('label', o, 'count', n) order by n desc, o), '[]')
        from (select offense as o, count(distinct k) as n from inzone iz
              where iz.zid = m.zid and offense is not null
              group by 1 order by 2 desc, 1 limit 3) x),
      'barangays', (
        select coalesce(json_agg(json_build_object('label', b, 'count', n) order by n desc, b), '[]')
        from (select barangay as b, count(distinct k) as n from inzone iz
              where iz.zid = m.zid and barangay is not null
              group by 1 order by 2 desc, 1 limit 3) x),
      'by_dow', (
        select coalesce(json_agg(json_build_object('dow', d, 'count', n)), '[]')
        from (select extract(isodow from date_committed)::int as d, count(distinct k) as n
              from inzone iz where iz.zid = m.zid and date_committed is not null
              group by 1) x),
      'by_hour', (
        select coalesce(json_agg(json_build_object('hour', h, 'count', n)), '[]')
        from (select extract(hour from time_committed)::int as h, count(distinct k) as n
              from inzone iz where iz.zid = m.zid and time_committed is not null
              group by 1) x)
    ) as z
    from merged m
    join stats s using (zid)
    cross join total t
    cross join cutoff c
    where s.incidents >= p_min_incidents
  ) q;
$$;

notify pgrst, 'reload schema';
