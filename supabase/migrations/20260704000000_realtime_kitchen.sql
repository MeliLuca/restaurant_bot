-- Realtime + kitchen display support.
--
-- 1. Broadcast table/order/item changes so waiter handhelds and the kitchen
--    display refresh without manual reloads (chat already streams this way).
-- 2. order_items.ready_at: when the kitchen bumped the item. A timestamp
--    instead of an enum: bump = now(), un-bump = null, and prep-time stats
--    come for free. Null = still to prepare.

alter table order_items add column ready_at timestamptz;

alter publication supabase_realtime add table tables, orders, order_items;
