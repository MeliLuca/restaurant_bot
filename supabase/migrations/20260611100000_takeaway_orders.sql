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
