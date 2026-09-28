-- Floor map editor, phase 5: the sheet size can change in the editor too
-- (fitting it to a photo being traced, or to an imported SVG), so it is saved
-- with the rest of the draft. Null keeps the current size.

drop function if exists save_floor_map_layout(uuid, jsonb, jsonb);

create function save_floor_map_layout(
  p_map_id   uuid,
  p_tables   jsonb,
  p_elements jsonb default null,
  p_width    int   default null,
  p_height   int   default null
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

  if p_width is not null or p_height is not null then
    update floor_maps set
      width  = coalesce(p_width, width),
      height = coalesce(p_height, height)
    where id = p_map_id;
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

grant execute on function save_floor_map_layout(uuid, jsonb, jsonb, int, int)
  to anon, authenticated;
