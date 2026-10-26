-- The coperto becomes an ordinary product (user request, 2026-09-30).
--
-- It used to be derived from orders.covers and kept out of every production
-- slip. Now the covers prompt puts a "N× Coperto" line on the ticket like any
-- dish: it goes out with the round, prints on the comanda of whatever printer
-- the menu assigns it, and can be tapped, stepped and removed by hand. The
-- prompt stays — it is still how the count is asked when a table opens.

-- It may now have a production printer like any other item.
alter table menu_items drop constraint coperto_is_receipt_only;

-- orders.covers follows the coperto lines. Before, the count drove the line
-- (syncCoperto); with the line editable by hand, the count has to follow the
-- line too, or the chip, the stats and the split-per-guest flow would read a
-- number the bill no longer shows. The count includes paid covers, the same
-- rule syncCoperto uses, so the two directions agree on one number and
-- re-applying either leaves it unchanged.
--
-- Dine-in only: covers means nothing on a take-away, which stays null even
-- if someone taps the coperto there.
create function sync_order_covers_from_lines() returns trigger
language plpgsql as $$
declare
  cop uuid;
begin
  select id into cop from menu_items where is_coperto limit 1;
  if cop is null then
    return null;
  end if;

  if tg_op <> 'DELETE' and new.menu_item_id = cop then
    update orders o
       set covers = (
         select coalesce(round(sum(i.quantity::numeric / coalesce(i.fraction_of, 1))), 0)
           from order_items i
          where i.order_id = new.order_id and i.menu_item_id = cop)
     where o.id = new.order_id and o.order_type = 'dine_in';
  end if;

  if tg_op <> 'INSERT' and old.menu_item_id = cop
     and (tg_op = 'DELETE' or old.order_id <> new.order_id
          or new.menu_item_id is distinct from cop) then
    update orders o
       set covers = (
         select coalesce(round(sum(i.quantity::numeric / coalesce(i.fraction_of, 1))), 0)
           from order_items i
          where i.order_id = old.order_id and i.menu_item_id = cop)
     where o.id = old.order_id and o.order_type = 'dine_in';
  end if;

  return null;
end;
$$;

create trigger order_items_sync_covers
  after insert or update of quantity, order_id, menu_item_id, fraction_of or delete
  on order_items
  for each row execute function sync_order_covers_from_lines();
