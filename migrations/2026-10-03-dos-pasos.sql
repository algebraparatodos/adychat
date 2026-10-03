-- Verificación en dos pasos (03/10/2026). Sólo suma una tabla.
create table if not exists two_factor (
  id integer primary key check (id = 1),
  secret text,
  pending text,
  enabled integer not null default 0,
  last_counter integer not null default -1,
  enabled_at text
);
