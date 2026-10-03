-- Recortes por sitio de Instagram (03/10/2026): el dueño recorta la
-- foto de un anuncio en la vista previa y el recorte se guarda como otra
-- foto que cuelga de la original (no sale como foto suelta del anuncio).
alter table media add column variant_of text;
