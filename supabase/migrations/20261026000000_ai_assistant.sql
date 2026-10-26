-- Assistente AI (PROTOTYPE): a local model (Ollama) that reads free text and
-- explains, while the numbers — prices, tables, delays, statistics — always
-- come from the app's own code. This migration is its data layer only.
--
-- Everything here is additive and nullable: with the module off (or the
-- AI_PROTOTYPE env flag unset) the app behaves exactly as before.
--
-- * ai_settings: the module switch and its knobs (singleton).
-- * use_ai: who may open the Assistente page.
-- * "Fuori menù": a dish that is not on the menu still needs a menu item
--   (order_items.menu_item_id is NOT NULL, and the item routes the comanda to
--   a printer). menu_items.is_custom marks one placeholder per category; the
--   line's real name lives in order_items.custom_name and is what prints.
-- * cost: optional purchase cost, so analytics can show a margin where known.

-- MODULE SETTINGS (singleton, like smart_floor_settings) -----------------------
create table ai_settings (
  id                      boolean primary key default true check (id),
  enabled                 boolean not null default false,
  -- an item still to prepare this long after it was sent is "late"
  kitchen_late_minutes    int not null default 20 check (kitchen_late_minutes between 3 and 120),
  bar_late_minutes        int not null default 8  check (bar_late_minutes between 1 and 60),
  -- a written dish sharing at least this share of ingredients with a menu
  -- dish is proposed as a variation of it; below, as "fuori menù"
  custom_dish_min_overlap numeric(3,2) not null default 0.50
                            check (custom_dish_min_overlap between 0 and 1),
  updated_at              timestamptz not null default now()
);
insert into ai_settings (id) values (true);

-- FUORI MENÙ ------------------------------------------------------------------------
alter table menu_items add column is_custom boolean not null default false;
-- one placeholder per category, created on first use
create unique index menu_items_one_custom_per_category
  on menu_items (category_id) where is_custom;

alter table order_items add column custom_name text
  check (custom_name is null or btrim(custom_name) <> '');

-- COSTS (optional) ------------------------------------------------------------------
-- menu_items.cost: food cost of one portion. ingredients.cost: cost of one
-- portion of the ingredient when ADDED to a dish.
alter table menu_items  add column cost numeric(10,2) check (cost is null or cost >= 0);
alter table ingredients add column cost numeric(10,2) check (cost is null or cost >= 0);

-- PERMISSION ------------------------------------------------------------------------
-- Granted by capability, not by name: whoever plans the floor (Admin, Sala
-- Manager) gets the assistant.
update roles
  set permissions = permissions || 'use_ai'::text
  where 'plan_floor' = any (permissions)
    and not ('use_ai' = any (permissions));

-- REALTIME: every device sees the module switch -------------------------------------
alter publication supabase_realtime add table ai_settings;
