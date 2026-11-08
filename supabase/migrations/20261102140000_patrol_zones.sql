-- Migration: data-driven priority patrol zones.
--
-- 1. incidents_kde / incidents_kde_grid gain p_category ('crime' | 'traffic' |
--    null) as their LAST parameter, and p_search now covers the same eight
--    columns as the Incidents table search (it used to miss incident_type and
--    case_status). Changing a signature needs drop + create; the body is
--    otherwise identical to 20261102110000_kde_faster.sql, and the 15 s
--    statement_timeout on the grid wrapper is re-applied.
--
-- 2. incidents_patrol_zones(): thresholds the KDE surface (cells with weight >=
--    p_threshold, i.e. at least that fraction of the peak density), merges
--    touching cells into polygons (a closing buffer of half a cell smooths the
--    staircase edges and closes 1-cell gaps), and for each zone returns:
--      geojson (EPSG:4326), area_km2, peak_density, incidents (distinct
--      blotters inside), total (distinct blotters under the same filters),
--      top_offenses, barangays (top 3 each), by_dow (isodow 1=Mon), by_hour.
--    Zones with fewer than p_min_incidents incidents are dropped. One json
--    value, ordered by incidents desc.

drop function if exists public.incidents_kde_grid(
  double precision, double precision, date, date, text, text, text, text, boolean, double precision);
drop function if exists public.incidents_kde(
  double precision, double precision, date, date, text, text, text, text, boolean, double precision);

create or replace function public.incidents_kde(
  bandwidth_m    double precision default 400,
  cell_m         double precision default 150,
  p_date_from    date    default null,
  p_date_to      date    default null,
  p_barangay     text    default null,
  p_offense      text    default null,
  p_case_status  text    default null,
  p_search       text    default null,
  include_flagged boolean default false,
  min_weight     double precision default 0.04,
  p_category     text    default null
)
returns table (
  south   double precision,
  west    double precision,
  north   double precision,
  east    double precision,
  density double precision,
  weight  double precision
)
language sql
stable
as $$
  with bw as (
    select least(greatest(bandwidth_m, 25), 5000) as h
  ),
  params as (
    select h,
           greatest(least(greatest(cell_m, 25), 2000), h / 20) as c,
           h * 3 as reach
    from bw
  ),
  -- Distinct locations, weighted by how many incidents share each one.
  pts as (
    select st_x(g) as x, st_y(g) as y, count(*)::float8 as n
    from (
      select st_transform(i.geom, 32651) as g
      from public.incidents i
      where i.geom is not null
        and (include_flagged or i.coord_flag is null)
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
    ) t
    group by 1, 2
  ),
  -- Columns of cells within reach of each location: x offset to the cell centre
  -- and the half-height of the 3h circle at that offset.
  cols as (
    select pt.y, pt.n, gi, dx,
           sqrt(greatest(p.reach * p.reach - dx * dx, 0)) as half
    from pts pt
    cross join params p,
      lateral generate_series(
        floor((pt.x - p.reach) / p.c)::bigint - 1,
        ceil ((pt.x + p.reach) / p.c)::bigint) gi,
      lateral (select (gi::float8 + 0.5) * p.c - pt.x as dx) o
  ),
  contrib as (
    select k.gi, gj, k.n, k.dx, (gj::float8 + 0.5) * p.c - k.y as dy
    from cols k
    cross join params p,
      lateral generate_series(
        floor((k.y - k.half) / p.c)::bigint - 1,
        ceil ((k.y + k.half) / p.c)::bigint) gj
  ),
  raw as (
    select gi, gj, sum(n * exp(-0.5 * (dx * dx + dy * dy) / (p.h * p.h))) as k
    from contrib
    cross join params p
    where dx * dx + dy * dy <= p.reach * p.reach
    group by gi, gj
  ),
  -- Normalise the kernel and convert from per-m^2 to per-km^2.
  scored as (
    select (r.gi::float8 + 0.5) * p.c as cx, (r.gj::float8 + 0.5) * p.c as cy,
           r.k / (2 * pi() * p.h * p.h) * 1e6 as density
    from raw r cross join params p
  ),
  normalized as (
    select cx, cy, density,
           density / nullif(max(density) over (), 0) as weight
    from scored
  )
  select
    st_y(st_transform(st_setsrid(st_makepoint(n.cx - p.c/2, n.cy - p.c/2), 32651), 4326)),
    st_x(st_transform(st_setsrid(st_makepoint(n.cx - p.c/2, n.cy - p.c/2), 32651), 4326)),
    st_y(st_transform(st_setsrid(st_makepoint(n.cx + p.c/2, n.cy + p.c/2), 32651), 4326)),
    st_x(st_transform(st_setsrid(st_makepoint(n.cx + p.c/2, n.cy + p.c/2), 32651), 4326)),
    n.density,
    n.weight
  from normalized n cross join params p
  where n.weight >= min_weight
  order by n.density desc
  limit 20000;
$$;

create or replace function public.incidents_kde_grid(
  bandwidth_m    double precision default 400,
  cell_m         double precision default 150,
  p_date_from    date    default null,
  p_date_to      date    default null,
  p_barangay     text    default null,
  p_offense      text    default null,
  p_case_status  text    default null,
  p_search       text    default null,
  include_flagged boolean default false,
  min_weight     double precision default 0.04,
  p_category     text    default null
)
returns json
language sql
stable
set statement_timeout = '15s'
as $$
  select coalesce(json_agg(k), '[]'::json)
  from public.incidents_kde(
    bandwidth_m, cell_m, p_date_from, p_date_to, p_barangay, p_offense,
    p_case_status, p_search, include_flagged, min_weight, p_category
  ) k;
$$;

create or replace function public.incidents_patrol_zones(
  p_threshold     double precision default 0.5,
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
  with cells as (
    select st_transform(st_makeenvelope(k.west, k.south, k.east, k.north, 4326), 32651) as g,
           k.density
    from public.incidents_kde(
      bandwidth_m, cell_m, p_date_from, p_date_to, p_barangay, p_offense,
      p_case_status, p_search, false, least(greatest(p_threshold, 0.05), 0.95), p_category) k
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
      'peak_density', (select max(c.density) from cells c
                       where st_contains(m.g, st_centroid(c.g))),
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
    where s.incidents >= p_min_incidents
  ) q;
$$;

notify pgrst, 'reload schema';
