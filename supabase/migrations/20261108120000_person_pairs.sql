-- Migration: precomputed similar-name pairs for the persons match queue.
--
-- person_match_candidates() compared every person with every other inside the
-- request (a trigram self-join: ~4M comparisons for 2,816 people), which hit
-- the 15 s statement timeout for the global queue. scripts/build-persons.js now
-- computes the pairs once per build (same trigram similarity as pg_trgm,
-- similarity >= 0.45, compatible sex) into person_pairs; the RPC only reads
-- those and adds the evidence. Merges drop the merged record's pairs (FK
-- cascade); a split-off record gets its pairs on the next build.
-- Requires 20261108100000_persons_index.sql.

create table if not exists public.person_pairs (
  person_a   bigint not null references public.persons (id) on delete cascade,
  person_b   bigint not null references public.persons (id) on delete cascade,
  similarity real   not null,
  primary key (person_a, person_b),
  check (person_a < person_b)
);

create index if not exists person_pairs_b_idx on public.person_pairs (person_b);

alter table public.person_pairs enable row level security;
revoke all on public.person_pairs from anon;
revoke insert, update, delete on public.person_pairs from authenticated;

drop policy if exists person_pairs_read on public.person_pairs;
create policy person_pairs_read on public.person_pairs
  for select to authenticated using ((select public.can_access('/persons')));

create or replace function public.person_match_candidates(
  p_person               bigint default null,
  p_min_similarity       real   default 0.5,
  p_include_age_conflict boolean default false,
  p_limit                int    default 50
)
returns json
language sql
stable
set statement_timeout = '15s'
as $$
  with pairs as (
    select pp.person_a as a_id, pp.person_b as b_id, pp.similarity as sim
    from public.person_pairs pp
    join public.persons a on a.id = pp.person_a
    join public.persons b on b.id = pp.person_b
    where pp.similarity >= p_min_similarity
      and (p_person is null or p_person in (pp.person_a, pp.person_b))
      and (a.sex is null or b.sex is null or a.sex = b.sex)
      and not exists (select 1 from public.person_non_matches n
                      where n.person_a = pp.person_a and n.person_b = pp.person_b)
  ),
  involved as (
    select a_id as pid from pairs union select b_id from pairs
  ),
  -- Who each involved person is named alongside.
  assoc as (
    select distinct me.person_id as pid, o.person_id as other
    from public.incident_persons me
    join public.incident_persons o
      on o.incident_id = me.incident_id and o.person_id is not null and o.person_id <> me.person_id
    where me.person_id in (select pid from involved)
  ),
  stats as (
    select s.* from public.person_stats s where s.person_id in (select pid from involved)
  ),
  scored as (
    select pr.*, sa.birth_year_min as a_by_min, sa.birth_year_max as a_by_max,
           sb.birth_year_min as b_by_min, sb.birth_year_max as b_by_max,
           sa.blotters as a_blotters, sb.blotters as b_blotters,
           -- Years between the two estimated birth-year ranges (0 = overlap; null = unknown).
           greatest(0, greatest(sa.birth_year_min, sb.birth_year_min)
                       - least(sa.birth_year_max, sb.birth_year_max)) as age_gap,
           (select array_agg(x) from unnest(sa.barangays) x where x = any (sb.barangays)) as shared_barangays,
           (select count(*) from assoc x join assoc y on y.other = x.other
            where x.pid = pr.a_id and y.pid = pr.b_id and x.other not in (pr.a_id, pr.b_id)) as shared_associates
    from pairs pr
    join stats sa on sa.person_id = pr.a_id
    join stats sb on sb.person_id = pr.b_id
  ),
  ranked as (
    select s.*,
           s.sim
             + case when s.age_gap is null then 0 when s.age_gap <= 2 then 0.1 when s.age_gap > 5 then -0.3 else 0 end
             + case when s.shared_barangays is not null then 0.1 else 0 end
             + case when s.shared_associates > 0 then 0.15 else 0 end as score
    from scored s
    where p_include_age_conflict or s.age_gap is null or s.age_gap <= 5
  )
  select coalesce(json_agg(json_build_object(
           'a', json_build_object('id', pa.id, 'display_name', pa.display_name, 'suffix', pa.suffix, 'sex', pa.sex,
                                  'blotters', r.a_blotters, 'birth_year_min', r.a_by_min, 'birth_year_max', r.a_by_max),
           'b', json_build_object('id', pb.id, 'display_name', pb.display_name, 'suffix', pb.suffix, 'sex', pb.sex,
                                  'blotters', r.b_blotters, 'birth_year_min', r.b_by_min, 'birth_year_max', r.b_by_max),
           'similarity', round(r.sim::numeric, 2),
           'age_gap', r.age_gap,
           'shared_barangays', coalesce(r.shared_barangays, '{}'),
           'shared_associates', r.shared_associates,
           'score', round(r.score::numeric, 2))
         order by r.score desc, r.sim desc), '[]')
  from (select * from ranked order by score desc, sim desc limit least(greatest(p_limit, 1), 200)) r
  join public.persons pa on pa.id = r.a_id
  join public.persons pb on pb.id = r.b_id;
$$;

notify pgrst, 'reload schema';
