-- Staff, roles & permissions -------------------------------------------------
-- Roles carry a free-form permission set (text[]) so admins can define custom
-- roles in the app. Known permission keys live in src/lib/auth/permissions.ts.

create extension if not exists pgcrypto;

create table roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  permissions text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table app_users (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  role_id    uuid not null references roles(id) on delete restrict,
  pin_hash   text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_app_users_role_id on app_users(role_id);

-- Keep PIN hashes out of the REST API: column-level select grant omits pin_hash.
revoke select on app_users from anon, authenticated;
grant select (id, name, role_id, is_active, created_at) on app_users
  to anon, authenticated;

-- PINs are verified and written server-side only (bcrypt via pgcrypto).
create or replace function verify_user_pin(p_user_id uuid, p_pin text)
returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select exists (
    select 1 from app_users
    where id = p_user_id
      and is_active
      and pin_hash = crypt(p_pin, pin_hash)
  );
$$;

create or replace function create_app_user(p_name text, p_role_id uuid, p_pin text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  if p_pin !~ '^\d{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;
  insert into app_users (name, role_id, pin_hash)
  values (p_name, p_role_id, crypt(p_pin, gen_salt('bf')))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function set_user_pin(p_user_id uuid, p_pin text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_pin !~ '^\d{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;
  update app_users
  set pin_hash = crypt(p_pin, gen_salt('bf'))
  where id = p_user_id;
end;
$$;
