-- Más de un usuario en el panel (03/10/2026): cada sesión guarda
-- quién entró. Las que ya existen quedan sin usuario y cuentan como del dueño.
alter table sessions add column user text;
