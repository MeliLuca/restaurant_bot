-- Assistente AI (PROTOTYPE): saved chats, like a normal chat app — each
-- user has their own conversations, with a title and the time of the last
-- message, and can reopen, rename or delete them.
--
-- * ai_conversations.context: what the conversation is working on, so a
--   follow-up builds on it instead of starting over ("…e abbiamo anche dei
--   bambini" keeps the 6 people and the TV of the request before). Written
--   by the server only; shape in src/lib/ai/contracts/chat.ts.
-- * Only the text of a reply is kept (plus which task answered): the
--   computed data behind it is recomputed when asked again, never stale.

create table ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app_users(id) on delete cascade,
  title       text not null check (btrim(title) <> ''),
  -- false while the title is still the first words of the first message;
  -- the model renames it once, after the first answer
  titled      boolean not null default false,
  context     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_ai_conversations_user on ai_conversations (user_id, updated_at desc);

create table ai_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references ai_conversations(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  -- assistant only: the task that answered, and how long the model took to
  -- route the request (null = keyword fallback)
  intent           text,
  model_ms         int,
  created_at       timestamptz not null default now()
);
create index idx_ai_messages_conversation on ai_messages (conversation_id, created_at);

-- REALTIME: a title written by the model after the answer shows up in the list
alter publication supabase_realtime add table ai_conversations;
