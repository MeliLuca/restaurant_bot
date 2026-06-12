-- Thermal printing engine (ESC/POS over raw TCP on the local network).
-- Printers sit on static LAN IPs (e.g. 192.168.1.200:9100); each menu item
-- routes its production slip to one CUCINA/BAR printer, while CASSA prints the
-- full customer receipt. New permission key (src/lib/auth/permissions.ts):
-- manage_printers.

create type printer_type as enum ('CASSA', 'CUCINA', 'BAR');
create type paper_size   as enum ('80mm', '58mm');

create table printers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  local_ip     inet not null,
  port         int  not null default 9100 check (port between 1 and 65535),
  paper_size   paper_size   not null default '80mm',
  printer_type printer_type not null,
  is_active    boolean not null default true,
  -- Per-printer ticket options (admin checkboxes). Production layouts never
  -- print money regardless, so the price toggles only matter on CASSA.
  print_prices       boolean not null default true,
  print_grand_total  boolean not null default true,
  print_legal_footer boolean not null default false,
  header_text      text not null default '',
  footer_text      text not null default '',
  extra_feed_lines int  not null default 0 check (extra_feed_lines between 0 and 10),
  created_at   timestamptz not null default now()
);

-- Where an item's production slip goes; null = receipt-only (no slip), e.g. a
-- cover charge. Restrict-less on delete so removing a printer never blocks.
alter table menu_items
  add column target_printer_id uuid references printers(id) on delete set null;
create index idx_menu_items_target_printer_id on menu_items(target_printer_id);

-- Kitchen slips print modifiers ("NO BASILICO") stored per order line.
alter table order_items add column notes text;

-- Receipts and slips carry a short human-readable ticket number, and slips
-- show which server fired the order.
create sequence order_ticket_seq;
alter table orders
  add column ticket_number bigint not null unique default nextval('order_ticket_seq'),
  add column opened_by uuid references app_users(id) on delete set null;

-- The api_grants default privileges only cover tables; without this, POS
-- inserts fail with "permission denied for sequence order_ticket_seq".
grant usage, select on sequence order_ticket_seq to anon, authenticated;

-- Company identity for the CASSA receipt header/footer. Singleton row (the
-- boolean PK can only ever be true); created empty here, filled in Settings.
create table restaurant_settings (
  id               boolean primary key default true check (id),
  business_name    text not null default '',
  address          text not null default '',
  vat_number       text not null default '',   -- P.IVA
  phone            text not null default '',
  receipt_greeting text not null default 'Grazie e a presto!',
  legal_footer     text not null default '',
  updated_at       timestamptz not null default now()
);
insert into restaurant_settings default values;

-- Dispatch queue: every rendered ESC/POS buffer is persisted before the TCP
-- send so flaky printers can be retried and reprints replay the exact bytes.
create type print_job_status as enum ('queued', 'sent', 'failed');

create table print_jobs (
  id         uuid primary key default gen_random_uuid(),
  printer_id uuid not null references printers(id) on delete cascade,
  order_id   uuid references orders(id) on delete set null,
  payload    bytea not null,                    -- rendered ESC/POS buffer
  status     print_job_status not null default 'queued',
  attempts   int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index idx_print_jobs_status on print_jobs(status, created_at);

-- Grant the new settings permission to every role that can already manage
-- staff (i.e. admins keep access to everything).
update roles
set permissions = (
  select array_agg(distinct p)
  from unnest(permissions || array['manage_printers']) as p
)
where 'manage_staff' = any(permissions);
