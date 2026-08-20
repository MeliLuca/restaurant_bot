-- Per-item external code ("codice") carried over from the printed price list.
-- NOT unique: the same code repeats across size/variant rows (e.g. "01" for the
-- 0,20 L pour of two different beers). NULLable: several rows have no code.
-- Consumed by the menu manager (edit field) and the POS search (punch a code).
alter table menu_items add column codice text;
