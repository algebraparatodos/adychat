/**
 * La vista previa de un anuncio propuesto, dibujada por Meta tal como sale
 * en Instagram: Feed, Historias y Reels (03/10/2026). El dueño la mira
 * a pantalla completa antes de confirmar, sin entrar en el Administrador de
 * anuncios, y puede recortar la foto para cada sitio.
 *
 * Sólo GET con el token de lectura: pedirla no crea nada en Meta ni gasta.
 * El material tiene que estar ya en la biblioteca de la cuenta, y eso lo
 * hace el ejecutor en cuanto el dueño lo adjunta (presubida), porque el panel
 * no puede subir nada. El creativo sale de la misma función con la que el
 * ejecutor lo crea (shared/creative.ts).
 */

import { CTA_ES, WEB_OBJECTIVES, type Action, type AdCopy, type Objective, type Placement } from "../shared/actions.ts";
import { creativeOf, hasPlacements, type ImageRef, type ReadyMedia } from "../shared/creative.ts";
import type { MetaVars } from "../shared/env.ts";
import { adCopy, type MetaReader } from "./meta-read.ts";

/** Los tres sitios de Instagram donde sale un anuncio. */
export const FORMATS: Record<Placement, string> = {
  feed: "INSTAGRAM_STANDARD",
  story: "INSTAGRAM_STORY",
  reels: "INSTAGRAM_REELS",
};
export type Format = Placement;

/**
 * Lo que mide de verdad lo que dibuja Meta en cada sitio, medido en el
 * navegador el 03/10/2026. El recuadro que devuelve declara otra cosa (Reels:
 * 274 × 213 para algo de 320 × 624), y con esa medida salía una barra de
 * scroll. La página nunca deja hacer scroll dentro: se agranda o se achica
 * entero.
 */
export const SIZES: Record<Placement, { width: number; height: number }> = {
  feed: { width: 320, height: 534 },
  story: { width: 320, height: 567 },
  reels: { width: 320, height: 624 },
};

/**
 * El Feed no mide siempre lo mismo: Meta dibuja la foto a 318 de ancho con
 * su forma (recortada a 3:4 si es más alta, y a 1,91:1 si es más apaisada)
 * y le suma 216 px fijos de cabecera, botón, iconos y texto. Medido en el
 * navegador el 03/10/2026: cuadrada 534, 2:3 → 318 × 424 y 640 en total.
 * Con el 534 fijo, una foto vertical salía cortada debajo del botón. Sin
 * medidas (vídeo, publicación ya hecha) se toma la más alta: mejor un poco
 * de blanco abajo que el anuncio cortado.
 */
export function feedHeight(width?: number | null, height?: number | null, textLength = 0): number {
  const ratio = width && height ? Math.min(Math.max(height / width, 1 / 1.91), 4 / 3) : 4 / 3;
  return 216 + Math.round(318 * ratio) + captionExtra(textLength);
}

/**
 * Cuánto texto enseña Meta debajo del Feed depende de quién lo mira: sin
 * sesión de Facebook corta a 2 líneas (lo que cuentan los 216 px), pero con
 * la de otra persona enseñó más líneas y se cortaban en el borde (03/10/2026). Se
 * deja sitio para el texto entero: ~40 caracteres por línea (el usuario de
 * la cuenta va delante) y 18 px cada una, hasta 8 líneas. Si Meta lo corta
 * antes, queda blanco abajo, dentro de la tarjeta.
 */
function captionExtra(textLength: number): number {
  const lines = Math.min(Math.ceil((16 + textLength) / 40), 8);
  return Math.max(0, lines - 2) * 18;
}

/** Hasta dónde se lee el texto en el Feed sin pulsar «más»: unos 125 caracteres, lo que recomienda Meta. */
export const FEED_VISIBLE = 125;

/**
 * El texto del anuncio, entero, para leerlo al lado de la vista previa
 * (03/10/2026): dentro del recuadro de Meta se corta y no se puede
 * hacer scroll. `cut` marca dónde corta, más o menos, el Feed.
 */
export type CopyInfo = {
  headline?: string | undefined;
  text?: string | undefined;
  cut?: number | undefined;
  description?: string | undefined;
  button?: string | undefined;
  goesTo?: string | undefined;
  /** Una publicación ya hecha sale con su propio texto. */
  existingPost?: boolean;
};

export function copyOf(vars: MetaVars, action: Action, index: number): CopyInfo | undefined {
  const c = previewAds(action)[index]?.copy;
  if (!c) return undefined;
  const objective = objectiveOf(action);
  const host = new URL(vars.SITE_URL).hostname;
  const [button, goesTo] =
    objective === "messages"
      ? ["Enviar mensaje", "Instagram Direct"]
      : objective === "profile_visits"
        ? ["Ver perfil", `@${vars.META_IG_USERNAME}`]
        : objective === "leads_form"
          ? [CTA_ES[c.cta ?? "SIGN_UP"], "un formulario (nombre, correo y teléfono)"]
          : c.cta && c.path
            ? [CTA_ES[c.cta], `${host}${c.path}`]
            : [undefined, undefined];
  if (c.instagramMediaId) return { existingPost: true, button, goesTo };
  const text = c.primaryText ?? "";
  let cut: number | undefined;
  if (text.length > FEED_VISIBLE) {
    const space = text.lastIndexOf(" ", FEED_VISIBLE);
    cut = space > FEED_VISIBLE / 2 ? space : FEED_VISIBLE;
  }
  return { headline: c.headline, text, cut, description: c.description, button, goesTo };
}

/** Firma la dirección del panel desde la que Meta descarga una foto (shared/sign.ts). */
export type SignUrl = (key: string) => Promise<string>;

/**
 * Si la foto de este anuncio se puede recortar para un sitio, y cuál es el
 * recorte de ahora. Sólo antes de confirmar, sólo fotos subidas y, de
 * momento, sólo anuncios que llevan a la web (shared/creative.ts).
 */
export type Crop = { allowed: boolean; reason?: string; original?: string; current?: string | null };

export type Preview = (
  /** El recuadro de Meta, listo para poner en un iframe. */
  | { src: string; width: number; height: number }
  /** Todavía no se puede: el material se está subiendo o procesando. */
  | { wait: string }
  | { error: string }
) & { crop?: Crop };

/** Los anuncios de una acción que tienen vista previa, con un nombre para elegirlos. */
export function previewAds(action: Action): { copy: AdCopy; label: string }[] {
  const label = (c: AdCopy) => (c.instagramMediaId ? "Publicación de Instagram" : (c.headline ?? "Anuncio"));
  if (action.type === "create_campaign") return action.ads.map((c) => ({ copy: c, label: label(c) }));
  if (action.type === "add_ad") return [{ copy: action.ad, label: label(action.ad) }];
  return [];
}

export function objectiveOf(action: Action): Objective {
  return (action.type === "create_campaign" || action.type === "add_ad" ? action.objective : undefined) ?? "sales";
}

type MediaRow = { kind: "image" | "video"; meta_hash: string | null; meta_video_id: string | null; meta_error: string | null };

/** Sólo se acepta un recuadro servido por Facebook: es lo único que se mete en la página. */
const FRAME = /<iframe[^>]*\ssrc="(https:\/\/(?:business|www)\.facebook\.com\/[^"]+)"[^>]*>/;

function attr(tag: string, name: string, fallback: number): number {
  const n = Number(tag.match(new RegExp(`\\s${name}="(\\d+)"`))?.[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function readyMedia(db: D1Database, meta: MetaReader, key: string, signUrl?: SignUrl): Promise<ReadyMedia | Preview> {
  const row = await db.prepare(`select kind, meta_hash, meta_video_id, meta_error from media where key = ? and complete = 1`).bind(key).first<MediaRow>();
  if (!row) return { error: "El material de este anuncio ya no está en el panel." };
  if (row.meta_error) return { error: `Meta no aceptó este archivo: ${row.meta_error}` };
  if (row.kind === "image") {
    if (row.meta_hash) return { kind: "image", image: { hash: row.meta_hash } };
    // Todavía no está en Meta (el ejecutor la sube en el minuto): Meta la
    // descarga del panel para la vista previa, sin esperar.
    return signUrl ? { kind: "image", image: { url: await signUrl(key) } } : { wait: "Subiendo la foto a Meta para la vista previa…" };
  }
  if (!row.meta_video_id) return { wait: "Subiendo el vídeo a Meta para la vista previa…" };
  const st = await meta.get<{ status?: { video_status?: string; processing_progress?: number } }>(row.meta_video_id, { fields: "status" });
  const status = st.status?.video_status;
  if (status === "error") return { error: "Meta no pudo procesar el vídeo; prueba con otro archivo (MP4 o MOV)." };
  if (status !== "ready") {
    const pct = st.status?.processing_progress;
    return { wait: `Meta está procesando el vídeo${typeof pct === "number" ? ` (${pct} %)` : ""}…` };
  }
  const th = await meta.get<{ data?: { uri?: string; is_preferred?: boolean }[] }>(`${row.meta_video_id}/thumbnails`, { fields: "uri,is_preferred" });
  const pick = th.data?.find((t) => t.is_preferred) ?? th.data?.[0];
  if (!pick?.uri) return { wait: "Meta está terminando de preparar el vídeo…" };
  return { kind: "video", videoId: row.meta_video_id, thumbnail: pick.uri };
}

async function cropOf(db: D1Database, copy: AdCopy, objective: Objective, state: string, format: Format): Promise<Crop> {
  if (!copy.mediaKey) return { allowed: false, reason: "Una publicación ya hecha de Instagram sale tal cual: no se recorta." };
  const row = await db.prepare(`select kind from media where key = ?`).bind(copy.mediaKey).first<{ kind: string }>();
  if (row?.kind !== "image") return { allowed: false, reason: "Los vídeos no se pueden recortar desde aquí." };
  if (!WEB_OBJECTIVES.includes(objective) || !copy.cta || !copy.path) {
    return { allowed: false, reason: "De momento sólo se recortan las fotos de anuncios que llevan a la web." };
  }
  if (state !== "proposed") return { allowed: false, reason: "Esta propuesta ya no se puede cambiar." };
  return { allowed: true, original: copy.mediaKey, current: copy.placements?.[format] ?? null };
}

export async function preview(
  db: D1Database,
  meta: MetaReader,
  vars: MetaVars,
  action: Action,
  index: number,
  format: Format,
  state = "proposed",
  signUrl?: SignUrl,
): Promise<Preview> {
  const ad = previewAds(action)[index];
  if (!ad) return { error: "Esta propuesta no tiene ese anuncio." };
  const objective = objectiveOf(action);
  const campaignName = action.type === "create_campaign" || action.type === "add_ad" ? action.name : "";
  const crop = await cropOf(db, ad.copy, objective, state, format);
  try {
    let media: ReadyMedia | null = null;
    if (!ad.copy.instagramMediaId) {
      if (!ad.copy.mediaKey) return { error: "Este anuncio no tiene material.", crop };
      const got = await readyMedia(db, meta, ad.copy.mediaKey, signUrl);
      if ("wait" in got || "error" in got || "src" in got) return { ...got, crop };
      media = got;
      // Los recortes que el dueño hizo para cada sitio.
      if (got.kind === "image" && ad.copy.placements) {
        const placements: Partial<Record<Placement, ImageRef>> = {};
        for (const [p, key] of Object.entries(ad.copy.placements) as [Placement, string][]) {
          const c = await readyMedia(db, meta, key, signUrl);
          if ("wait" in c) return { wait: "Subiendo el recorte a Meta…", crop };
          if ("error" in c || "src" in c) return { ...c, crop };
          if (c.kind !== "image") return { error: "El recorte no es una foto.", crop };
          placements[p] = c.image;
        }
        media = { ...got, placements };
      }
    }
    // Sin formulario todavía (se crea al confirmar): la vista previa lleva
    // el mismo botón, sólo que sin el id del formulario.
    const creative = creativeOf(vars, ad.copy, campaignName, objective, null, media, true);
    const res = await meta.get<{ data?: { body?: string }[] }>(`${meta.account}/generatepreviews`, {
      ad_format: FORMATS[format],
      creative,
      // Con una foto por sitio, Meta dibuja la del sitio que se le nombra.
      ...(hasPlacements(creative) ? { dynamic_asset_label: format } : {}),
    });
    // El alto del Feed sale de la foto que se ve en el Feed (su recorte, si lo hay).
    const feedKey = ad.copy.instagramMediaId ? null : (ad.copy.placements?.feed ?? ad.copy.mediaKey ?? null);
    const dims = feedKey
      ? await db.prepare(`select width, height from media where key = ?`).bind(feedKey).first<{ width: number | null; height: number | null }>()
      : null;
    const body = res.data?.[0]?.body ?? "";
    const frame = body.match(FRAME);
    if (!frame?.[1]) return { error: "Meta no devolvió la vista previa.", crop };
    // Lo que mide de verdad (SIZES), si Meta declara menos.
    const width = Math.max(attr(frame[0], "width", 0), SIZES[format].width);
    const height = format === "feed" ? feedHeight(dims?.width, dims?.height, ad.copy.primaryText?.length ?? 0) : Math.max(attr(frame[0], "height", 0), SIZES[format].height);
    return { src: frame[1].replace(/&amp;/g, "&"), width, height, crop };
  } catch (err) {
    return { error: `Meta no pudo dibujar la vista previa: ${String(err instanceof Error ? err.message : err).replace(/^Meta \d+: /, "")}`, crop };
  }
}

/** Texto del anuncio con la marca de hasta dónde se lee en el Feed. */
function withCut(text: string | undefined): { text?: string; cut?: number } {
  if (!text) return {};
  if (text.length <= FEED_VISIBLE) return { text };
  const space = text.lastIndexOf(" ", FEED_VISIBLE);
  return { text, cut: space > FEED_VISIBLE / 2 ? space : FEED_VISIBLE };
}

/**
 * La vista previa de un anuncio que YA está creado (pantalla «Campañas
 * creadas», 03/10/2026): Meta la dibuja a partir del anuncio mismo
 * (`/{ad}/previews`), así que es exactamente lo que se publica. Sólo GET con
 * el token de lectura. Trae también el texto entero para la caja de al lado.
 */
export async function adPreview(meta: MetaReader, adId: string, format: Format): Promise<Preview & { copy?: CopyInfo }> {
  try {
    const [res, ad] = await Promise.all([
      meta.get<{ data?: { body?: string }[] }>(`${adId}/previews`, { ad_format: FORMATS[format] }),
      meta.get<{ creative?: Parameters<typeof adCopy>[0] & { call_to_action_type?: string } }>(adId, {
        fields: "creative{object_story_spec,asset_feed_spec,source_instagram_media_id,call_to_action_type}",
      }),
    ]);
    const c = adCopy(ad.creative);
    const cta = ad.creative?.call_to_action_type as keyof typeof CTA_ES | undefined;
    let goesTo: string | undefined;
    if (c.enlace) {
      try {
        const u = new URL(c.enlace);
        goesTo = `${u.hostname}${u.pathname}`;
      } catch {
        goesTo = c.enlace;
      }
    }
    const copy: CopyInfo = c.publicacion_de_instagram
      ? { existingPost: true }
      : { headline: c.titular, ...withCut(c.texto), button: cta ? (CTA_ES[cta] ?? cta) : undefined, goesTo };
    const frame = (res.data?.[0]?.body ?? "").match(FRAME);
    if (!frame?.[1]) return { error: "Meta no devolvió la vista previa.", copy };
    const width = Math.max(attr(frame[0], "width", 0), SIZES[format].width);
    // Sin las medidas de la foto, el Feed toma la más alta: mejor blanco abajo que cortado.
    const height = format === "feed" ? feedHeight(null, null, c.texto?.length ?? 0) : Math.max(attr(frame[0], "height", 0), SIZES[format].height);
    return { src: frame[1].replace(/&amp;/g, "&"), width, height, copy };
  } catch (err) {
    return { error: `Meta no pudo dibujar la vista previa: ${String(err instanceof Error ? err.message : err).replace(/^Meta \d+: /, "")}` };
  }
}
