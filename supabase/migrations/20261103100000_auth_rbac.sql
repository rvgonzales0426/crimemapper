-- Migration: authentication profiles + page-based role access (RBAC).
--
-- Model (after Vincare's): a role is a list of the app's route paths it may
-- open (roles.pages). Admins toggle pages per role; the sidebar and router
-- guard read the signed-in user's pages; anything else fails closed.
--
-- Hardened where Vincare was weak:
--   * The role lives in public.profiles, which users cannot change themselves
--     (column-level grants), never in user-editable auth user_metadata.
--   * User management runs through a security-definer RPC that checks the
--     caller is an admin. No service-role key in the browser.
--   * RLS enforces the same rules server-side; incident data is no longer
--     readable by anon, only by signed-in users who have an active role.
--
-- New sign-ups get a profile with role_id = null ("awaiting approval") and no
-- access until an admin assigns a role. Bootstrap the first admin with
-- `bun scripts/create-user.js` (service key, server-side only).

-- =========================================================
-- 1. Tables
-- =========================================================
create table if not exists public.roles (
  id          text primary key check (id ~ '^[a-z][a-z0-9_-]{1,31}$'),
  name        text not null check (length(trim(name)) > 0),
  description text,
  -- Route paths this role may open. Keep in sync with src/lib/pages.js.
  pages       text[] not null default '{}'
              check (pages <@ array['/', '/incidents', '/hotspot-map', '/investigations', '/admin']),
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

insert into public.roles (id, name, description, pages, is_system) values
  ('admin', 'Administrator', 'Full access, including user and role management.',
   array['/', '/incidents', '/hotspot-map', '/investigations', '/admin'], true),
  ('investigator', 'Investigator', 'Analysis tools plus case management.',
   array['/', '/incidents', '/hotspot-map', '/investigations'], true),
  ('analyst', 'Crime Analyst', 'Dashboard, incident records and maps.',
   array['/', '/incidents', '/hotspot-map'], false),
  ('officer', 'Patrol Officer', 'Dashboard and hotspot / patrol map.',
   array['/', '/hotspot-map'], false)
on conflict (id) do nothing;

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text,
  rank       text,
  badge_no   text,
  role_id    text references public.roles (id) on update cascade, -- null = awaiting approval
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_id_idx on public.profiles (role_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- =========================================================
-- 2. Profile per auth user (created on sign-up, email kept in sync)
-- =========================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- full_name is display-only; the role is never taken from user metadata.
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email on auth.users;
create trigger on_auth_user_email
  after update of email on auth.users
  for each row execute function public.handle_user_email();

-- Users that signed up before this migration.
insert into public.profiles (id, email, full_name)
select u.id, u.email, nullif(trim(u.raw_user_meta_data ->> 'full_name'), '')
from auth.users u
on conflict (id) do nothing;

-- =========================================================
-- 3. Access helpers (used by RLS policies and the app)
-- =========================================================
-- Pages the caller may open: their role's pages if the profile is active,
-- otherwise none. security definer so policies can read profiles/roles.
create or replace function public.my_pages()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select r.pages
     from public.profiles p
     join public.roles r on r.id = p.role_id
     where p.id = auth.uid() and p.active),
    '{}'::text[]);
$$;

create or replace function public.can_access(p_page text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_page = any (public.my_pages());
$$;

create or replace function public.has_app_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select cardinality(public.my_pages()) > 0;
$$;

-- Admin = may open the Admin page.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_access('/admin');
$$;

-- True while at least one active user holds a role with the Admin page.
create or replace function public.admin_exists()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.active and '/admin' = any (r.pages));
$$;

-- =========================================================
-- 4. Role protection
-- =========================================================
-- System roles keep their id and can't be deleted; the admin role is locked
-- entirely (it always has every page). Clients can't mint system roles.
create or replace function public.protect_roles()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.is_system := false;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'System role "%" cannot be deleted', old.name using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE
  new.is_system := old.is_system;
  if old.is_system and new.id <> old.id then
    raise exception 'System role ids cannot be changed' using errcode = '42501';
  end if;
  if old.id = 'admin' and new.pages is distinct from old.pages then
    raise exception 'The Administrator role always has every page' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists roles_protect on public.roles;
create trigger roles_protect
  before insert or update or delete on public.roles
  for each row execute function public.protect_roles();

-- Never let a role edit leave the system without an active administrator.
create or replace function public.ensure_admin_exists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.admin_exists() and exists (select 1 from public.profiles where role_id is not null) then
    raise exception 'At least one active administrator is required' using errcode = '42501';
  end if;
  return null;
end;
$$;

drop trigger if exists roles_keep_admin on public.roles;
create trigger roles_keep_admin
  after update or delete on public.roles
  for each statement execute function public.ensure_admin_exists();

-- =========================================================
-- 5. User management (admins only)
-- =========================================================
create or replace function public.admin_update_user(
  p_user      uuid,
  p_role      text,
  p_active    boolean,
  p_full_name text default null,
  p_rank      text default null,
  p_badge_no  text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can manage users' using errcode = '42501';
  end if;

  update public.profiles
  set role_id   = p_role,
      active    = p_active,
      full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
      rank      = coalesce(nullif(trim(p_rank), ''), rank),
      badge_no  = coalesce(nullif(trim(p_badge_no), ''), badge_no)
  where id = p_user;

  if not found then
    raise exception 'User not found';
  end if;

  if not public.admin_exists() then
    raise exception 'At least one active administrator is required' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.admin_update_user(uuid, text, boolean, text, text, text) from public, anon;
grant execute on function public.admin_update_user(uuid, text, boolean, text, text, text) to authenticated;

-- =========================================================
-- 6. Row Level Security
-- =========================================================
alter table public.roles enable row level security;
alter table public.profiles enable row level security;

revoke all on public.roles, public.profiles from anon;

drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles
  for select to authenticated using (true);

drop policy if exists roles_admin_insert on public.roles;
create policy roles_admin_insert on public.roles
  for insert to authenticated with check ((select public.is_admin()));

drop policy if exists roles_admin_update on public.roles;
create policy roles_admin_update on public.roles
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists roles_admin_delete on public.roles;
create policy roles_admin_delete on public.roles
  for delete to authenticated using ((select public.is_admin()));

-- Everyone with access can see colleagues (names for case leads, notes);
-- a pending user can only see their own row.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.has_app_access()));

-- Users may edit their own name/rank/badge, never role_id or active.
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, rank, badge_no) on public.profiles to authenticated;

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Incidents: signed-in users with an active role only (was anon + authenticated).
drop policy if exists "incidents_read" on public.incidents;
create policy "incidents_read" on public.incidents
  for select to authenticated
  using ((select public.has_app_access()));

-- The analysis RPCs run as the caller, so RLS above already empties them for
-- anon; revoke anyway so anon gets a clear permission error.
revoke execute on function public.incidents_kde from public, anon;
revoke execute on function public.incidents_kde_grid from public, anon;
revoke execute on function public.incidents_dashboard from public, anon;
revoke execute on function public.incidents_analysis_points from public, anon;
revoke execute on function public.incidents_patrol_zones from public, anon;
grant execute on function public.incidents_kde, public.incidents_kde_grid, public.incidents_dashboard,
  public.incidents_analysis_points, public.incidents_patrol_zones to authenticated;

-- Data maintenance is for ingest.js (service_role) only.
revoke execute on function public.refresh_coord_flags from public, anon, authenticated;
grant execute on function public.refresh_coord_flags to service_role;

notify pgrst, 'reload schema';
