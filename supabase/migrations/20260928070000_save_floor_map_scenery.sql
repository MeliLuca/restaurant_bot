-- Floor map editor, phase 4: the scenery (walls, stages, labels, arrows) is
-- edited in the same draft as the tables, so it is saved in the same
-- transaction. p_elements = the map's full new elements array; null leaves
-- the scenery untouched (a tables-only save).

drop function if exists save_floor_map_layout(uuid, jsonb);

create function save_floor_map_layout(
  p_map_id   uuid,
  p_tables   jsonb,
  p_elements jsonb default null
) returns void
language plpgsql as $$
declare
  t jsonb;
begin
  perform 1 from floor_maps where id = p_map_id for update;
  if not found then
    raise exception 'La mappa non esiste più';
  end if;

  if p_elements is not null then
    if jsonb_typeof(p_elements) <> 'array' then
      raise exception 'elements must be a JSON array';
    end if;
    update floor_maps set elements = p_elements where id = p_map_id;
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

grant execute on function save_floor_map_layout(uuid, jsonb, jsonb)
  to anon, authenticated;
