-- Migration: investigations (case tracking).
--
--   investigations          one case: auto case number (INV-YYYY-0001), title,
--                           summary, status, priority, lead investigator.
--   investigation_incidents incidents linked to a case (many-to-many).
--   investigation_notes     the case timeline: officers' notes ('note') plus
--                           an automatic audit trail ('event') of opening,
--                           status / priority / lead changes and incident
--                           links, written by triggers.
--
-- Access follows the RBAC pages: anyone whose role includes '/investigations'
-- can read and work cases. Deleting a case: its creator or an admin. Notes are
-- append-only; authors (or admins) may delete their own. Authorship columns
-- are always set server-side from auth.uid(), never trusted from the client.
-- Requires 20261103100000_auth_rbac.sql.

-- =========================================================
-- 1. Tables
-- =========================================================
create table if not exists public.investigations (
  id         bigint generated always as identity primary key,
  case_no    text unique,
  title      text not null check (length(trim(title)) > 0),
  summary    text,
  status     text not null default 'open'
             check (status in ('open', 'active', 'suspended', 'closed')),
  priority   text not null default 'medium'
             check (priority in ('low', 'medium', 'high', 'critical')),
  lead_id    uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at  timestamptz
);

create index if not exists investigations_status_idx on public.investigations (status);
create index if not exists investigations_updated_idx on public.investigations (updated_at desc);

create table if not exists public.investigation_incidents (
  investigation_id bigint not null references public.investigations (id) on delete cascade,
  incident_id      uuid not null references public.incidents (id) on delete cascade,
  added_by         uuid references public.profiles (id) on delete set null,
  added_at         timestamptz not null default now(),
  primary key (investigation_id, incident_id)
);

create index if not exists investigation_incidents_incident_idx
  on public.investigation_incidents (incident_id);

create table if not exists public.investigation_notes (
  id               bigint generated always as identity primary key,
  investigation_id bigint not null references public.investigations (id) on delete cascade,
  author_id        uuid references public.profiles (id) on delete set null,
  kind             text not null default 'note' check (kind in ('note', 'event')),
  body             text not null check (length(trim(body)) > 0),
  created_at       timestamptz not null default now()
);

create index if not exists investigation_notes_case_idx
  on public.investigation_notes (investigation_id, created_at);

-- =========================================================
-- 2. Server-set fields
-- =========================================================
create or replace function public.investigations_before_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- The identity id is assigned before BEFORE triggers run.
    new.case_no    := 'INV-' || to_char(now() at time zone 'Asia/Manila', 'YYYY')
                      || '-' || lpad(new.id::text, 4, '0');
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.case_no    := old.case_no;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.closed_at  := case
    when new.status <> 'closed' then null
    when tg_op = 'UPDATE' and old.status = 'closed' then old.closed_at
    else now()
  end;
  return new;
end;
$$;

drop trigger if exists investigations_before_write on public.investigations;
create trigger investigations_before_write
  before insert or update on public.investigations
  for each row execute function public.investigations_before_write();

create or replace function public.investigation_links_before_insert()
returns trigger
language plpgsql
as $$
begin
  new.added_by := auth.uid();
  new.added_at := now();
  return new;
end;
$$;

drop trigger if exists investigation_links_before_insert on public.investigation_incidents;
create trigger investigation_links_before_insert
  before insert on public.investigation_incidents
  for each row execute function public.investigation_links_before_insert();

create or replace function public.investigation_notes_before_insert()
returns trigger
language plpgsql
as $$
begin
  new.author_id  := auth.uid();
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists investigation_notes_before_insert on public.investigation_notes;
create trigger investigation_notes_before_insert
  before insert on public.investigation_notes
  for each row execute function public.investigation_notes_before_insert();

-- =========================================================
-- 3. Audit trail (kind = 'event'); security definer so clients can't forge events
-- =========================================================
create or replace function public.log_investigation_event(p_case bigint, p_body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.investigation_notes (investigation_id, kind, body)
  values (p_case, 'event', p_body);
$$;

revoke execute on function public.log_investigation_event(bigint, text) from public, anon, authenticated;

create or replace function public.profile_label(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select concat_ws(' ', nullif(rank, ''), coalesce(nullif(full_name, ''), email))
     from public.profiles where id = p_id),
    'nobody');
$$;

create or replace function public.investigations_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_investigation_event(new.id, 'Case opened');
    if new.lead_id is not null then
      perform public.log_investigation_event(new.id, 'Lead set to ' || public.profile_label(new.lead_id));
    end if;
    return null;
  end if;

  if new.status is distinct from old.status then
    perform public.log_investigation_event(new.id, 'Status changed from ' || old.status || ' to ' || new.status);
  end if;
  if new.priority is distinct from old.priority then
    perform public.log_investigation_event(new.id, 'Priority changed from ' || old.priority || ' to ' || new.priority);
  end if;
  if new.lead_id is distinct from old.lead_id then
    perform public.log_investigation_event(new.id,
      case when new.lead_id is null then 'Lead removed'
           else 'Lead set to ' || public.profile_label(new.lead_id) end);
  end if;
  if new.title is distinct from old.title then
    perform public.log_investigation_event(new.id, 'Title changed to "' || new.title || '"');
  end if;
  return null;
end;
$$;

drop trigger if exists investigations_audit on public.investigations;
create trigger investigations_audit
  after insert or update on public.investigations
  for each row execute function public.investigations_audit();

create or replace function public.investigation_links_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case     bigint;
  v_incident uuid;
  label      text;
begin
  if tg_op = 'INSERT' then
    v_case := new.investigation_id;
    v_incident := new.incident_id;
  else
    v_case := old.investigation_id;
    v_incident := old.incident_id;
  end if;

  -- Skip the log when the whole case is being deleted (cascade).
  if not exists (select 1 from public.investigations where id = v_case) then
    return null;
  end if;

  select coalesce(i.blotterno, 'incident') || coalesce(' (' || trim(split_part(i.offense, ' - ', 1)) || ')', '')
  into label
  from public.incidents i
  where i.id = v_incident;

  perform public.log_investigation_event(v_case,
    case when tg_op = 'INSERT' then 'Linked ' else 'Unlinked ' end || coalesce(label, 'incident'));
  update public.investigations set updated_at = now() where id = v_case;
  return null;
end;
$$;

drop trigger if exists investigation_links_audit on public.investigation_incidents;
create trigger investigation_links_audit
  after insert or delete on public.investigation_incidents
  for each row execute function public.investigation_links_audit();

-- A new note counts as case activity.
create or replace function public.investigation_notes_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'note' then
    update public.investigations set updated_at = now() where id = new.investigation_id;
  end if;
  return null;
end;
$$;

drop trigger if exists investigation_notes_touch on public.investigation_notes;
create trigger investigation_notes_touch
  after insert on public.investigation_notes
  for each row execute function public.investigation_notes_touch();

-- =========================================================
-- 4. Row Level Security
-- =========================================================
alter table public.investigations enable row level security;
alter table public.investigation_incidents enable row level security;
alter table public.investigation_notes enable row level security;

revoke all on public.investigations, public.investigation_incidents, public.investigation_notes from anon;
-- Notes and links are never edited in place.
revoke update on public.investigation_notes, public.investigation_incidents from authenticated;

drop policy if exists investigations_read on public.investigations;
create policy investigations_read on public.investigations
  for select to authenticated using ((select public.can_access('/investigations')));

drop policy if exists investigations_insert on public.investigations;
create policy investigations_insert on public.investigations
  for insert to authenticated with check ((select public.can_access('/investigations')));

drop policy if exists investigations_update on public.investigations;
create policy investigations_update on public.investigations
  for update to authenticated
  using ((select public.can_access('/investigations')))
  with check ((select public.can_access('/investigations')));

drop policy if exists investigations_delete on public.investigations;
create policy investigations_delete on public.investigations
  for delete to authenticated
  using ((select public.can_access('/investigations'))
         and (created_by = (select auth.uid()) or (select public.is_admin())));

drop policy if exists investigation_incidents_read on public.investigation_incidents;
create policy investigation_incidents_read on public.investigation_incidents
  for select to authenticated using ((select public.can_access('/investigations')));

drop policy if exists investigation_incidents_insert on public.investigation_incidents;
create policy investigation_incidents_insert on public.investigation_incidents
  for insert to authenticated with check ((select public.can_access('/investigations')));

drop policy if exists investigation_incidents_delete on public.investigation_incidents;
create policy investigation_incidents_delete on public.investigation_incidents
  for delete to authenticated using ((select public.can_access('/investigations')));

drop policy if exists investigation_notes_read on public.investigation_notes;
create policy investigation_notes_read on public.investigation_notes
  for select to authenticated using ((select public.can_access('/investigations')));

-- Clients may only add plain notes; events come from the audit triggers.
drop policy if exists investigation_notes_insert on public.investigation_notes;
create policy investigation_notes_insert on public.investigation_notes
  for insert to authenticated
  with check (kind = 'note' and (select public.can_access('/investigations')));

drop policy if exists investigation_notes_delete on public.investigation_notes;
create policy investigation_notes_delete on public.investigation_notes
  for delete to authenticated
  using (kind = 'note'
         and (select public.can_access('/investigations'))
         and (author_id = (select auth.uid()) or (select public.is_admin())));

notify pgrst, 'reload schema';
