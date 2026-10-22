-- La sesión guarda si se pasó el segundo paso (22/10/2026), y se exige en
-- cada ruta. Había versiones viejas del panel, de antes de los dos pasos,
-- publicadas en direcciones de versión de workers.dev con esta misma base:
-- abrían sesiones con sólo la contraseña. Se borran todas las sesiones
-- abiertas y todo el mundo vuelve a entrar.
alter table sessions add column two_factor integer not null default 0;
delete from sessions;
