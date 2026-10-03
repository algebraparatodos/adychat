-- Base compartida por el panel y el ejecutor.
-- El panel escribe acciones propuestas y las confirma; el ejecutor sólo
-- aplica las confirmadas y apunta qué pasó.

create table if not exists sessions (
  token_hash text primary key,
  user text,                    -- quién entró, en minúsculas (null: sesión vieja, del dueño)
  created_at text not null default (datetime('now')),
  expires_at text not null
);

create table if not exists login_failures (
  ip text not null,
  at text not null default (datetime('now'))
);
create index if not exists login_failures_ip on login_failures (ip, at);

-- Las conversaciones. El dueño abre una por tema (normalmente, una campaña)
-- y el modelo sólo relee la conversación en la que está. Borrar una borra
-- sus mensajes y su material; lo que ya está en Meta no se toca.
create table if not exists chats (
  id integer primary key autoincrement,
  title text not null default 'Nueva conversación',
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  touched integer not null default 0   -- orden de la lista: sube cada vez que se usa
);

-- Cada conversación: sólo el texto del dueño y el del asistente. Lo que hizo
-- cada herramienta no se guarda, para que cada turno no arrastre tablas
-- viejas de números (y no se pague por releerlas).
create table if not exists messages (
  id integer primary key autoincrement,
  chat_id integer references chats (id),
  at text not null default (datetime('now')),
  role text not null check (role in ('user', 'assistant')),
  content text not null
);

create index if not exists messages_chat on messages (chat_id, id);

create table if not exists actions (
  id integer primary key autoincrement,
  code text not null unique,
  chat_id integer,              -- la conversación que la propuso (el registro sobrevive a borrarla)
  created_at text not null default (datetime('now')),
  type text not null,
  title text not null,
  lines text not null,          -- JSON: las líneas de la tarjeta
  payload text not null,        -- JSON: la acción tal cual se aplica
  state text not null default 'proposed'
    check (state in ('proposed', 'confirmed', 'running', 'applied', 'failed', 'cancelled', 'expired')),
  state_at text not null default (datetime('now')),
  result text,                  -- JSON: lo que quedó creado o cambiado
  undo text,                    -- JSON: el valor anterior
  error text
);
create index if not exists actions_state on actions (state);
create index if not exists actions_chat on actions (chat_id);

-- Los anuncios que el dueño está preparando. Cada uno tiene su propio
-- material (fotos o vídeos): se sube POR ANUNCIO, no a una biblioteca.
create table if not exists ad_drafts (
  id integer primary key autoincrement,
  chat_id integer references chats (id),
  label text not null,
  created_at text not null default (datetime('now')),
  archived integer not null default 0
);

create index if not exists ad_drafts_chat on ad_drafts (chat_id);

-- El material de cada anuncio. Los bytes viven en KV: una foto en una
-- sola clave; un vídeo en trozos `<key>#0`, `<key>#1`... (KV admite 25 MB
-- por valor).
create table if not exists media (
  key text primary key,
  draft_id integer not null references ad_drafts (id),
  kind text not null check (kind in ('image', 'video')),
  name text not null,
  content_type text not null,
  size integer not null,
  chunks integer not null default 1,
  complete integer not null default 0,
  created_at text not null default (datetime('now')),
  width integer,
  height integer,
  meta_hash text,               -- foto: el hash en Meta
  meta_video_id text,           -- vídeo: el id en Meta
  meta_error text,              -- Meta no aceptó el archivo al presubirlo (no se reintenta)
  variant_of text               -- recorte de otra foto (su clave), hecho en la vista previa
);
create index if not exists media_draft on media (draft_id);

create table if not exists ai_usage (
  id integer primary key autoincrement,
  day text not null,
  at text not null default (datetime('now')),
  input_tokens integer not null,
  output_tokens integer not null,
  cost_eur real not null
);
create index if not exists ai_usage_day on ai_usage (day);

-- «Conocimiento»: lo que el dueño cuenta de su marca (qué vende, precios,
-- cómo quiere hablar en los anuncios...). Una sola fila; va en las
-- instrucciones del modelo en cada turno.
create table if not exists knowledge (
  id integer primary key check (id = 1),
  content text not null default '',
  updated_at text not null default (datetime('now'))
);

-- Verificación en dos pasos (03/10/2026). Una sola fila. El secreto
-- va cifrado con TOTP_KEY (src/panel/twofactor.ts). `pending` es la clave
-- mientras el dueño la está activando; `last_counter`, el último intervalo de
-- 30 s usado (un código no vale dos veces). Borrar la fila obliga a
-- activarla de nuevo.
create table if not exists two_factor (
  id integer primary key check (id = 1),
  secret text,
  pending text,
  enabled integer not null default 0,
  last_counter integer not null default -1,
  enabled_at text
);

-- Clientes potenciales (02/10/2026): cada formulario
-- que crea el ejecutor queda apuntado, y sus contactos se bajan a `leads` y
-- se le avisan al dueño por correo.
create table if not exists lead_forms (
  form_id text primary key,
  campaign_name text not null,
  campaign_id text,
  created_at text not null default (datetime('now')),
  checked_at text,
  last_lead_time integer not null default 0, -- el contacto más nuevo ya bajado (segundos unix)
  last_error text
);

create table if not exists leads (
  id text primary key,          -- el id del contacto en Meta
  form_id text not null,
  campaign_name text not null,
  created_time text not null,   -- cuándo lo dejó la persona (de Meta)
  full_name text,
  email text,
  phone text,
  fields text not null,         -- todo lo que contestó, tal cual (JSON)
  received_at text not null default (datetime('now')),
  notified_at text,
  notify_error text
);
create index if not exists leads_created on leads (created_time);
