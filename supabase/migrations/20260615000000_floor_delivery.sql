-- Floor-plan & delivery rework.
--
-- 1. Per-night delivery counter: take-away orders now carry a `delivery_number`
--    that restarts from 1 each night. "Night" is the later of the local
--    calendar-day rollover and the last manual reset (delivery_counter row),
--    so the number is assigned app-side at order creation (see api.ts).
-- 2. Reusable delivery name labels, auto-saved from each order's customer name.

-- The running counter only needs the last reset marker; the actual number is
-- derived from the orders opened since that boundary. Single-row singleton.
create table delivery_counter (
  singleton    boolean primary key default true check (singleton),
  last_reset_at timestamptz not null default '-infinity'
);
insert into delivery_counter (singleton) values (true);

-- Take-away order's nightly sequence number (null for dine-in orders).
alter table orders add column delivery_number integer;

-- Saved customer-name labels offered as quick-picks on the next delivery.
create table delivery_labels (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);
