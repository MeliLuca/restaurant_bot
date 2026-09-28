-- Held print queue for production slips (comande).
--
-- When a CUCINA/BAR printer can't print (paper out, cover open, error,
-- unreachable) its comande are parked as 'held' instead of lost, and every
-- later comanda for that printer joins the queue without trying, so they come
-- out in order once the printer is back. A device then reprints them all (or
-- drops single ones → 'discarded'). Receipts and test prints never queue.
--
-- 1. New statuses. ADD VALUE can't be used in the same transaction, so nothing
--    below references them.
-- 2. kind: what the job is, so only comande queue and the reprint dialog can
--    say "Cambio tavolo" vs a normal round.
--    label: human target printed on the slip ("TAVOLO 3/A", "ASPORTO Rossi").
--    hold_reason: why it's held, as a code the UI translates
--    (paper_out | cover_open | printer_error | unreachable | queued_behind).
-- 3. Stream job changes so every device sees the queue appear and vanish.

alter type print_job_status add value if not exists 'held';
alter type print_job_status add value if not exists 'discarded';

alter table print_jobs
  add column kind text not null default 'other'
    check (kind in ('comanda', 'cambio_tavolo', 'conto', 'test', 'other')),
  add column label text,
  add column hold_reason text;

create index idx_print_jobs_printer_status on print_jobs(printer_id, status, created_at);

alter publication supabase_realtime add table print_jobs;
