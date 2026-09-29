-- Gestione Sala Smart: what keeps tables apart, besides distance.
--
-- * Zones inside a room (Palco 1, Palco 2…): tables of different zones — or
--   a zoned table and one with no zone — are never pushed together.
-- * Walls drawn on the map already keep them apart. A new element style,
--   "divider" (screens, planters, steps), does too, and can be taken away
--   for an evening without redrawing it:
--     elements[] shapes gain  "style": "divider"  and  "off"?: true
--   (off = removed for now: drawn faded, the tables either side can join).

create table floor_zones (
  id          uuid primary key default gen_random_uuid(),
  map_id      uuid not null references floor_maps(id) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (map_id, name)
);

alter table tables
  add column zone_id uuid references floor_zones(id) on delete set null;

-- A zone belongs to one room: a table moved to another room leaves it, and a
-- table can't be put in a zone of a room it isn't drawn in.
create function check_table_zone() returns trigger
language plpgsql as $$
begin
  if new.zone_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.map_id is distinct from old.map_id
     and new.zone_id is not distinct from old.zone_id then
    new.zone_id := null;
    return new;
  end if;
  if not exists (
    select 1 from floor_zones z where z.id = new.zone_id and z.map_id = new.map_id
  ) then
    raise exception 'Table % is not drawn in the room of zone %', new.name, new.zone_id;
  end if;
  return new;
end;
$$;

create trigger tables_check_zone
  before insert or update of map_id, zone_id on tables
  for each row execute function check_table_zone();

-- a divider taken away (or put back) re-plans every open screen
alter publication supabase_realtime add table floor_maps;
