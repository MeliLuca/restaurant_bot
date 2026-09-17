-- Take-away orders gain the time the customer said they would arrive.
--
-- `opened_at` answers "when did we write this down", which is never the
-- question asked about a take-away: the counter and the kitchen need to know
-- when the bag has to be on the shelf. Those two times drift apart by an hour
-- on a busy Saturday, which is exactly when the list has to be readable.
--
-- Null stays legal on purpose. An order taken at the counter for "right now"
-- has no promised time, and forcing one would put an invented number on every
-- walk-in — worse than an honest blank, because later phases size the kitchen's
-- load from these values.
alter table orders add column pickup_at timestamptz;

-- The take-away list and every capacity check read by promised time, so the
-- index is partial on the only order type that has one.
create index idx_orders_takeaway_pickup_at
  on orders(pickup_at)
  where (order_type = 'takeaway');
