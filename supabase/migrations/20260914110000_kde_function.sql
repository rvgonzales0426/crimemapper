-- Migration: kernel density estimation (KDE) over incident points.
--
-- Replaces the placeholder "heatmap" (translucent circles per point) with a real
-- density surface: a quadratic-decay Gaussian kernel evaluated on a fixed grid.
--
--   density(cell) = SUM_i exp(-0.5 * (d_i / h)^2) / (2*pi*h^2)
--
-- where d_i is the metric distance from the cell centre to incident i and h is
-- the bandwidth. Distances are computed in EPSG:32651 (UTM 51N), which covers
-- Butuan; within a single city the planar approximation is accurate to well
-- under a metre, and it is far cheaper than spheroid distance per cell/point pair.
--
-- Output is one row per grid cell that has any incident within 3h (cells beyond
-- that contribute effectively zero), with bounds in EPSG:4326 so Leaflet can draw
-- them directly. `density` is incidents per square kilometre; `weight` is that
-- value scaled 0..1 against the surface maximum, for colour ramping.
--
-- The grid is aligned to global multiples of cell_m, so the same cells come back
-- for the same cell_m regardless of which incidents are in the filter — the
-- surface stays comparable between queries.

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
  with params as (
    select
      least(greatest(bandwidth_m, 25), 5000)  as h,
      least(greatest(cell_m, 25), 2000)       as c,
      least(greatest(bandwidth_m, 25), 5000) * 3 as reach
  ),
  pts as (
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
  ),
  ext as (
    select st_xmin(e) as xmin, st_ymin(e) as ymin,
           st_xmax(e) as xmax, st_ymax(e) as ymax
    from (select st_extent(g)::geometry as e from pts) q
  ),
  -- Grid cell centres covering the incident extent plus one kernel reach of margin.
  cells as (
    select (gi + 0.5) * p.c as cx, (gj + 0.5) * p.c as cy
    from params p, ext e,
      lateral generate_series(
        floor((e.xmin - p.reach) / p.c)::bigint,
        ceil ((e.xmax + p.reach) / p.c)::bigint) gi,
      lateral generate_series(
        floor((e.ymin - p.reach) / p.c)::bigint,
        ceil ((e.ymax + p.reach) / p.c)::bigint) gj
  ),
  raw as (
    select c.cx, c.cy,
           sum(exp(-0.5 * power(
             st_distance(pt.g, st_setsrid(st_makepoint(c.cx, c.cy), 32651)) / p.h, 2))) as k
    from cells c
    cross join params p
    join pts pt
      on st_dwithin(pt.g, st_setsrid(st_makepoint(c.cx, c.cy), 32651), p.reach)
    group by c.cx, c.cy
  ),
  -- Normalise the kernel and convert from per-m^2 to per-km^2.
  scored as (
    select r.cx, r.cy, r.k / (2 * pi() * p.h * p.h) * 1e6 as density
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
