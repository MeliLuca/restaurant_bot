-- Note rapide: preset kitchen instructions a waiter taps onto a ticket line
-- ("Ben cotta", "Prima", "Con ghiaccio"). They cost nothing and are not
-- ingredients, so they don't belong in the pantry — there they would print as
-- "+ BEN COTTA" and turn up as a pizza topping. Picked notes land in
-- order_items.notes (comma-separated), which the comanda and the kitchen
-- display already print under the line.
create table line_notes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> '' and position(',' in name) = 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- The house's own list (tabella variazioni, 2026-09-30), grouped by when the
-- kitchen needs it: service, cooking, the pizza itself, drinks.
insert into line_notes (name, sort_order) values
  ('Prima', 10),
  ('Insieme', 20),
  ('Ben cotta', 30),
  ('Poco cotta', 40),
  ('In cottura', 50),
  ('Dopo cottura', 60),
  ('A spicchi', 70),
  ('Poca mozzarella', 80),
  ('Poco pomodoro', 90),
  ('Con ghiaccio', 100),
  ('Senza ghiaccio', 110),
  ('Con limone', 120);
