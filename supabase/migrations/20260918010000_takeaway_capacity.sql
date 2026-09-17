-- Take-away capacity: how much of each category the kitchen can promise for a
-- given time, and the grid of times it is promised on.
--
-- The constraint being modelled is physical, not commercial: an oven fits so
-- many pizzas in half an hour, and a fryer so many club sandwiches in an hour.
-- Those two are not the same window, which is why the window is per category
-- rather than one house-wide number.

-- The slot grid, shared by every screen that offers or reads a pickup time.
-- Stored as "HH:mm" text rather than time: it is a wall-clock label for a grid,
-- never arithmetic against a date, and text is what the settings form edits.
alter table restaurant_settings
  add column takeaway_slot_minutes  integer not null default 30
    check (takeaway_slot_minutes between 5 and 240),
  add column takeaway_service_start text not null default '18:30',
  add column takeaway_service_end   text not null default '23:00';

-- One limit per category. Keyed by category so a category can hold at most one
-- rule: two rules for pizze would make "the limit" a question with two answers,
-- and the warning banner has to name a single number.
create table takeaway_category_limits (
  category_id    uuid primary key references categories(id) on delete cascade,
  -- Max pieces of this category promised inside one window.
  max_items      integer not null check (max_items > 0),
  -- Width of that window in minutes — "50 every 30 min" vs "20 every hour".
  window_minutes integer not null check (window_minutes between 5 and 240),
  -- Off keeps the numbers without enforcing them: a quiet Tuesday should not
  -- cost the manager the values they tuned for Saturday.
  is_active      boolean not null default true,
  updated_at     timestamptz not null default now()
);
