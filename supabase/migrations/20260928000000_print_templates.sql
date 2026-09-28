-- Configurable print layouts. A template is an ordered list of blocks (static
-- text, rows with placeholders, separators, the item list, totals) stored as
-- jsonb; its shape and defaults live in src/lib/printing/template.ts, which
-- also normalizes whatever it reads back so an old or hand-edited row can't
-- break printing.
--
-- Two kinds: COMANDA (production slip, never prints money) and CONTO (the
-- customer receipt, whose pre-conto / partial-payment variants are handled by
-- per-block visibility rather than by separate templates).

create table print_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  kind       text not null check (kind in ('COMANDA', 'CONTO')),
  -- Paper the editor previews on; the printed width always follows the
  -- printer the template is assigned to.
  paper_size paper_size not null default '80mm',
  blocks     jsonb not null default '[]'::jsonb,
  -- Blank lines fed before the cut, and whether to cut at all.
  feed_lines int not null default 0 check (feed_lines between 0 and 10),
  cut        boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Which template each printer uses. Null = the built-in standard layout,
-- derived from the printer's legacy options (header_text, print_prices, …) so
-- printers keep printing exactly as before until someone picks a template.
-- Deleting a template in use is blocked (no cascade): the admin UI reassigns
-- first.
alter table printers
  add column comanda_template_id uuid references print_templates(id),
  add column conto_template_id   uuid references print_templates(id);
