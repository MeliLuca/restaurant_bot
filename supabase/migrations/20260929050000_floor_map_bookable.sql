-- A room that takes no bookings for now (the garden in winter): its tables
-- are left out of reservations, "Trova posto" and the waitlist. The map
-- still shows on the Sala page, so an order can be opened at its tables.
alter table floor_maps add column bookable boolean not null default true;
