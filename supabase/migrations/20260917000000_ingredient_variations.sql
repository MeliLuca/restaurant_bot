-- Variations without modifier groups.
--
-- The three-level abstraction (modifier_groups → modifiers →
-- menu_item_modifier_groups) duplicated something the schema already had: the
-- `ingredients` pantry and its `menu_item_ingredients` join. The two systems
-- shared only the word "ingredient" in the UI copy.
--
-- New model: a dish carries a switch. When it is on, the POS lets staff REMOVE
-- any of the dish's own ingredients and ADD any ingredient from the pantry,
-- priced per ingredient. No groups, no min/max rules, nothing to wire up per
-- dish beyond the switch.
--
-- Pricing is untouched: order_items.unit_price still snapshots the full charged
-- price per unit, additions still taper by rank (w(i)=log2(1+1/i)) and removals
-- still deduct exactly nothing. See lib/money.ts.

alter table ingredients
  add column price numeric(10,2) not null default 0 check (price >= 0);

alter table menu_items
  add column allows_variations boolean not null default false;

-- order_item_modifiers survives as the per-line snapshot (name + adjustment
-- frozen at order time); only its provenance changes. Safe as a hard swap:
-- the table is empty, the demo rows having gone with the listino import.
--
-- is_removal is explicit rather than inferred from the sign of the adjustment,
-- as it used to be. Most pantry rows start at price 0, so "removed basil" and
-- "added free oregano" would otherwise be indistinguishable on a slip.
alter table order_item_modifiers drop column modifier_id;
alter table order_item_modifiers
  add column ingredient_id uuid references ingredients(id) on delete set null,
  add column is_removal boolean not null default false;

-- With is_removal carrying the intent, price_adjustment means exactly one
-- thing: the list price of an addition. Enforce it here rather than trusting
-- every future consumer to remember that removals must not deduct.
alter table order_item_modifiers
  add constraint order_item_modifiers_no_deduction
    check (price_adjustment >= 0),
  add constraint order_item_modifiers_removal_is_free
    check (not is_removal or price_adjustment = 0);

drop table menu_item_modifier_groups;
drop table modifiers;
drop table modifier_groups;

-- The listino import parsed the "ingredienti" column loosely and split a few
-- beer strengths into the pantry: '5% vol.' and the bare counts '4'/'6'. They
-- were harmless while the pantry only drove the 86 board; now that it is also
-- the add-on list, they would be offered as pizza toppings. The links go with
-- them (on delete cascade), which is the point — they are noise on a beer.
--
-- Deliberately narrow: '^[0-9]' would also take '4 formaggi', '2 hamburger'
-- and '4 stagioni', which are real ingredients.
delete from ingredients where name ~ '^[0-9]+$' or name like '%vol.%';
