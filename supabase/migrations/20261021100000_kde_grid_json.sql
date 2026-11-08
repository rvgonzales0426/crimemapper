-- Migration: return the KDE surface as a single JSON value.
--
-- PostgREST caps every response at db-max-rows (1000 on Supabase by default),
-- and that applies to set-returning RPCs too. incidents_kde() routinely yields
-- several thousand cells, so calling it directly silently drops the tail of the
-- surface. Paging it with Range would re-run the whole computation per page.
--
-- incidents_kde_grid() takes the same arguments and wraps the result in one
-- json array of {south, west, north, east, density, weight} — one row, no cap.

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
  min_weight     double precision default 0.04
)
returns json
language sql
stable
as $$
  select coalesce(json_agg(k), '[]'::json)
  from public.incidents_kde(
    bandwidth_m, cell_m, p_date_from, p_date_to, p_barangay, p_offense,
    p_case_status, p_search, include_flagged, min_weight
  ) k;
$$;
