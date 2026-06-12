-- Item modifiers (pizzeria-style variations): admin-defined modifier groups
-- ("Impasto" min:1 max:1, "Aggiunte" min:0 max:10) hold priced modifiers
-- ("Integrale" +1.50, "Bufala" +2.00, "No Basilico" +0.00). Menu items link to
-- the groups they offer; the POS forces a valid selection before the item can
-- join the ticket.
--
-- Accounting: order_items.unit_price keeps snapshotting the FULL price charged
-- per unit (base price + sum of modifier adjustments), so totals, split
-- payments and stats stay correct with no changes. order_item_modifiers rows
-- are per-line detail — name + adjustment frozen at order time — consumed by
-- the ticket UI and the print engine.

create table modifier_groups (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  min_selections int  not null default 0 check (min_selections >= 0),
  max_selections int  not null default 1 check (max_selections >= 1),
  sort_order     int  not null default 0,
  created_at     timestamptz not null default now(),
  check (max_selections >= min_selections)
);

create table modifiers (
  id               uuid primary key default gen_random_uuid(),
  group_id         uuid not null references modifier_groups(id) on delete cascade,
  name             text not null,
  price_adjustment numeric(10,2) not null default 0,
  sort_order       int  not null default 0,
  created_at       timestamptz not null default now(),
  unique (group_id, name)
);
create index idx_modifiers_group_id on modifiers(group_id);

-- Which groups a menu item offers (the POS opens the picker when any exist).
create table menu_item_modifier_groups (
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  group_id     uuid not null references modifier_groups(id) on delete cascade,
  primary key (menu_item_id, group_id)
);
create index idx_menu_item_modifier_groups_group_id
  on menu_item_modifier_groups(group_id);

-- Modifiers picked on one cart line. modifier_id is set-null so editing the
-- menu never breaks order history — the snapshotted name/price are what count.
create table order_item_modifiers (
  id               uuid primary key default gen_random_uuid(),
  order_item_id    uuid not null references order_items(id) on delete cascade,
  modifier_id      uuid references modifiers(id) on delete set null,
  name             text not null,
  price_adjustment numeric(10,2) not null,
  created_at       timestamptz not null default now()
);
create index idx_order_item_modifiers_order_item_id
  on order_item_modifiers(order_item_id);
