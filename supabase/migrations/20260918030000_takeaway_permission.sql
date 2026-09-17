-- The take-away board becomes a screen you can be given or not.
--
-- Not every role wants it: a host seating tables has no business in the
-- take-away queue, and on a phone the tab bar has room for four labels at most
-- — so the one screen that is irrelevant to you should not be occupying a
-- quarter of it.
--
-- Granted to whoever already takes orders, which is the capability the board
-- is an entry point for. Matching on the capability rather than on role names
-- keeps this correct for renamed and custom roles.
update roles
set permissions = permissions || 'view_takeaway'::text
where 'take_orders' = any (permissions)
  and not ('view_takeaway' = any (permissions));
