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

import { WEB_OBJECTIVES, type Action, type AdCopy, type Objective, type Placement } from "../shared/actions.ts";
import { creativeOf, hasPlacements, type ReadyMedia } from "../shared/creative.ts";
import type { MetaVars } from "../shared/env.ts";
import type { MetaReader } from "./meta-read.ts";

/** Los tres sitios de Instagram donde sale un anuncio. */
export const FORMATS: Record<Placement, string> = {
  feed: "INSTAGRAM_STANDARD",
  story: "INSTAGRAM_STORY",
  reels: "INSTAGRAM_REELS",
};
export type Format = Placement;

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

async function readyMedia(db: D1Database, meta: MetaReader, key: string): Promise<ReadyMedia | Preview> {
  const row = await db.prepare(`select kind, meta_hash, meta_video_id, meta_error from media where key = ? and complete = 1`).bind(key).first<MediaRow>();
  if (!row) return { error: "El material de este anuncio ya no está en el panel." };
  if (row.meta_error) return { error: `Meta no aceptó este archivo: ${row.meta_error}` };
  if (row.kind === "image") {
    return row.meta_hash ? { kind: "image", hash: row.meta_hash } : { wait: "Subiendo la foto a Meta para la vista previa…" };
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
      const got = await readyMedia(db, meta, ad.copy.mediaKey);
      if ("wait" in got || "error" in got || "src" in got) return { ...got, crop };
      media = got;
      // Los recortes que el dueño hizo para cada sitio.
      if (got.kind === "image" && ad.copy.placements) {
        const placements: Partial<Record<Placement, string>> = {};
        for (const [p, key] of Object.entries(ad.copy.placements) as [Placement, string][]) {
          const c = await readyMedia(db, meta, key);
          if ("wait" in c) return { wait: "Subiendo el recorte a Meta…", crop };
          if ("error" in c || "src" in c) return { ...c, crop };
          if (c.kind !== "image") return { error: "El recorte no es una foto.", crop };
          placements[p] = c.hash;
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
    const body = res.data?.[0]?.body ?? "";
    const frame = body.match(FRAME);
    if (!frame?.[1]) return { error: "Meta no devolvió la vista previa.", crop };
    return { src: frame[1].replace(/&amp;/g, "&"), width: attr(frame[0], "width", 320), height: attr(frame[0], "height", 560), crop };
  } catch (err) {
    return { error: `Meta no pudo dibujar la vista previa: ${String(err instanceof Error ? err.message : err).replace(/^Meta \d+: /, "")}`, crop };
  }
}
