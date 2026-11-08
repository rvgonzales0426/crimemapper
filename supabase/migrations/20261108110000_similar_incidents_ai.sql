-- Migration: narrative embeddings (similar incidents) + AI request audit.
--
-- 1. incidents.embedding becomes vector(384) for Supabase's built-in gte-small
--    model (runs inside Edge Functions: free, and the text never leaves
--    Supabase). The column was never populated, so nothing is lost. Filled by
--    the embed-incidents Edge Function (scripts/embed-incidents.js drives it).
-- 2. similar_incidents(incident) / match_incidents(embedding): nearest
--    narratives by cosine distance, one row per blotter, run as the caller (RLS).
-- 3. ai_requests: every case-assistant call (who, question, answer, tools used,
--    tokens), written by the Edge Function; readable by admins only.
-- Requires 20261103100000_auth_rbac.sql.

alter table public.incidents alter column embedding type vector(384) using null;

create index if not exists incidents_embedding_hnsw
  on public.incidents using hnsw (embedding vector_cosine_ops);

-- Nearest incidents to an embedding, one per blotter. Shared by the two RPCs.
create or replace function public.match_incidents(
  p_embedding        vector(384),
  p_limit            int  default 10,
  p_category         text default null,   -- 'crime' | 'traffic' | null
  p_exclude_blotter  text default null,
  p_min_similarity   real default 0.5
)
returns json
language sql
stable
set statement_timeout = '15s'
as $$
  with near as (
    select i.id, i.blotterno, i.date_committed, i.offense, i.incident_type, i.barangay, i.case_status,
           i.modus, i.lat, i.lng, i.coord_flag,
           1 - (i.embedding <=> p_embedding) as similarity
    from public.incidents i
    where i.embedding is not null
      and (p_exclude_blotter is null or i.blotterno is distinct from p_exclude_blotter)
      and (p_category is null
           or (p_category = 'traffic' and coalesce(i.incident_type ilike '%vehicular accident%', false))
           or (p_category = 'crime' and not coalesce(i.incident_type ilike '%vehicular accident%', false)))
    order by i.embedding <=> p_embedding
    limit greatest(p_limit, 1) * 4
  ),
  one_per_blotter as (
    select distinct on (coalesce(blotterno, id::text)) *
    from near
    order by coalesce(blotterno, id::text), similarity desc
  )
  select coalesce(json_agg(to_json(o) order by o.similarity desc), '[]')
  from (select * from one_per_blotter
        where similarity >= p_min_similarity
        order by similarity desc
        limit greatest(p_limit, 1)) o;
$$;

-- Incidents whose narrative reads like this one (same crime/traffic category).
create or replace function public.similar_incidents(p_incident uuid, p_limit int default 8)
returns json
language sql
stable
set statement_timeout = '15s'
as $$
  select case when i.embedding is null then '[]'::json
    else public.match_incidents(
      i.embedding, p_limit,
      case when coalesce(i.incident_type ilike '%vehicular accident%', false) then 'traffic' else 'crime' end,
      i.blotterno)
    end
  from public.incidents i
  where i.id = p_incident;
$$;

revoke execute on function public.match_incidents(vector, int, text, text, real) from public, anon;
revoke execute on function public.similar_incidents(uuid, int) from public, anon;
grant execute on function public.match_incidents(vector, int, text, text, real),
  public.similar_incidents(uuid, int) to authenticated;

-- =========================================================
-- AI request audit
-- =========================================================
create table if not exists public.ai_requests (
  id                bigint generated always as identity primary key,
  actor_id          uuid references public.profiles (id) on delete set null,
  investigation_id  bigint references public.investigations (id) on delete set null,
  question          text not null,
  answer            text,
  tools             jsonb not null default '[]',  -- [{name, args}]
  model             text,
  prompt_tokens     int,
  completion_tokens int,
  error             text,
  created_at        timestamptz not null default now()
);

create index if not exists ai_requests_created_idx on public.ai_requests (created_at desc);

alter table public.ai_requests enable row level security;
revoke all on public.ai_requests from anon;
revoke insert, update, delete on public.ai_requests from authenticated;

drop policy if exists ai_requests_read on public.ai_requests;
create policy ai_requests_read on public.ai_requests
  for select to authenticated using ((select public.is_admin()));

notify pgrst, 'reload schema';
