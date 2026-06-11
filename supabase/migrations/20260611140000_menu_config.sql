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
