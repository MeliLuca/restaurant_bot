-- Follow-up take-away orders, and one name per customer at a time.
--
-- Two things that only make sense together:
--
-- 1. A customer who rings back to add two bruschette must not have them typed
--    into the order already sent to the oven, and must not become a second,
--    unrelated "Rossi" at the counter either. They get a NEW order with its own
--    nightly number, carrying the same name and pointing at the first one.
--
-- 2. Which is only legible if a name means one customer. Today nothing stops
--    two open "Rossi", and the person handing bags over the counter has no way
--    to tell them apart — the name IS the addressing scheme for take-away, the
--    way a table number is for dine-in.

-- The order this one adds to. Set-null rather than cascade: losing the parent
-- row must never take a paid follow-up's items with it; the follow-up simply
-- becomes an ordinary order again.
alter table orders
  add column parent_order_id uuid references orders(id) on delete set null;

create index idx_orders_parent_order_id
  on orders(parent_order_id) where parent_order_id is not null;

-- One open take-away per name — but only among ROOT orders. Follow-ups are
-- exempt by construction: they share their parent's name on purpose, and that
-- shared name is what makes them read as one customer at the counter.
--
-- Case-insensitive, because "rossi" and "Rossi" are one customer to everyone
-- except a byte comparison. Names are compared trimmed by the app before they
-- get here; the index defends the invariant against every other write path.
create unique index uniq_open_root_takeaway_name
  on orders (lower(customer_name))
  where (status = 'open' and order_type = 'takeaway' and parent_order_id is null);
