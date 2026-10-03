-- Las fotos pasan de una biblioteca suelta (images) a material por anuncio
-- (ad_drafts + media). La tabla vieja estaba vacía en producción.
drop table if exists images;
