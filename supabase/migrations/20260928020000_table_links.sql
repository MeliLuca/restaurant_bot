-- Linked tables: bills that belong together (e.g. one party spread over T22
-- and T10/Gino). Paying one of them warns while another is still open.
--
-- A member is a POS target: (table, subtable). A null subtable is the
-- whole-table member and covers EVERY open bill on that table; a named one
-- covers just that split. Members sharing a group_id are linked to each other
-- (linking is transitive: 22↔10 then 10↔5 puts all three in one group).
--
-- Links are for the current service only: a member leaves its group when its
-- bill closes (or the table is cleared), and a group left with one member is
-- dropped, so nothing lingers into the next night.

create table table_links (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null,
  table_id   uuid not null references tables(id) on delete cascade,
  subtable   text,
  created_at timestamptz not null default now()
);
create index idx_table_links_group_id on table_links(group_id);
-- a target sits in at most one group
create unique index uniq_table_link_target
  on table_links (table_id, coalesce(subtable, ''));

-- Drop groups that no longer link anything.
create function prune_table_links() returns void
language sql as $$
  delete from table_links
  where group_id in (
    select group_id from table_links group by group_id having count(*) < 2
  );
$$;

-- Link target A to target B, joining (or merging) their groups.
create function link_tables(
  a_table uuid, a_sub text, b_table uuid, b_sub text
) returns void
language plpgsql as $$
declare
  a_s text := nullif(btrim(a_sub), '');
  b_s text := nullif(btrim(b_sub), '');
  ga uuid;
  gb uuid;
begin
  if a_table = b_table and coalesce(a_s, '') = coalesce(b_s, '') then
    raise exception 'Cannot link a table to itself';
  end if;

  select group_id into ga from table_links
    where table_id = a_table and coalesce(subtable, '') = coalesce(a_s, '');
  select group_id into gb from table_links
    where table_id = b_table and coalesce(subtable, '') = coalesce(b_s, '');

  if ga is null and gb is null then
    ga := gen_random_uuid();
    insert into table_links (group_id, table_id, subtable)
      values (ga, a_table, a_s), (ga, b_table, b_s);
  elsif ga is null then
    insert into table_links (group_id, table_id, subtable)
      values (gb, a_table, a_s);
  elsif gb is null then
    insert into table_links (group_id, table_id, subtable)
      values (ga, b_table, b_s);
  elsif ga <> gb then
    update table_links set group_id = ga where group_id = gb;
  end if;
end;
$$;

-- Take one target out of its group.
create function unlink_table(p_table uuid, p_sub text) returns void
language plpgsql as $$
begin
  delete from table_links
  where table_id = p_table
    and coalesce(subtable, '') = coalesce(nullif(btrim(p_sub), ''), '');
  perform prune_table_links();
end;
$$;

-- A dine-in bill closed (paid or cancelled): its exact split member leaves,
-- and so does the whole-table member once the table has no open bill left.
create function table_links_on_order_closed() returns trigger
language plpgsql as $$
begin
  if new.table_id is null or new.status = 'open' or old.status <> 'open' then
    return new;
  end if;
  delete from table_links l
  where l.table_id = new.table_id
    and (
      (new.subtable is not null and l.subtable = new.subtable)
      or (
        l.subtable is null
        and not exists (
          select 1 from orders o
          where o.table_id = new.table_id and o.status = 'open'
        )
      )
    );
  perform prune_table_links();
  return new;
end;
$$;

create trigger trg_table_links_order_closed
  after update of status on orders
  for each row execute function table_links_on_order_closed();

-- A table cleared (dirty / available): members with no open bill behind them
-- leave — e.g. a split that was linked but never ordered.
create function table_links_on_table_cleared() returns trigger
language plpgsql as $$
begin
  if new.status = 'occupied' or new.status = old.status then
    return new;
  end if;
  delete from table_links l
  where l.table_id = new.id
    and not exists (
      select 1 from orders o
      where o.table_id = new.id and o.status = 'open'
        and (l.subtable is null or o.subtable = l.subtable)
    );
  perform prune_table_links();
  return new;
end;
$$;

create trigger trg_table_links_table_cleared
  after update of status on tables
  for each row execute function table_links_on_table_cleared();

grant select, insert, update, delete on table_links to anon, authenticated;
grant execute on function link_tables(uuid, text, uuid, text),
  unlink_table(uuid, text) to anon, authenticated;

alter publication supabase_realtime add table table_links;
