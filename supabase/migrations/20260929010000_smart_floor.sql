-- Gestione Sala Smart: a switchable module that seats reservations and
-- walk-ins for you. This migration is its data layer only.
--
-- * A reservation now owns any number of tables (a party of 16 on 201 + 202)
--   or none yet (booked first, table assigned later): reservation_tables
--   replaces reservations.table_id. With the module off the app still books
--   exactly one hand-picked table — it just lives in the join table.
--   Deleting a table no longer deletes its bookings; they become unassigned.
-- * A reservation asks for table features (tag_ids), may prefer a room
--   (map_id), carries a phone to call when late, and can be locked so the
--   bulk assignment never moves it.
-- * waitlist: parties waiting at the door for a table to free up.
-- * table_join_rules: hand-made exceptions to "tables drawn close together
--   on the map can be pushed together".
-- * tables.occupied_at / orders.preconto_at: when a table was sat, when it
--   asked for the bill — the "about to leave" signals.

-- MODULE SETTINGS (singleton, like restaurant_settings) ----------------------
create table smart_floor_settings (
  id                     boolean primary key default true check (id),
  enabled                boolean not null default false,
  -- how long a party holds a table, and the gap kept before the next booking
  meal_minutes           int not null default 105 check (meal_minutes between 30 and 480),
  buffer_minutes         int not null default 15 check (buffer_minutes between 0 and 120),
  -- a booking this late colours its table and asks "Libera / Aspetta"
  late_after_minutes     int not null default 20 check (late_after_minutes between 5 and 120),
  -- warn this long before a booking whose table is still occupied
  occupied_warn_minutes  int not null default 30 check (occupied_warn_minutes between 5 and 180),
  phone_required         boolean not null default true,
  -- soft capacity: a guest more than the seats is fine (9 on an 8)…
  overfill_seats         int not null default 1 check (overfill_seats between 0 and 4),
  -- …and a small party on a bigger table (2 on a 5); beyond this many empty
  -- seats a table is only a last resort
  max_spare_seats        int not null default 3 check (max_spare_seats between 0 and 20),
  -- pushing tables together gains a seat at each join (6 + 10 → 17)
  join_bonus_seats       int not null default 1 check (join_bonus_seats between 0 and 4),
  -- tables whose outlines are at most this far apart (map units) can be joined
  join_distance          int not null default 30 check (join_distance between 0 and 200),
  max_join_tables        int not null default 4 check (max_join_tables between 2 and 8),
  -- an open bill with lines from these categories is "about to leave"
  finishing_category_ids uuid[] not null default '{}',
  updated_at             timestamptz not null default now()
);
insert into smart_floor_settings (id, finishing_category_ids)
  select true, coalesce(array_agg(id), '{}') from categories where name = 'Dolci';

-- TABLE FEATURES: some are a must when a booking asks for them ---------------
alter table table_tags add column is_mandatory boolean not null default false;
update table_tags set is_mandatory = true where name = 'Accessible';

-- RESERVATIONS ------------------------------------------------------------------
create table reservation_tables (
  reservation_id uuid not null references reservations(id) on delete cascade,
  table_id       uuid not null references tables(id) on delete cascade,
  primary key (reservation_id, table_id)
);
create index idx_reservation_tables_table_id on reservation_tables(table_id);

insert into reservation_tables (reservation_id, table_id)
  select id, table_id from reservations;
alter table reservations drop column table_id;

alter table reservations
  add column phone   text,
  add column tag_ids uuid[] not null default '{}',
  add column map_id  uuid references floor_maps(id) on delete set null,
  add column locked  boolean not null default false;

-- WAITLIST ------------------------------------------------------------------------
create table waitlist (
  id            uuid primary key default gen_random_uuid(),
  customer_name text not null check (btrim(customer_name) <> ''),
  party_size    int  not null check (party_size > 0),
  phone         text,
  tag_ids       uuid[] not null default '{}',
  map_id        uuid references floor_maps(id) on delete set null,
  notes         text,
  status        text not null default 'waiting'
                  check (status in ('waiting', 'seated', 'left')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create index idx_waitlist_waiting on waitlist(created_at) where status = 'waiting';

-- A deleted feature disappears from every request that asked for it.
create function strip_deleted_table_tag() returns trigger
language plpgsql as $$
begin
  update reservations set tag_ids = array_remove(tag_ids, old.id)
    where old.id = any(tag_ids);
  update waitlist set tag_ids = array_remove(tag_ids, old.id)
    where old.id = any(tag_ids);
  return old;
end;
$$;
create trigger trg_strip_deleted_table_tag
  after delete on table_tags
  for each row execute function strip_deleted_table_tag();

-- JOINABLE TABLES: exceptions to the map-distance rule -------------------------
-- joinable = true joins a pair the map puts too far apart; false keeps apart a
-- pair that is close but can't be moved (bench, pillar). Stored once per pair.
create table table_join_rules (
  table_a  uuid not null references tables(id) on delete cascade,
  table_b  uuid not null references tables(id) on delete cascade,
  joinable boolean not null,
  primary key (table_a, table_b),
  check (table_a < table_b)
);

-- WHEN A TABLE WAS SAT ------------------------------------------------------------
alter table tables add column occupied_at timestamptz;

create function stamp_table_occupied_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'occupied' then
    if tg_op = 'INSERT' then
      new.occupied_at := coalesce(new.occupied_at, now());
    elsif old.status <> 'occupied' then
      new.occupied_at := now();
    end if;
    -- occupied → occupied keeps the original time
  else
    new.occupied_at := null;
  end if;
  return new;
end;
$$;
create trigger trg_stamp_table_occupied_at
  before insert or update of status on tables
  for each row execute function stamp_table_occupied_at();

-- tables sat right now: from their oldest open bill, else from now
update tables t set occupied_at = coalesce(
  (select min(o.opened_at) from orders o
    where o.table_id = t.id and o.status = 'open'),
  now())
where t.status = 'occupied';

-- WHEN A BILL ASKED FOR THE PRE-CONTO ---------------------------------------------
alter table orders add column preconto_at timestamptz;

-- SAVE A RESERVATION (+ its tables) IN ONE GO -----------------------------------
-- p: {"id"?, "customer_name", "party_size", "reserved_at", "phone", "notes",
--     "tag_ids", "map_id", "locked", "status"} — on update, only keys present
--     are changed. p_table_ids: the tables it holds (null = leave them alone,
--     [] = unassign). Returns the reservation id.
create function save_reservation(p jsonb, p_table_ids uuid[] default null)
returns uuid
language plpgsql as $$
declare
  rid uuid := nullif(p->>'id', '')::uuid;
begin
  if rid is null then
    insert into reservations (
      customer_name, party_size, reserved_at, phone, notes, tag_ids, map_id,
      locked, status
    ) values (
      btrim(p->>'customer_name'),
      (p->>'party_size')::int,
      (p->>'reserved_at')::timestamptz,
      nullif(btrim(p->>'phone'), ''),
      nullif(btrim(p->>'notes'), ''),
      coalesce(array(select jsonb_array_elements_text(p->'tag_ids'))::uuid[], '{}'),
      nullif(p->>'map_id', '')::uuid,
      coalesce((p->>'locked')::boolean, false),
      coalesce((p->>'status')::reservation_status, 'booked')
    )
    returning id into rid;
  else
    update reservations set
      customer_name = case when p ? 'customer_name' then btrim(p->>'customer_name') else customer_name end,
      party_size    = case when p ? 'party_size' then (p->>'party_size')::int else party_size end,
      reserved_at   = case when p ? 'reserved_at' then (p->>'reserved_at')::timestamptz else reserved_at end,
      phone         = case when p ? 'phone' then nullif(btrim(p->>'phone'), '') else phone end,
      notes         = case when p ? 'notes' then nullif(btrim(p->>'notes'), '') else notes end,
      tag_ids       = case when p ? 'tag_ids'
                        then coalesce(array(select jsonb_array_elements_text(p->'tag_ids'))::uuid[], '{}')
                        else tag_ids end,
      map_id        = case when p ? 'map_id' then nullif(p->>'map_id', '')::uuid else map_id end,
      locked        = case when p ? 'locked' then (p->>'locked')::boolean else locked end,
      status        = case when p ? 'status' then (p->>'status')::reservation_status else status end
    where id = rid;
    if not found then
      raise exception 'La prenotazione non esiste più';
    end if;
  end if;

  if p_table_ids is not null then
    delete from reservation_tables where reservation_id = rid;
    insert into reservation_tables (reservation_id, table_id)
      select distinct rid, x from unnest(p_table_ids) as x;
  end if;
  return rid;
end;
$$;

-- ASSIGN MANY RESERVATIONS AT ONCE (bulk "Assegna") -----------------------------
-- p: [{"id", "table_ids": [...]}, ...] — each listed reservation's tables are
-- replaced; all or nothing, so a half-applied plan never shows on the floor.
create function assign_reservations(p jsonb) returns void
language plpgsql as $$
declare
  a jsonb;
  rid uuid;
begin
  for a in select * from jsonb_array_elements(p) loop
    rid := (a->>'id')::uuid;
    perform 1 from reservations where id = rid for update;
    if not found then
      raise exception 'Una prenotazione non esiste più';
    end if;
    delete from reservation_tables where reservation_id = rid;
    insert into reservation_tables (reservation_id, table_id)
      select distinct rid, x::uuid
      from jsonb_array_elements_text(coalesce(a->'table_ids', '[]')) as x;
  end loop;
end;
$$;

-- PERMISSIONS + ROLE ----------------------------------------------------------------
-- plan_floor: assign tables to bookings (single and bulk), desktop only.
-- floor_alerts: receive the waitlist / late-booking alerts.
update roles
  set permissions = array(
    select distinct unnest(permissions || array['plan_floor', 'floor_alerts'])
  )
  where name = 'Admin';

insert into roles (id, name, permissions) values
  ('70000000-0000-0000-0000-000000000004', 'Sala Manager',
   array['manage_tables', 'manage_reservations', 'plan_floor', 'floor_alerts'])
on conflict do nothing;

-- REALTIME: every device sees bookings, the queue and the module switch ------
alter publication supabase_realtime
  add table reservations, reservation_tables, waitlist, smart_floor_settings;
