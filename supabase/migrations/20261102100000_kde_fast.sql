-- Migration: make incidents_kde() fast enough for the anon statement timeout.
--
-- The original built a grid over the whole incident extent (~24k cells at 150 m
-- for Butuan) and joined every cell to every point with ST_DWithin on transformed,
-- unindexed geometries — ~37M distance checks for the full dataset, which hits
-- Supabase's anon/authenticated statement_timeout.
--
-- This version inverts the loop: each point only reaches cells within 3h, so it
-- enumerates exactly those cells (about (6h/c)^2 per point) and computes the
-- kernel with plain arithmetic on UTM coordinates. Same grid alignment, same
-- kernel, same filters, same output columns — only the evaluation strategy
-- changes. incidents_kde_grid() wraps this and needs no change.
--
-- One added guard: cell_m is floored at bandwidth/20, capping the per-point
-- neighbourhood at ~120x120 cells so an extreme bandwidth/cell combination can't
-- explode the row count. Has no effect at the app defaults (400 m / 150 m).

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
  pts as (
    select st_x(g) as x, st_y(g) as y
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
  ),
  -- Offsets from each point to the centres of the grid cells around it.
  -- Cell (gi, gj) has centre ((gi + 0.5) * c, (gj + 0.5) * c), as before.
  contrib as (
    select gi, gj,
           (gi + 0.5) * p.c - pt.x as dx,
           (gj + 0.5) * p.c - pt.y as dy
    from pts pt
    cross join params p,
      lateral generate_series(
        floor((pt.x - p.reach) / p.c)::bigint - 1,
        ceil ((pt.x + p.reach) / p.c)::bigint) gi,
      lateral generate_series(
        floor((pt.y - p.reach) / p.c)::bigint - 1,
        ceil ((pt.y + p.reach) / p.c)::bigint) gj
  ),
  raw as (
    select gi, gj, sum(exp(-0.5 * (dx * dx + dy * dy) / (p.h * p.h))) as k
    from contrib
    cross join params p
    where dx * dx + dy * dy <= p.reach * p.reach
    group by gi, gj
  ),
  -- Normalise the kernel and convert from per-m^2 to per-km^2.
  scored as (
    select (r.gi + 0.5) * p.c as cx, (r.gj + 0.5) * p.c as cy,
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

notify pgrst, 'reload schema';
