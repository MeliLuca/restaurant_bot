-- Table splits (sub-tables): a dine-in table can run several open orders at
-- once, one per split label (e.g. B2/1, B2/Gino). A null subtable is the
-- "whole table" tab. The open-order invariant becomes per (table, split).

alter table orders add column subtable text;

alter table orders add constraint orders_subtable_dine_in_check
  check (subtable is null or order_type = 'dine_in');

drop index uniq_open_order_per_table;
create unique index uniq_open_order_per_table_split
  on orders (table_id, coalesce(subtable, '')) where (status = 'open');
