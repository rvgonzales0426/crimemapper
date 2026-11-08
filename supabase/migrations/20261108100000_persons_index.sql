-- Migration: persons index (people named in blotters, linked across incidents).
--
-- incident_persons  one row per person mentioned in an incident's suspect_raw /
--                   victim_raw, parsed by scripts/build-persons.js (service
--                   key). Rows repeat per offense row of the same blotter, so
--                   every count below is over DISTINCT blotters.
-- persons           the same individual across blotters. The build script
--                   links mentions automatically only on an exact normalised
--                   name + suffix with compatible sex and birth year; fuzzy
--                   matches are only ever SUGGESTED (person_match_candidates)
--                   and an investigator decides.
-- person_non_matches pairs an investigator said are different people.
-- person_events     append-only audit: merges, splits, rejections, views.
--
-- This is a lead-generation index: being named as a suspect in a blotter is
-- not a finding of guilt. No scoring of people by demographics.
-- Access: new page '/persons' (admin + investigator by default). Clients can
-- only read; every change goes through the security-definer RPCs below, which
-- check can_access('/persons') and write the audit log.
-- Requires 20261103100000_auth_rbac.sql (and _investigations for case links).

create extension if not exists pg_trgm;

-- =========================================================
-- 1. New permissionable page
-- =========================================================
alter table public.roles drop constraint if exists roles_pages_check;
alter table public.roles add constraint roles_pages_check
  check (pages <@ array['/', '/incidents', '/hotspot-map', '/investigations', '/persons', '/admin']);

-- protect_roles locks the admin role's pages; lift it for this one update.
alter table public.roles disable trigger roles_protect;
update public.roles
set pages = pages || array['/persons']
where id in ('admin', 'investigator') and not ('/persons' = any (pages));
alter table public.roles enable trigger roles_protect;

-- =========================================================
-- 2. Tables
-- =========================================================
create table if not exists public.persons (
  id           bigint generated always as identity primary key,
  display_name text not null,
  name_norm    text not null,          -- upper-case, no punctuation, no suffix
  suffix       text,                   -- JR / SR / II / III …
  sex          char(1) check (sex in ('M', 'F')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists persons_name_trgm on public.persons using gin (name_norm gin_trgm_ops);
create index if not exists persons_name_norm on public.persons (name_norm);

create table if not exists public.incident_persons (
  id             bigint generated always as identity primary key,
  incident_id    uuid not null references public.incidents (id) on delete cascade,
  role           text not null check (role in ('suspect', 'victim')),
  position       int  not null,
  raw            text not null,        -- the person's chunk of the source text
  name           text,
  name_norm      text,
  suffix         text,
  alias          text,
  age            int,
  sex            char(1) check (sex in ('M', 'F')),
  status         text,
  nationality    text,
  occupation     text,
  placeholder    boolean not null default false, -- UNIDENTIFIED, JOHN DOE, …
  est_birth_year int,                  -- year committed - age
  source_hash    text not null,        -- md5 of the whole source column
  person_id      bigint references public.persons (id) on delete set null,
  link_source    text not null default 'auto' check (link_source in ('auto', 'confirmed', 'split')),
  unique (incident_id, role, position)
);

create index if not exists incident_persons_person_idx on public.incident_persons (person_id);
create index if not exists incident_persons_incident_idx on public.incident_persons (incident_id);

create table if not exists public.person_non_matches (
  person_a   bigint not null references public.persons (id) on delete cascade,
  person_b   bigint not null references public.persons (id) on delete cascade,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz not null default now(),
  primary key (person_a, person_b),
  check (person_a < person_b)
);

create table if not exists public.person_events (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null check (action in ('view', 'merge', 'split', 'not_same')),
  person_id  bigint,                   -- no FK: merged persons are deleted
  other_id   bigint,
  detail     text,
  created_at timestamptz not null default now()
);

create index if not exists person_events_person_idx on public.person_events (person_id, created_at desc);

drop trigger if exists persons_updated_at on public.persons;
create trigger persons_updated_at
  before update on public.persons
  for each row execute function public.set_updated_at();

-- =========================================================
-- 3. Row Level Security: read-only for /persons users
-- =========================================================
alter table public.persons enable row level security;
alter table public.incident_persons enable row level security;
alter table public.person_non_matches enable row level security;
alter table public.person_events enable row level security;

revoke all on public.persons, public.incident_persons, public.person_non_matches, public.person_events from anon;
revoke insert, update, delete on public.persons, public.incident_persons, public.person_non_matches, public.person_events
  from authenticated;

drop policy if exists persons_read on public.persons;
create policy persons_read on public.persons
  for select to authenticated using ((select public.can_access('/persons')));

drop policy if exists incident_persons_read on public.incident_persons;
create policy incident_persons_read on public.incident_persons
  for select to authenticated using ((select public.can_access('/persons')));

drop policy if exists person_non_matches_read on public.person_non_matches;
create policy person_non_matches_read on public.person_non_matches
  for select to authenticated using ((select public.can_access('/persons')));

-- The audit log is for administrators.
drop policy if exists person_events_read on public.person_events;
create policy person_events_read on public.person_events
  for select to authenticated using ((select public.is_admin()));

-- =========================================================
-- 4. Read RPCs (run as the caller, so RLS applies)
-- =========================================================
-- Same normalisation as scripts/lib/persons.js normalizeName (minus suffix split).
create or replace function public.person_name_norm(p text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
           regexp_replace(translate(upper(coalesce(p, '')), 'ÑÁÀÂÉÈÊÍÌÎÓÒÔÚÙÛÜ', 'NAAAEEEIIIOOOUUUU'),
                          '[^A-Z0-9 ]+', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;

-- Per-person rollup over distinct blotters.
create or replace view public.person_stats
with (security_invoker = true) as
select
  ip.person_id,
  count(distinct coalesce(i.blotterno, i.id::text)) filter (where ip.role = 'suspect') as as_suspect,
  count(distinct coalesce(i.blotterno, i.id::text)) filter (where ip.role = 'victim')  as as_victim,
  count(distinct coalesce(i.blotterno, i.id::text))                                    as blotters,
  max(i.date_committed)                                                                as last_date,
  min(ip.est_birth_year)                                                               as birth_year_min,
  max(ip.est_birth_year)                                                               as birth_year_max,
  array_remove(array_agg(distinct ip.alias), null)                                     as aliases,
  array_remove(array_agg(distinct i.barangay), null)                                   as barangays,
  (array_agg(ip.status order by i.date_committed desc nulls last)
     filter (where ip.role = 'suspect'))[1]                                            as last_suspect_status
from public.incident_persons ip
join public.incidents i on i.id = ip.incident_id
where ip.person_id is not null
group by ip.person_id;

create or replace function public.persons_search(
  p_query         text default null,
  p_role          text default null,   -- 'suspect' | 'victim' | null
  p_min_blotters  int  default 1,
  p_limit         int  default 100
)
returns json
language sql
stable
set statement_timeout = '15s'
as $$
  with q as (select nullif(public.person_name_norm(p_query), '') as v),
  hits as (
    select p.id, p.display_name, p.suffix, p.sex, s.as_suspect, s.as_victim, s.blotters, s.last_date,
           s.birth_year_min, s.birth_year_max, s.aliases, s.barangays, s.last_suspect_status,
           case when q.v is null then null
                else greatest(similarity(p.name_norm, q.v), word_similarity(q.v, p.name_norm)) end as score
    from public.persons p
    join public.person_stats s on s.person_id = p.id
    cross join q
    where s.blotters >= p_min_blotters
      and (p_role is null
           or (p_role = 'suspect' and s.as_suspect > 0)
           or (p_role = 'victim' and s.as_victim > 0))
      and (q.v is null
           or p.name_norm % q.v
           or q.v <% p.name_norm
           or p.name_norm like '%' || q.v || '%'
           or exists (select 1 from unnest(s.aliases) a where public.person_name_norm(a) like '%' || q.v || '%'))
  ),
  ranked as (
    select h.*, row_number() over (
      order by h.score desc nulls last, h.blotters desc, h.last_date desc nulls last, h.id) as rn
    from hits h
  )
  select coalesce(json_agg(to_json(r) order by r.rn), '[]')
  from (select * from ranked where rn <= least(greatest(p_limit, 1), 500)) r;
$$;

create or replace function public.person_detail(p_id bigint)
returns json
language sql
stable
set statement_timeout = '15s'
as $$
  select json_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'suffix', p.suffix,
    'sex', p.sex,
    'created_at', p.created_at,
    'stats', (select to_json(s) from public.person_stats s where s.person_id = p.id),
    'mentions', (
      select coalesce(json_agg(json_build_object(
               'mention_id', ip.id, 'incident_id', i.id, 'blotterno', i.blotterno, 'role', ip.role,
               'name', ip.name, 'alias', ip.alias, 'age', ip.age, 'est_birth_year', ip.est_birth_year,
               'status', ip.status, 'occupation', ip.occupation, 'link_source', ip.link_source,
               'date_committed', i.date_committed, 'time_committed', i.time_committed,
               'offense', i.offense, 'incident_type', i.incident_type, 'barangay', i.barangay,
               'case_status', i.case_status, 'lat', i.lat, 'lng', i.lng, 'coord_flag', i.coord_flag)
             order by i.date_committed desc nulls last, i.blotterno, i.offense), '[]')
      from public.incident_persons ip
      join public.incidents i on i.id = ip.incident_id
      where ip.person_id = p.id),
    -- People named in the same blotters (co-suspects, victims, complainants).
    'associates', (
      select coalesce(json_agg(json_build_object(
               'id', a.id, 'display_name', a.display_name, 'roles', a.roles, 'shared', a.shared)
             order by a.shared desc, a.display_name), '[]')
      from (
        select p2.id, p2.display_name,
               array_agg(distinct o.role) as roles,
               count(distinct coalesce(i.blotterno, i.id::text)) as shared
        from public.incident_persons me
        join public.incidents i on i.id = me.incident_id
        join public.incident_persons o
          on o.incident_id = me.incident_id and o.person_id is not null and o.person_id <> me.person_id
        join public.persons p2 on p2.id = o.person_id
        where me.person_id = p.id
        group by p2.id, p2.display_name
        order by shared desc, p2.display_name
        limit 30) a),
    -- Cases these incidents are linked to (empty without /investigations access, via RLS).
    'investigations', (
      select coalesce(json_agg(json_build_object(
               'id', v.id, 'case_no', v.case_no, 'title', v.title, 'status', v.status) order by v.updated_at desc), '[]')
      from public.investigations v
      where v.id in (
        select ii.investigation_id
        from public.investigation_incidents ii
        join public.incident_persons ip on ip.incident_id = ii.incident_id
        where ip.person_id = p.id))
  )
  from public.persons p
  where p.id = p_id;
$$;

-- Suggested "possibly the same person" pairs, with the evidence for each.
-- Never merges anything itself.
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
    select a.id as a_id, b.id as b_id, similarity(a.name_norm, b.name_norm) as sim
    from public.persons a
    join public.persons b
      on a.id < b.id
     and a.name_norm % b.name_norm
     and (a.sex is null or b.sex is null or a.sex = b.sex)
    where (p_person is null or a.id = p_person or b.id = p_person)
      and not exists (select 1 from public.person_non_matches n where n.person_a = a.id and n.person_b = b.id)
  ),
  scored as (
    select pr.*, sa.birth_year_min as a_by_min, sa.birth_year_max as a_by_max,
           sb.birth_year_min as b_by_min, sb.birth_year_max as b_by_max,
           sa.blotters as a_blotters, sb.blotters as b_blotters,
           -- Years between the two estimated birth-year ranges (0 = overlap; null = unknown).
           greatest(0, greatest(sa.birth_year_min, sb.birth_year_min)
                       - least(sa.birth_year_max, sb.birth_year_max)) as age_gap,
           (select array_agg(x) from unnest(sa.barangays) x where x = any (sb.barangays)) as shared_barangays,
           (select count(distinct o1.person_id)
            from public.incident_persons m1
            join public.incident_persons o1 on o1.incident_id = m1.incident_id and o1.person_id not in (pr.a_id, pr.b_id)
            where m1.person_id = pr.a_id
              and o1.person_id in (
                select o2.person_id
                from public.incident_persons m2
                join public.incident_persons o2 on o2.incident_id = m2.incident_id
                where m2.person_id = pr.b_id)) as shared_associates
    from pairs pr
    join public.person_stats sa on sa.person_id = pr.a_id
    join public.person_stats sb on sb.person_id = pr.b_id
    where pr.sim >= p_min_similarity
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

-- =========================================================
-- 5. Write RPCs (security definer; check access; audit)
-- =========================================================
create or replace function public.require_persons_access()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_access('/persons') then
    raise exception 'Your role does not include the Persons index' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.log_person_view(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_persons_access();
  insert into public.person_events (actor_id, action, person_id) values (auth.uid(), 'view', p_id);
end;
$$;

-- Investigator confirms two records are the same individual: p_merge's
-- mentions move to p_keep (marked confirmed) and p_merge is removed.
create or replace function public.merge_persons(p_keep bigint, p_merge bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.persons;
  m public.persons;
begin
  perform public.require_persons_access();
  if p_keep = p_merge then
    raise exception 'Pick two different people';
  end if;
  select * into k from public.persons where id = p_keep for update;
  select * into m from public.persons where id = p_merge for update;
  if k.id is null or m.id is null then
    raise exception 'Person not found';
  end if;
  if k.sex is not null and m.sex is not null and k.sex <> m.sex then
    raise exception 'These records have different sex; they cannot be merged';
  end if;

  update public.incident_persons set person_id = p_keep, link_source = 'confirmed' where person_id = p_merge;
  update public.incident_persons set link_source = 'confirmed' where person_id = p_keep;
  -- Carry over "not the same as X" decisions, then drop the merged record.
  insert into public.person_non_matches (person_a, person_b, decided_by, decided_at)
  select least(p_keep, other), greatest(p_keep, other), n.decided_by, n.decided_at
  from (select case when person_a = p_merge then person_b else person_a end as other, decided_by, decided_at
        from public.person_non_matches where p_merge in (person_a, person_b)) n
  where n.other <> p_keep
  on conflict do nothing;
  update public.persons set sex = coalesce(k.sex, m.sex) where id = p_keep;
  delete from public.persons where id = p_merge;

  insert into public.person_events (actor_id, action, person_id, other_id, detail)
  values (auth.uid(), 'merge', p_keep, p_merge, m.display_name || ' merged into ' || k.display_name);
end;
$$;

-- Undo a wrong grouping: this mention (and the same person on the blotter's
-- other offense rows) becomes a separate person. Returns the new person id.
create or replace function public.split_person_mention(p_mention bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  mt     public.incident_persons;
  blot   text;
  new_id bigint;
begin
  perform public.require_persons_access();
  select * into mt from public.incident_persons where id = p_mention;
  if mt.id is null or mt.person_id is null then
    raise exception 'Mention not found';
  end if;
  select coalesce(blotterno, id::text) into blot from public.incidents where id = mt.incident_id;

  insert into public.persons (display_name, name_norm, suffix, sex)
  values (coalesce(mt.name, mt.raw), coalesce(mt.name_norm, ''), mt.suffix, mt.sex)
  returning id into new_id;

  update public.incident_persons ip
  set person_id = new_id, link_source = 'split'
  from public.incidents i
  where i.id = ip.incident_id
    and coalesce(i.blotterno, i.id::text) = blot
    and ip.person_id = mt.person_id
    and ip.role = mt.role
    and ip.name_norm is not distinct from mt.name_norm;

  -- The split-off record and the original are known to be different people.
  insert into public.person_non_matches (person_a, person_b, decided_by)
  values (least(new_id, mt.person_id), greatest(new_id, mt.person_id), auth.uid())
  on conflict do nothing;

  -- Remove the original if nothing is left on it.
  delete from public.persons p
  where p.id = mt.person_id and not exists (select 1 from public.incident_persons where person_id = p.id);

  insert into public.person_events (actor_id, action, person_id, other_id, detail)
  values (auth.uid(), 'split', new_id, mt.person_id, 'Blotter ' || blot || ' split off');
  return new_id;
end;
$$;

-- Investigator says a suggested pair are different people.
create or replace function public.mark_persons_not_same(p_a bigint, p_b bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_persons_access();
  if p_a = p_b then
    raise exception 'Pick two different people';
  end if;
  insert into public.person_non_matches (person_a, person_b, decided_by)
  values (least(p_a, p_b), greatest(p_a, p_b), auth.uid())
  on conflict do nothing;
  insert into public.person_events (actor_id, action, person_id, other_id)
  values (auth.uid(), 'not_same', least(p_a, p_b), greatest(p_a, p_b));
end;
$$;

revoke execute on function public.require_persons_access() from public, anon;
revoke execute on function public.log_person_view(bigint) from public, anon;
revoke execute on function public.merge_persons(bigint, bigint) from public, anon;
revoke execute on function public.split_person_mention(bigint) from public, anon;
revoke execute on function public.mark_persons_not_same(bigint, bigint) from public, anon;
revoke execute on function public.persons_search(text, text, int, int) from public, anon;
revoke execute on function public.person_detail(bigint) from public, anon;
revoke execute on function public.person_match_candidates(bigint, real, boolean, int) from public, anon;
grant execute on function public.require_persons_access(), public.log_person_view(bigint),
  public.merge_persons(bigint, bigint), public.split_person_mention(bigint),
  public.mark_persons_not_same(bigint, bigint), public.persons_search(text, text, int, int),
  public.person_detail(bigint), public.person_match_candidates(bigint, real, boolean, int)
  to authenticated;
revoke all on public.person_stats from anon;

notify pgrst, 'reload schema';
