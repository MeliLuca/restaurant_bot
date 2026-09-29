-- Floor map editor: tables can be drawn straight onto the map. A drawn table
-- lives only in the editor draft until "Salva", so it is created here, in the
-- same transaction as the rest of the layout: leaving without saving (or
-- undoing the drawing) never leaves a stray table behind.
--
-- p_tables items are either an existing table ({id, placed, …geometry}) or a
-- new one ({new: true, key, name, capacity, tag_ids, …geometry}). Returns
-- {key: new table id} so the editor can swap its draft keys for real ids.

drop function if exists save_floor_map_layout(uuid, jsonb, jsonb, int, int);

create function save_floor_map_layout(
  p_map_id   uuid,
  p_tables   jsonb,
  p_elements jsonb default null,
  p_width    int   default null,
  p_height   int   default null
) returns jsonb
language plpgsql as $$
declare
  t       jsonb;
  new_id  uuid;
  created jsonb := '{}'::jsonb;
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
    if coalesce((t->>'new')::boolean, false) then
      begin
        insert into tables (name, capacity, map_id, shape, x, y, w, h, rotation, path)
        values (
          trim(t->>'name'),
          (t->>'capacity')::int,
          p_map_id,
          t->>'shape',
          (t->>'x')::numeric,
          (t->>'y')::numeric,
          (t->>'w')::numeric,
          (t->>'h')::numeric,
          coalesce((t->>'rotation')::numeric, 0),
          nullif(t->>'path', '')
        )
        returning id into new_id;
      exception when unique_violation then
        raise exception 'Il nome "%" è già usato da un altro tavolo', trim(t->>'name');
      end;
      insert into table_tag_links (table_id, tag_id)
      select new_id, tag::uuid
      from jsonb_array_elements_text(coalesce(t->'tag_ids', '[]'::jsonb)) as tag
      on conflict do nothing;
      created := created || jsonb_build_object(t->>'key', new_id);
    elsif (t->>'placed')::boolean then
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

  return created;
end;
$$;

grant execute on function save_floor_map_layout(uuid, jsonb, jsonb, int, int)
  to anon, authenticated;
