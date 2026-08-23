-- Cover charge ("coperto") — the per-guest fee on dine-in checks.
--
-- The charge is DERIVED from a guest count captured once per check, never
-- punched in per person. That is the whole point: a manual per-guest line is
-- exactly what waiters forget on a busy service, and a forgotten coperto is
-- revenue lost silently, with nothing on the bill to notice it by.

-- How many guests this check is for.
--
-- Nullable rather than `not null default 1`: null means "never asked", which
-- is true of every legacy row and of takeaway/delivery, where covers do not
-- exist at all. A default of 1 would quietly invent a guest — and a coperto —
-- for orders that should have neither. Dine-in orders created from here on
-- always carry a real value; that is enforced in the app, at the one screen
-- that opens a check, not by a constraint that would reject the rows already
-- sitting open on the floor.
--
-- Zero is allowed and is NOT the same as null: it means someone looked at the
-- table and decided this check carries no cover charge (a comp, a staff meal,
-- take-away eaten at a table). The count stays editable for the life of the
-- check, so the waiter is never stuck with a number they typed in a hurry.
alter table orders
  add column covers integer check (covers is null or covers >= 0);

-- Marks the single menu_items row that IS the cover charge. It stays an
-- ordinary priced item so the house price is edited from the menu manager
-- like any other, but the browsing fetch filters it out — so it has no tap
-- target anywhere, and cannot be added, duplicated, or omitted by hand.
alter table menu_items
  add column is_coperto boolean not null default false;

-- At most one such row, enforced here rather than by convention: a second
-- coperto item would double-charge every table in the house, and nothing in
-- the UI would look wrong.
create unique index uniq_coperto_menu_item
  on menu_items (is_coperto) where is_coperto;

-- The coperto belongs on the receipt and nowhere else. Sending it to a
-- production printer would put "Coperto ×4" on the pizza oven's slip every
-- night — see the target_printer_id comment, which already names the cover
-- charge as the reason null means "receipt-only".
alter table menu_items
  add constraint coperto_is_receipt_only
  check (not is_coperto or target_printer_id is null);

-- The imported listino already carries the house Coperto row (Servizio,
-- EUR 1.50). Flag it rather than seeding a second one. A fresh database whose
-- seed differs simply updates nothing here, and the app treats "no coperto
-- item configured" as "this house does not charge one".
update menu_items
   set is_coperto = true
 where id = '30000000-0000-0000-0000-000000000091';
