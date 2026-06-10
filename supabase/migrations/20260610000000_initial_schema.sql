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
