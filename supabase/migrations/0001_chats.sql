create table chats (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  role text not null,
  blocks jsonb not null,
  created_at timestamptz not null default now()
);

create index messages_chat_id_idx on messages(chat_id);
