-- Varias conversaciones (30/09/2026). Lo que había pasa
-- entero a la primera, titulada con el primer mensaje del dueño.
create table if not exists chats (
  id integer primary key autoincrement,
  title text not null default 'Nueva conversación',
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  touched integer not null default 0   -- orden de la lista: sube cada vez que se usa
);
alter table messages add column chat_id integer references chats (id);
alter table actions add column chat_id integer;
alter table ad_drafts add column chat_id integer references chats (id);
insert into chats (id, title, created_at, updated_at, touched)
  select 1,
         coalesce((select substr(content, 1, 48) from messages where role = 'user' order by id limit 1), 'Primera conversación'),
         coalesce((select min(at) from messages), datetime('now')),
         coalesce((select max(at) from messages), datetime('now')),
         1
  where exists (select 1 from messages) or exists (select 1 from ad_drafts) or exists (select 1 from actions);
update messages set chat_id = 1 where chat_id is null and exists (select 1 from chats where id = 1);
update actions set chat_id = 1 where chat_id is null and exists (select 1 from chats where id = 1);
update ad_drafts set chat_id = 1 where chat_id is null and exists (select 1 from chats where id = 1);
create index if not exists messages_chat on messages (chat_id, id);
create index if not exists actions_chat on actions (chat_id);
create index if not exists ad_drafts_chat on ad_drafts (chat_id);

-- «Conocimiento» de la marca (30/09/2026).
create table if not exists knowledge (
  id integer primary key check (id = 1),
  content text not null default '',
  updated_at text not null default (datetime('now'))
);
