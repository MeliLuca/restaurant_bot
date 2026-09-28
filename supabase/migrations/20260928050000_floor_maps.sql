-- Floor maps: a drawn layout of a room (sala) with the tables placed on it.
--
-- A map holds its fixed scenery — walls, stages, the bar counter, labels,
-- arrows — as a jsonb list of drawing elements in map units (0..width,
-- 0..height). Tables are NOT scenery: they stay rows in `tables` and carry
-- their own geometry, so status colours, bills and links keep working off the
-- same row the rest of the app already uses.
--
-- A table with map_id null is simply not placed on any map (it still shows in
-- the grid view). Deleting a map un-places its tables instead of deleting them.
--
-- elements[] item shapes (all coordinates in map units):
--   {"kind":"rect","x","y","w","h", "style"?}
--   {"kind":"circle","cx","cy","r", "style"?}
--   {"kind":"ellipse","cx","cy","rx","ry", "rotate"?, "label"?, "style"?}
--   {"kind":"path","d", "style"?}          -- SVG path data
--   {"kind":"text","x","y","text", "size"?, "rotate"?, "anchor"?, "font"?}
-- style: "wall" (thin outline, default) | "area" (light filled) | "arrow"
-- (thick stroke); font: "serif" (default) | "hand".

create table floor_maps (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  width      int  not null check (width > 0),
  height     int  not null check (height > 0),
  elements   jsonb not null default '[]'::jsonb,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

alter table tables
  add column map_id   uuid references floor_maps(id) on delete set null,
  add column shape    text not null default 'rect'
    check (shape in ('rect', 'circle', 'path')),
  -- rect/path: bounding box; circle: box around the circle (w = h = 2r).
  add column x        numeric,
  add column y        numeric,
  add column w        numeric,
  add column h        numeric,
  -- degrees, clockwise around the box centre
  add column rotation numeric not null default 0,
  -- SVG path data in map units, for odd shapes (curved counters…)
  add column path     text,
  add constraint tables_placed_has_box
    check (map_id is null or (x is not null and y is not null
                              and w > 0 and h > 0)),
  add constraint tables_path_shape_has_path
    check (shape <> 'path' or path is not null);

create index idx_tables_map_id on tables(map_id);
