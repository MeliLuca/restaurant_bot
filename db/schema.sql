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
-- Table splits (sub-tables): a dine-in table can run several open orders at
-- once, one per split label (e.g. B2/1, B2/Gino). A null subtable is the
-- "whole table" tab. The open-order invariant becomes per (table, split).

alter table orders add column subtable text;

alter table orders add constraint orders_subtable_dine_in_check
  check (subtable is null or order_type = 'dine_in');

drop index uniq_open_order_per_table;
create unique index uniq_open_order_per_table_split
  on orders (table_id, coalesce(subtable, '')) where (status = 'open');
-- Menu & floor configuration: table feature tags, menu item ingredients, and
-- the "86 board" (mark an ingredient out of stock to pull every item using it).
-- New permission keys (src/lib/auth/permissions.ts): manage_menu, manage_floor,
-- manage_availability.

-- TABLE TAGS: features a table offers (TV screen, accessible, child friendly…)
create table table_tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table table_tag_links (
  table_id uuid not null references tables(id) on delete cascade,
  tag_id   uuid not null references table_tags(id) on delete cascade,
  primary key (table_id, tag_id)
);
create index idx_table_tag_links_tag_id on table_tag_links(tag_id);

-- INGREDIENTS: is_available = false means "out of stock tonight"; every menu
-- item containing that ingredient becomes unavailable in the POS.
create table ingredients (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  is_available boolean not null default true,
  created_at   timestamptz not null default now()
);

create table menu_item_ingredients (
  menu_item_id  uuid not null references menu_items(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  primary key (menu_item_id, ingredient_id)
);
create index idx_menu_item_ingredients_ingredient_id
  on menu_item_ingredients(ingredient_id);

-- Grant the new settings permissions to every role that can already manage
-- staff (i.e. admins keep access to everything).
update roles
set permissions = (
  select array_agg(distinct p)
  from unnest(
    permissions || array['manage_menu','manage_floor','manage_availability']
  ) as p
)
where 'manage_staff' = any(permissions);
-- Newer Supabase CLI stacks stopped granting data access on the public schema
-- to the API roles by default. v1 runs without RLS on the anon key (see the
-- deferred-RLS note in the initial schema), so grant table access explicitly.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated;

-- Future tables created by migrations get the same access automatically.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;

-- Re-apply the app_users column-level protection: pin_hash stays unreadable.
revoke select on app_users from anon, authenticated;
grant select (id, name, role_id, is_active, created_at) on app_users
  to anon, authenticated;
-- Staff chat: a shared team channel (recipient_id null) plus 1:1 direct
-- messages, delivered live over the local Supabase Realtime websocket.
-- Everything stays on the restaurant's own machine/LAN — no internet involved.

create table messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references app_users(id) on delete cascade,
  recipient_id uuid references app_users(id) on delete cascade, -- null = team channel
  body         text not null check (length(trim(body)) > 0),
  created_at   timestamptz not null default now()
);
create index idx_messages_created_at on messages(created_at);
create index idx_messages_recipient  on messages(recipient_id, created_at);

-- Per-user read markers; conversation is 'team' or the peer user's uuid.
create table chat_reads (
  user_id      uuid not null references app_users(id) on delete cascade,
  conversation text not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, conversation)
);

-- Stream INSERTs to clients (the publication is created empty by the stack).
alter publication supabase_realtime add table messages;
