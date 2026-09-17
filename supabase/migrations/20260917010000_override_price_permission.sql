-- Price overrides become their own permission.
--
-- Editing a ticket line used to be two separate controls: a pencil that only
-- changed the price, and a link that only edited ingredients. They are now one
-- editor, so the two halves need to be told apart by right: anyone taking
-- orders may add or remove ingredients, but changing what a line is CHARGED is
-- a manager's call.
--
-- 'manage_menu' is the proxy for "already trusted with prices" — its own
-- description is "add and edit menu items, prices, and their ingredients", and
-- in the seeded roles only Admin holds it (Host and Server do not). Matching on
-- the capability rather than the name 'Admin' keeps this correct for renamed or
-- custom roles.
-- The cast is required: against a text[], a bare literal on the right of || is
-- read as an array literal, not an element.
update roles
set permissions = permissions || 'override_price'::text
where 'manage_menu' = any (permissions)
  and not ('override_price' = any (permissions));
