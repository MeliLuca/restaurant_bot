-- =============================================================================
-- Restaurant Management System — Seed Data (dev/demo)
-- Apply after db/schema.sql. Re-runnable: fixed UUIDs + ON CONFLICT DO NOTHING.
-- UUID prefixes by entity: 1=tables, 2=categories, 3=menu_items,
--                          4=reservations, 5=orders, 6=order_items
-- =============================================================================

-- TABLES: mixed statuses so the Floor Plan shows all three colors --------------
insert into tables (id, name, capacity, status) values
  ('10000000-0000-0000-0000-000000000001', 'T1', 2, 'available'),
  ('10000000-0000-0000-0000-000000000002', 'T2', 2, 'available'),
  ('10000000-0000-0000-0000-000000000003', 'T3', 4, 'occupied'),
  ('10000000-0000-0000-0000-000000000004', 'T4', 4, 'available'),
  ('10000000-0000-0000-0000-000000000005', 'T5', 4, 'dirty'),
  ('10000000-0000-0000-0000-000000000006', 'T6', 4, 'available'),
  ('10000000-0000-0000-0000-000000000007', 'T7', 4, 'occupied'),
  ('10000000-0000-0000-0000-000000000008', 'T8', 8, 'available'),
  ('10000000-0000-0000-0000-000000000009', 'B1', 2, 'available'),
  ('10000000-0000-0000-0000-000000000010', 'B2', 2, 'dirty'),
  ('10000000-0000-0000-0000-000000000011', 'P1', 6, 'available'),
  ('10000000-0000-0000-0000-000000000012', 'P2', 6, 'available')
on conflict (id) do nothing;

-- CATEGORIES --------------------------------------------------------------------
insert into categories (id, name, sort_order) values
  ('20000000-0000-0000-0000-000000000001', 'Starters', 1),
  ('20000000-0000-0000-0000-000000000002', 'Mains',    2),
  ('20000000-0000-0000-0000-000000000003', 'Desserts', 3),
  ('20000000-0000-0000-0000-000000000004', 'Drinks',   4)
on conflict (id) do nothing;

-- MENU ITEMS ----------------------------------------------------------------------
insert into menu_items (id, category_id, name, price, sort_order) values
  -- Starters
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Bruschetta',            8.50, 1),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Calamari Fritti',      12.00, 2),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'Caprese Salad',        10.50, 3),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 'Garlic Bread',          6.00, 4),
  ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', 'Soup of the Day',       7.50, 5),
  -- Mains
  ('30000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000002', 'Margherita Pizza',     14.00, 1),
  ('30000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000002', 'Spaghetti Carbonara',  16.50, 2),
  ('30000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000002', 'Ribeye Steak',         34.00, 3),
  ('30000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000002', 'Grilled Salmon',       26.00, 4),
  ('30000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000002', 'Chicken Parmigiana',   19.50, 5),
  ('30000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000002', 'Mushroom Risotto',     17.00, 6),
  ('30000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000002', 'Lamb Shank',           28.50, 7),
  -- Desserts
  ('30000000-0000-0000-0000-000000000013', '20000000-0000-0000-0000-000000000003', 'Tiramisu',              9.00, 1),
  ('30000000-0000-0000-0000-000000000014', '20000000-0000-0000-0000-000000000003', 'Panna Cotta',           8.00, 2),
  ('30000000-0000-0000-0000-000000000015', '20000000-0000-0000-0000-000000000003', 'Chocolate Lava Cake',   9.50, 3),
  ('30000000-0000-0000-0000-000000000016', '20000000-0000-0000-0000-000000000003', 'Gelato (3 scoops)',     7.00, 4),
  -- Drinks
  ('30000000-0000-0000-0000-000000000017', '20000000-0000-0000-0000-000000000004', 'Espresso',              3.50, 1),
  ('30000000-0000-0000-0000-000000000018', '20000000-0000-0000-0000-000000000004', 'Cappuccino',            4.50, 2),
  ('30000000-0000-0000-0000-000000000019', '20000000-0000-0000-0000-000000000004', 'Sparkling Water',       3.00, 3),
  ('30000000-0000-0000-0000-000000000020', '20000000-0000-0000-0000-000000000004', 'Coca-Cola',             3.50, 4),
  ('30000000-0000-0000-0000-000000000021', '20000000-0000-0000-0000-000000000004', 'House Red (glass)',     9.00, 5),
  ('30000000-0000-0000-0000-000000000022', '20000000-0000-0000-0000-000000000004', 'House White (glass)',   9.00, 6)
on conflict (id) do nothing;

-- RESERVATIONS: relative to "today" so the Floor Plan always has live bookings ----
insert into reservations (id, table_id, customer_name, party_size, reserved_at, notes) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'Smith',  4, current_date + time '18:30', 'Window seat requested'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Garcia', 2, current_date + time '19:00', null),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000011', 'Chen',   6, current_date + time '20:00', 'Birthday — bringing own cake')
on conflict (id) do nothing;

-- OPEN ORDER on occupied table T3 ---------------------------------------------
-- Items: 1x Calamari 12.00 + 2x Margherita 28.00 + 1x House Red 9.00
-- subtotal 49.00, tax @8% = 3.92, total 52.92
insert into orders (id, table_id, status, tax_rate, subtotal, tax, total) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'open', 0.0800, 49.00, 3.92, 52.92)
on conflict (id) do nothing;

insert into order_items (id, order_id, menu_item_id, quantity, unit_price) values
  ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 1, 12.00),
  ('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000006', 2, 14.00),
  ('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000021', 1,  9.00)
on conflict (id) do nothing;
-- STAFF: roles + users (PINs: Ava 1234, Harper 1111, Sam 2222) ----------------
set search_path to public, extensions;
insert into roles (id, name, permissions) values
  ('70000000-0000-0000-0000-000000000001', 'Admin',
   array['manage_tables','manage_reservations','take_orders','checkout_orders','manage_staff',
         'manage_menu','manage_floor','manage_availability','view_stats','manage_printers']),
  ('70000000-0000-0000-0000-000000000002', 'Host',
   array['manage_tables','manage_reservations']),
  ('70000000-0000-0000-0000-000000000003', 'Server',
   array['manage_tables','take_orders','checkout_orders'])
on conflict (id) do nothing;

insert into app_users (id, name, role_id, pin_hash) values
  ('80000000-0000-0000-0000-000000000001', 'Ava',
   '70000000-0000-0000-0000-000000000001', crypt('1234', gen_salt('bf'))),
  ('80000000-0000-0000-0000-000000000002', 'Harper',
   '70000000-0000-0000-0000-000000000002', crypt('1111', gen_salt('bf'))),
  ('80000000-0000-0000-0000-000000000003', 'Sam',
   '70000000-0000-0000-0000-000000000003', crypt('2222', gen_salt('bf')))
on conflict (id) do nothing;

-- TABLE TAGS: features used to filter tables (prefix a0) -----------------------
insert into table_tags (id, name) values
  ('a0000000-0000-0000-0000-000000000001', 'TV screen'),
  ('a0000000-0000-0000-0000-000000000002', 'Accessible'),
  ('a0000000-0000-0000-0000-000000000003', 'Child friendly'),
  ('a0000000-0000-0000-0000-000000000004', 'Window seat')
on conflict (id) do nothing;

insert into table_tag_links (table_id, tag_id) values
  ('10000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000003'),
  ('10000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004'),
  ('10000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000003')
on conflict do nothing;

-- INGREDIENTS (prefix 90) -------------------------------------------------------
insert into ingredients (id, name) values
  ('90000000-0000-0000-0000-000000000001', 'Mozzarella'),
  ('90000000-0000-0000-0000-000000000002', 'Tomato'),
  ('90000000-0000-0000-0000-000000000003', 'Basil'),
  ('90000000-0000-0000-0000-000000000004', 'Eggs'),
  ('90000000-0000-0000-0000-000000000005', 'Guanciale'),
  ('90000000-0000-0000-0000-000000000006', 'Chicken'),
  ('90000000-0000-0000-0000-000000000007', 'Mushrooms'),
  ('90000000-0000-0000-0000-000000000008', 'Salmon'),
  ('90000000-0000-0000-0000-000000000009', 'Beef'),
  ('90000000-0000-0000-0000-000000000010', 'Lamb'),
  ('90000000-0000-0000-0000-000000000011', 'Squid'),
  ('90000000-0000-0000-0000-000000000012', 'Garlic'),
  ('90000000-0000-0000-0000-000000000013', 'Mascarpone')
on conflict (id) do nothing;

insert into menu_item_ingredients (menu_item_id, ingredient_id) values
  -- Bruschetta: tomato, garlic, basil
  ('30000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000012'),
  ('30000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003'),
  -- Calamari Fritti: squid
  ('30000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000011'),
  -- Caprese Salad: mozzarella, tomato, basil
  ('30000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000003'),
  -- Garlic Bread: garlic
  ('30000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000012'),
  -- Margherita Pizza: mozzarella, tomato, basil
  ('30000000-0000-0000-0000-000000000006', '90000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000006', '90000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000006', '90000000-0000-0000-0000-000000000003'),
  -- Spaghetti Carbonara: eggs, guanciale
  ('30000000-0000-0000-0000-000000000007', '90000000-0000-0000-0000-000000000004'),
  ('30000000-0000-0000-0000-000000000007', '90000000-0000-0000-0000-000000000005'),
  -- Ribeye Steak: beef
  ('30000000-0000-0000-0000-000000000008', '90000000-0000-0000-0000-000000000009'),
  -- Grilled Salmon: salmon
  ('30000000-0000-0000-0000-000000000009', '90000000-0000-0000-0000-000000000008'),
  -- Chicken Parmigiana: chicken, mozzarella, tomato
  ('30000000-0000-0000-0000-000000000010', '90000000-0000-0000-0000-000000000006'),
  ('30000000-0000-0000-0000-000000000010', '90000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000010', '90000000-0000-0000-0000-000000000002'),
  -- Mushroom Risotto: mushrooms
  ('30000000-0000-0000-0000-000000000011', '90000000-0000-0000-0000-000000000007'),
  -- Lamb Shank: lamb
  ('30000000-0000-0000-0000-000000000012', '90000000-0000-0000-0000-000000000010'),
  -- Tiramisu: mascarpone, eggs
  ('30000000-0000-0000-0000-000000000013', '90000000-0000-0000-0000-000000000013'),
  ('30000000-0000-0000-0000-000000000013', '90000000-0000-0000-0000-000000000004')
on conflict do nothing;

-- STAFF CHAT: a few team-channel messages so /chat isn't empty (prefix b0) ----
insert into messages (id, sender_id, recipient_id, body, created_at) values
  ('b0000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', null,
   'Welcome to the team chat! Keep it short — we''re on service.', now() - interval '2 hours'),
  ('b0000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002', null,
   'Party of 6 at 20:00 wants the patio if it''s warm enough.', now() - interval '50 minutes'),
  ('b0000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-000000000003', null,
   'T3 asked to split the bill three ways, already set up the subtables.', now() - interval '20 minutes')
on conflict (id) do nothing;

-- PRINTERS: LAN thermal printers (prefix c0) -----------------------------------
insert into printers (id, name, local_ip, port, paper_size, printer_type,
                      print_prices, print_grand_total, print_legal_footer) values
  ('c0000000-0000-0000-0000-000000000001', 'Cassa',  '192.168.1.200', 9100, '80mm', 'CASSA',  true,  true,  true),
  ('c0000000-0000-0000-0000-000000000002', 'Cucina', '192.168.1.201', 9100, '80mm', 'CUCINA', false, false, false),
  ('c0000000-0000-0000-0000-000000000003', 'Bar',    '192.168.1.202', 9100, '58mm', 'BAR',    false, false, false)
on conflict (id) do nothing;

-- Route production slips: Drinks -> Bar, food categories -> Cucina. Guarded on
-- null so re-running the seed never clobbers routing changed in the admin UI.
update menu_items set target_printer_id = 'c0000000-0000-0000-0000-000000000003'
  where category_id = '20000000-0000-0000-0000-000000000004' and target_printer_id is null;
update menu_items set target_printer_id = 'c0000000-0000-0000-0000-000000000002'
  where category_id <> '20000000-0000-0000-0000-000000000004' and target_printer_id is null;

-- Demo company identity for the CASSA receipt header
update restaurant_settings set
  business_name = 'Trattoria Demo',
  address       = 'Via Roma 12, 20121 Milano (MI)',
  vat_number    = 'IT01234567890',
  phone         = '+39 02 1234 5678',
  legal_footer  = 'Documento commerciale di vendita o prestazione - non valido ai fini fiscali'
where business_name = '';

-- The open T3 order gets a server and a free-text cooking note so slips have
-- demo content; the structured "No Basilico" variation is added further below.
update orders set opened_by = '80000000-0000-0000-0000-000000000003'
  where id = '50000000-0000-0000-0000-000000000001' and opened_by is null;
update order_items set notes = 'ben cotta'
  where id = '60000000-0000-0000-0000-000000000002' and notes is null;

-- =============================================================================
-- ITEM MODIFIERS (pizzeria-style variations) ----------------------------------
-- Groups (prefix d0) hold priced modifiers (prefix e0); menu items link to the
-- groups they offer; one order line carries its picked variations (prefix f0).
-- =============================================================================
insert into modifier_groups (id, name, min_selections, max_selections, sort_order) values
  ('d0000000-0000-0000-0000-000000000001', 'Impasto',  1, 1,  1),   -- dough: pick exactly one
  ('d0000000-0000-0000-0000-000000000002', 'Aggiunte', 0, 10, 2),   -- paid additions
  ('d0000000-0000-0000-0000-000000000003', 'Senza',    0, 10, 3)    -- free removals
on conflict (id) do nothing;

insert into modifiers (id, group_id, name, price_adjustment, sort_order) values
  -- Impasto (dough type): classic is the no-cost default
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Classico',         0.00, 1),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'Integrale',        1.50, 2),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001', 'Senza Glutine',    2.00, 3),
  -- Aggiunte (paid additions)
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000002', 'Bufala',           2.00, 1),
  ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000002', 'Funghi',           1.50, 2),
  ('e0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000002', 'Nduja',            2.50, 3),
  ('e0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000002', 'Prosciutto Crudo', 3.00, 4),
  -- Senza (free removals)
  ('e0000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000003', 'No Basilico',      0.00, 1),
  ('e0000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000003', 'No Mozzarella',    0.00, 2),
  ('e0000000-0000-0000-0000-000000000010', 'd0000000-0000-0000-0000-000000000003', 'No Pomodoro',      0.00, 3)
on conflict (id) do nothing;

-- Margherita Pizza offers all three groups: the POS forces a dough choice
-- (Impasto min:1) before the item can join the ticket.
insert into menu_item_modifier_groups (menu_item_id, group_id) values
  ('30000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000003')
on conflict do nothing;

-- A structured zero-cost variation on the open T3 Margherita: demonstrates
-- order_item_modifiers flowing onto kitchen slips next to the free-text note.
-- Zero adjustment, so the order's hand-computed totals above still hold.
insert into order_item_modifiers (id, order_item_id, modifier_id, name, price_adjustment) values
  ('f0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002',
   'e0000000-0000-0000-0000-000000000008', 'No Basilico', 0.00)
on conflict (id) do nothing;
