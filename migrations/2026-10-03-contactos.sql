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
