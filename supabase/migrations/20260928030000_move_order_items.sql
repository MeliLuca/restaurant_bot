-- Cambio tavolo: move a bill, or part of it, to another table / split.
--
-- One function, one transaction: a move that splits a line (2 of 3 beers)
-- is a shrink plus an insert, and a half-applied one would leave dishes on
-- both bills or on neither. Doing it app-side like most writes here would be
-- one network hiccup away from exactly that.
--
-- Rules (agreed with the house):
--   * Paid lines never move; the coperto never moves by hand either — it is
--     derived from the guest count, which the app re-syncs afterwards.
--   * "Everything" = every unpaid real line at full quantity, no paid lines.
--       - onto a bill-less target: the order itself changes table. Covers,
--         partial payments and the ticket number go with it.
--       - onto an open bill: lines merge into it, covers are added up, and
--         the emptied source is cancelled (its dishes now live elsewhere, so
--         it must not count as revenue).
--   * A partial move leaves the covers on the source. A target bill created
--     by it starts at 0 covers (the waiter can correct the chip).
--   * A source with partial payments can only move as a whole to a free
--     target: taking lines off it would skew an "alla romana" balance.
--
-- p_items: [{"id": "<order_item uuid>", "quantity": n}, ...]
-- Returns { order_id, moved_item_ids, merged, source_closed, covers }:
--   order_id       the target bill
--   moved_item_ids the lines now on the target that came from the source (for
--                  the kitchen's "CAMBIO TAVOLO" slip)
--   source_closed  the source bill is gone from its table (moved or cancelled)
--   covers         the target's guest count when the app must re-sync its
--                  coperto (merge), else null

create or replace function move_order_items(
  p_from_order uuid,
  p_items      jsonb,
  p_to_table   uuid,
  p_to_sub     text,
  p_user       uuid
) returns jsonb
language plpgsql as $$
declare
  to_sub    text := nullif(btrim(p_to_sub), '');
  src       orders%rowtype;
  dst       orders%rowtype;
  coperto   uuid;
  sel       record;
  row_      order_items%rowtype;
  new_id    uuid;
  moved     uuid[] := '{}';
  whole     boolean;
  has_pay   boolean;
  sel_count int;
  sel_items jsonb;
begin
  select * into src from orders where id = p_from_order for update;
  if not found or src.status <> 'open' then
    raise exception 'Il conto non è più aperto';
  end if;
  if src.order_type <> 'dine_in' or src.table_id is null then
    raise exception 'Solo i conti ai tavoli si possono spostare';
  end if;
  if src.table_id = p_to_table
     and coalesce(src.subtable, '') = coalesce(to_sub, '') then
    raise exception 'Il conto è già su questo tavolo';
  end if;
  if not exists (select 1 from tables where id = p_to_table) then
    raise exception 'Tavolo di destinazione inesistente';
  end if;

  select id into coperto from menu_items where is_coperto limit 1;

  -- the selection (duplicates summed, zero rows dropped), validated against
  -- the source's own unpaid, real lines
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'quantity', x.quantity)), '[]')
    into sel_items
    from (
      select r.id, sum(r.quantity)::int as quantity
      from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as r(id uuid, quantity int)
      where r.quantity > 0
      group by r.id
    ) x;
  sel_count := jsonb_array_length(sel_items);
  if sel_count = 0 then
    raise exception 'Nessun piatto selezionato';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(sel_items) as s(id uuid, quantity int)
    left join order_items i on i.id = s.id and i.order_id = src.id
    where i.id is null
       or i.paid_by_payment_id is not null
       or i.menu_item_id is not distinct from coperto
       or s.quantity > i.quantity
  ) then
    raise exception 'Selezione non valida: righe pagate, coperti o quantità errate';
  end if;

  whole := not exists (
    select 1 from order_items i
    left join jsonb_to_recordset(sel_items) as s(id uuid, quantity int) on s.id = i.id
    where i.order_id = src.id
      and i.menu_item_id is distinct from coperto
      and (i.paid_by_payment_id is not null or s.id is null or s.quantity < i.quantity)
  );
  has_pay := exists (select 1 from order_payments where order_id = src.id);

  select * into dst from orders
    where table_id = p_to_table
      and coalesce(subtable, '') = coalesce(to_sub, '')
      and status = 'open'
    for update;

  if has_pay and (not whole or dst.id is not null) then
    raise exception 'Il conto ha pagamenti parziali: si può solo spostare tutto su un tavolo libero';
  end if;

  update tables set status = 'occupied' where id = p_to_table;

  -- Whole bill onto a free target: the order simply changes table.
  if whole and dst.id is null then
    update orders set table_id = p_to_table, subtable = to_sub where id = src.id;
    select coalesce(array_agg(id), '{}') into moved from order_items
      where order_id = src.id and menu_item_id is distinct from coperto;
    return jsonb_build_object(
      'order_id', src.id, 'moved_item_ids', to_jsonb(moved),
      'merged', false, 'source_closed', true, 'covers', null);
  end if;

  if dst.id is null then
    insert into orders (table_id, subtable, tax_rate, opened_by, covers)
      values (p_to_table, to_sub, src.tax_rate, p_user, 0)
      returning * into dst;
  end if;

  for sel in select s.* from jsonb_to_recordset(sel_items) as s(id uuid, quantity int) loop
    select * into row_ from order_items where id = sel.id for update;
    if sel.quantity = row_.quantity then
      update order_items set order_id = dst.id where id = row_.id;
      moved := moved || row_.id;
    else
      update order_items set quantity = quantity - sel.quantity where id = row_.id;
      insert into order_items (order_id, menu_item_id, quantity, unit_price,
                               notes, fraction_of, ready_at, created_at)
        values (dst.id, row_.menu_item_id, sel.quantity, row_.unit_price,
                row_.notes, row_.fraction_of, row_.ready_at, row_.created_at)
        returning id into new_id;
      insert into order_item_modifiers (order_item_id, ingredient_id, name,
                                        price_adjustment, is_removal)
        select new_id, ingredient_id, name, price_adjustment, is_removal
        from order_item_modifiers where order_item_id = row_.id;
      moved := moved || new_id;
    end if;
  end loop;

  if whole then
    -- merged into an open bill: the guests come along, the source is empty
    update orders set covers = coalesce(dst.covers, 0) + coalesce(src.covers, 0)
      where id = dst.id
      returning * into dst;
    delete from order_items where order_id = src.id;
    update orders set status = 'cancelled', closed_at = now(),
                      subtotal = 0, tax = 0, total = 0
      where id = src.id;
    return jsonb_build_object(
      'order_id', dst.id, 'moved_item_ids', to_jsonb(moved),
      'merged', true, 'source_closed', true, 'covers', dst.covers);
  end if;

  return jsonb_build_object(
    'order_id', dst.id, 'moved_item_ids', to_jsonb(moved),
    'merged', false, 'source_closed', false, 'covers', null);
end;
$$;

grant execute on function move_order_items(uuid, jsonb, uuid, text, uuid)
  to anon, authenticated;
