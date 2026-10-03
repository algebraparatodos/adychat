-- Vista previa de los anuncios (03/10/2026): el ejecutor sube el
-- material a la biblioteca de Meta en cuanto el dueño lo adjunta, para que el
-- panel pueda pedirle a Meta cómo se ve el anuncio. Si Meta no acepta un
-- archivo, el motivo queda aquí y no se reintenta cada minuto.
alter table media add column meta_error text;
