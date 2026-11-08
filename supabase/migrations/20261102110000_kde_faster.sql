-- Migration: get the full-dataset KDE under the API timeout, and keep it there.
--
-- 20261102100000_kde_fast.sql made per-point evaluation local, but the unfiltered
-- surface (1,573 points) still needed ~4-5 s on this instance, past the anon
-- role's statement_timeout. Profiling showed the cost is the point x cell rows,
-- not output size.
--
-- 1. Exact speed-ups (output unchanged up to float rounding):
--    - group identical coordinates and weight by count (1,573 points -> 1,266
--      distinct locations in the current data);
--    - per column gi, generate only the gj rows inside the 3h circle instead of
--      the full square, so out-of-reach corners are never materialised;
--    - do the inner arithmetic in float8 (bigint + 0.5 was numeric).
--
-- 2. statement_timeout on incidents_kde_grid() only. PostgREST applies a
--    function's statement_timeout setting to the RPC call, so the heatmap gets
--    headroom as the dataset grows while every other anon request keeps the
--    default limit.

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
  min_weight     double precision default 0.04
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
        and (p_search is null or (
              i.narrative   ilike '%' || p_search || '%' or
              i.offense     ilike '%' || p_search || '%' or
              i.barangay    ilike '%' || p_search || '%' or
              i.blotterno   ilike '%' || p_search || '%' or
              i.victim_raw  ilike '%' || p_search || '%' or
              i.suspect_raw ilike '%' || p_search || '%'))
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

alter function public.incidents_kde_grid(
  double precision, double precision, date, date, text, text, text, text, boolean, double precision
) set statement_timeout = '15s';

notify pgrst, 'reload schema';
