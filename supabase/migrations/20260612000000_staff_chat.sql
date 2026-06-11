-- Staff chat: a shared team channel (recipient_id null) plus 1:1 direct
-- messages, delivered live over the local Supabase Realtime websocket.
-- Everything stays on the restaurant's own machine/LAN — no internet involved.

create table messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references app_users(id) on delete cascade,
  recipient_id uuid references app_users(id) on delete cascade, -- null = team channel
  body         text not null check (length(trim(body)) > 0),
  created_at   timestamptz not null default now()
);
create index idx_messages_created_at on messages(created_at);
create index idx_messages_recipient  on messages(recipient_id, created_at);

-- Per-user read markers; conversation is 'team' or the peer user's uuid.
create table chat_reads (
  user_id      uuid not null references app_users(id) on delete cascade,
  conversation text not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, conversation)
);

-- Stream INSERTs to clients (the publication is created empty by the stack).
alter publication supabase_realtime add table messages;
