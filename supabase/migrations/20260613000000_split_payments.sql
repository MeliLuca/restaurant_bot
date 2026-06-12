-- Split-bill module: one order can be settled by several partial payments —
-- "alla romana" even shares of the remaining balance, or payments covering
-- specific lines. The order closes when payments reach orders.total; every
-- transaction is kept for reconciliation.

create table order_payments (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  -- 'even' = alla-romana share of the remaining balance
  -- 'items' = payment covering specific order_items (linked below)
  kind       text not null check (kind in ('even', 'items')),
  amount     numeric(10,2) not null check (amount >= 0),
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_order_payments_order_id on order_payments(order_id);

alter table order_items
  -- set when this line was covered by a per-item partial payment
  add column paid_by_payment_id uuid references order_payments(id) on delete set null,
  -- a shared item split X ways: each share row is one 1/X part (quantity 1,
  -- unit_price = its cent-exact slice of the original line total)
  add column fraction_of int check (fraction_of is null or fraction_of >= 2);
