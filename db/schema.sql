-- =============================================================================
-- Restaurant Management System — Database Schema
-- Target: Supabase (PostgreSQL 15+)
-- Apply before db/seed.sql
-- =============================================================================

-- ENUMS -----------------------------------------------------------------------
create type table_status       as enum ('available', 'occupied', 'dirty');
create type order_status       as enum ('open', 'paid', 'cancelled');
create type reservation_status as enum ('booked', 'seated', 'cancelled', 'no_show');

-- TABLES (physical restaurant tables) -----------------------------------------
create table tables (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,                  -- e.g. 'T1', 'Patio 3'
  capacity   int  not null check (capacity > 0),
  status     table_status not null default 'available',
  created_at timestamptz not null default now()
);

-- RESERVATIONS -----------------------------------------------------------------
create table reservations (
  id            uuid primary key default gen_random_uuid(),
  table_id      uuid not null references tables(id) on delete cascade,
  customer_name text not null,
  party_size    int  not null check (party_size > 0),
  reserved_at   timestamptz not null,               -- date + time combined
  status        reservation_status not null default 'booked',
  notes         text,
  created_at    timestamptz not null default now()
);
create index idx_reservations_table_id    on reservations(table_id);
create index idx_reservations_reserved_at on reservations(reserved_at);

-- MENU ---------------------------------------------------------------------------
create table categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order int  not null default 0
);

create table menu_items (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references categories(id) on delete restrict,
  name         text not null,
  price        numeric(10,2) not null check (price >= 0),
  is_available boolean not null default true,
  sort_order   int not null default 0
);
create index idx_menu_items_category_id on menu_items(category_id);

-- ORDERS ----------------------------------------------------------------------
create table orders (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid not null references tables(id) on delete restrict,
  status     order_status not null default 'open',
  tax_rate   numeric(5,4)  not null default 0.0800, -- snapshotted per order
  subtotal   numeric(10,2) not null default 0,
  tax        numeric(10,2) not null default 0,
  total      numeric(10,2) not null default 0,
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz
);
create index idx_orders_table_id on orders(table_id);
-- POS invariant: at most ONE open order per table
create unique index uniq_open_order_per_table
  on orders(table_id) where (status = 'open');

create table order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id) on delete restrict,
  quantity     int  not null check (quantity > 0),
  unit_price   numeric(10,2) not null,              -- price snapshot at order time
  created_at   timestamptz not null default now()
);
create index idx_order_items_order_id on order_items(order_id);

-- RLS (deferred to Phase 2 — uncomment when wiring Supabase; v1 runs as a
-- single shared tablet identity, so policies are intentionally permissive):
--
-- alter table tables        enable row level security;
-- alter table reservations  enable row level security;
-- alter table categories    enable row level security;
-- alter table menu_items    enable row level security;
-- alter table orders        enable row level security;
-- alter table order_items   enable row level security;
--
-- create policy "allow all" on tables        for all using (true) with check (true);
-- create policy "allow all" on reservations  for all using (true) with check (true);
-- create policy "allow all" on categories    for all using (true) with check (true);
-- create policy "allow all" on menu_items    for all using (true) with check (true);
-- create policy "allow all" on orders        for all using (true) with check (true);
-- create policy "allow all" on order_items   for all using (true) with check (true);
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
-- Take-away orders: orders can now exist without a table. Dine-in keeps the
-- one-open-order-per-table invariant (the partial unique index ignores rows
-- with null table_id); take-away orders are keyed by customer name instead.

create type order_type as enum ('dine_in', 'takeaway');

alter table orders
  add column order_type order_type not null default 'dine_in',
  add column customer_name text,
  alter column table_id drop not null;

alter table orders add constraint orders_target_check check (
  (order_type = 'dine_in' and table_id is not null)
  or (order_type = 'takeaway' and customer_name is not null)
);

create index idx_orders_open_takeaway
  on orders(customer_name) where (status = 'open' and order_type = 'takeaway');
