-- Stats module: nightly sales dashboard. No new tables — everything is
-- computed from orders/order_items. New permission key
-- (src/lib/auth/permissions.ts): view_stats.

-- Grant the new permission to every role that can already manage staff
-- (i.e. admins keep access to everything).
update roles
set permissions = (
  select array_agg(distinct p)
  from unnest(permissions || array['view_stats']) as p
)
where 'manage_staff' = any(permissions);
