-- Floor map editor: save a whole layout in one go.
--
-- The editor keeps a draft and writes it on "Salva". Dozens of tables may
-- have moved; doing that as one PATCH per table would let a tablet in service
-- refetch halfway and draw half the room in its old place (or a table on two
-- maps). One function, one transaction.
--
-- p_tables: [{"id", "placed": bool, "shape", "x", "y", "w", "h",
--             "rotation", "path"}, ...]
--   placed = true  → the table sits on this map with that geometry
--   placed = false → the table leaves this map (only if it is still on it:
--                    a concurrent move to another map wins)
-- Tables not listed are left alone.

create or replace function save_floor_map_layout(
  p_map_id uuid,
  p_tables jsonb
) returns void
language plpgsql as $$
declare
  t jsonb;
begin
  perform 1 from floor_maps where id = p_map_id for update;
  if not found then
    raise exception 'La mappa non esiste più';
  end if;

  for t in select * from jsonb_array_elements(p_tables) loop
    if (t->>'placed')::boolean then
      update tables set
        map_id   = p_map_id,
        shape    = t->>'shape',
        x        = (t->>'x')::numeric,
        y        = (t->>'y')::numeric,
        w        = (t->>'w')::numeric,
        h        = (t->>'h')::numeric,
        rotation = coalesce((t->>'rotation')::numeric, 0),
        path     = nullif(t->>'path', '')
      where id = (t->>'id')::uuid;
    else
      update tables set map_id = null
      where id = (t->>'id')::uuid and map_id = p_map_id;
    end if;
  end loop;
end;
$$;

grant execute on function save_floor_map_layout(uuid, jsonb)
  to anon, authenticated;
