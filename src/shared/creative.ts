/**
 * El creativo de un anuncio: lo que se le manda a Meta para dibujarlo.
 *
 * Lo usan las dos mitades: el ejecutor, para crearlo de verdad, y el panel,
 * para la vista previa que el dueño mira antes de confirmar
 * (03/10/2026). Al salir de la misma función, lo que el dueño ve en la vista
 * previa es exactamente lo que se crea.
 *
 * Puro: no llama a nada. Los ids de Meta del material (hash de la foto, id
 * y miniatura del vídeo) llegan ya resueltos.
 */

import { PLACEMENTS, type AdCopy, type Cta, type Objective, type Placement } from "./actions.ts";
import type { MetaVars } from "./env.ts";

/** Los sitios de Instagram de cada pestaña, como los nombra Meta. */
export const POSITIONS: Record<Placement, string[]> = { feed: ["stream"], story: ["story"], reels: ["reels"] };

/** El enlace que Meta exige en un anuncio con formulario («sólo puede ser» este). */
export const LEAD_LINK = "https://fb.me/";

/**
 * Las mejoras automáticas de Meta, apagadas: el anuncio sale como lo
 * aprobó el dueño. Sólo estas cuatro claves se aceptan al escribir; cualquier
 * otra tira el creativo entero con un 400 (probado en otra cuenta, 10/09/2026).
 */
export const NO_ENHANCEMENTS = {
  creative_features_spec: Object.fromEntries(
    ["image_animation", "profile_card", "text_overlay_translation", "ig_video_native_subtitle"].map((k) => [
      k,
      { enroll_status: "OPT_OUT" },
    ]),
  ),
};

/**
 * Una foto para Meta: su hash en la biblioteca de la cuenta o, sólo en la
 * vista previa y mientras el ejecutor la sube, la dirección firmada del
 * panel desde la que Meta la descarga (así no hay que esperar al ejecutor,
 * que se despierta una vez por minuto). El anuncio de verdad va siempre
 * con hash.
 */
export type ImageRef = { hash: string } | { url: string };

/**
 * El material para Meta. Una foto puede traer, además, la de su recorte
 * para cada sitio de Instagram donde el dueño la recortó.
 */
export type ReadyMedia =
  | { kind: "image"; image: ImageRef; placements?: Partial<Record<Placement, ImageRef>> }
  | { kind: "video"; videoId: string; thumbnail: string };

/** Adónde lleva el anuncio y con qué botón, según el objetivo de su conjunto. */
export type Destination =
  | { kind: "web"; link: string; cta: Cta }
  | { kind: "direct" }
  | { kind: "profile"; url: string }
  /** Sin formId sólo en la vista previa: el formulario se crea al confirmar. */
  | { kind: "form"; formId: string | null; cta: Cta }
  | { kind: "none" };

export function linkOf(vars: MetaVars, path: string, campaignName: string): string {
  const slug = campaignName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${vars.SITE_URL}${path}?utm_source=meta&utm_medium=paid&utm_campaign=${slug}`;
}

export function destinationOf(
  vars: MetaVars,
  copy: AdCopy,
  campaignName: string,
  objective: Objective,
  formId: string | null,
  preview = false,
): Destination {
  if (objective === "messages") return { kind: "direct" };
  if (objective === "profile_visits") return { kind: "profile", url: `https://www.instagram.com/${vars.META_IG_USERNAME}` };
  if (objective === "leads_form") {
    if (!formId && !preview) throw new Error("esta campaña no tiene formulario de contactos");
    return { kind: "form", formId, cta: copy.cta ?? "SIGN_UP" };
  }
  if (copy.cta && copy.path) return { kind: "web", link: linkOf(vars, copy.path, campaignName), cta: copy.cta };
  return { kind: "none" };
}

/**
 * El botón de cada destino (guías de creativos de la Marketing API):
 * Direct con INSTAGRAM_MESSAGE y sin enlace; perfil con
 * VIEW_INSTAGRAM_PROFILE; formulario con su id y el enlace de Meta.
 */
export function ctaOf(d: Destination): Record<string, unknown> | undefined {
  switch (d.kind) {
    case "web":
      return { type: d.cta, value: { link: d.link } };
    case "direct":
      return { type: "INSTAGRAM_MESSAGE", value: { app_destination: "INSTAGRAM_DIRECT" } };
    case "profile":
      return { type: "VIEW_INSTAGRAM_PROFILE", value: { link: d.url } };
    case "form":
      return { type: d.cta, value: { link: LEAD_LINK, ...(d.formId ? { lead_gen_form_id: d.formId } : {}) } };
    default:
      return undefined;
  }
}

function linkOfDestination(d: Destination): string | undefined {
  if (d.kind === "web") return d.link;
  if (d.kind === "profile") return d.url;
  if (d.kind === "form") return LEAD_LINK;
  return undefined;
}

/**
 * El cuerpo del creativo, sin el `name`. `media` es null sólo para una
 * publicación de Instagram ya hecha, que sale con su propia foto y su texto.
 */
export function creativeOf(
  vars: MetaVars,
  copy: AdCopy,
  campaignName: string,
  objective: Objective,
  formId: string | null,
  media: ReadyMedia | null,
  preview = false,
): Record<string, unknown> {
  const dest = destinationOf(vars, copy, campaignName, objective, formId, preview);
  const cta = ctaOf(dest);
  if (copy.instagramMediaId) {
    // Una publicación que ya está en Instagram: sale tal cual, con su foto y
    // su texto (guía «use posts as ads»). En Direct, la guía pone el enlace
    // a Instagram en vez del destino.
    return {
      object_id: vars.META_PAGE_ID,
      instagram_user_id: vars.META_IG_USER_ID,
      source_instagram_media_id: copy.instagramMediaId,
      ...(dest.kind === "direct"
        ? { call_to_action: { type: "INSTAGRAM_MESSAGE", value: { link: "https://www.instagram.com" } } }
        : cta
          ? { call_to_action: cta }
          : {}),
      degrees_of_freedom_spec: NO_ENHANCEMENTS,
    };
  }
  if (!media) throw new Error("el material de este anuncio ya no está en el panel");
  if (media.kind === "image" && media.placements && Object.keys(media.placements).length > 0) {
    return byPlacement(vars, copy, dest, media.image, media.placements);
  }
  const link = linkOfDestination(dest);
  const story =
    media.kind === "video"
      ? {
          video_data: {
            video_id: media.videoId,
            image_url: media.thumbnail,
            message: copy.primaryText,
            title: copy.headline,
            ...(copy.description ? { link_description: copy.description } : {}),
            ...(cta ? { call_to_action: cta } : {}),
          },
        }
      : {
          link_data: {
            ...(link ? { link } : {}),
            message: copy.primaryText,
            name: copy.headline,
            ...(copy.description ? { description: copy.description } : {}),
            // Por URL sólo en la vista previa (ImageRef).
            ...("hash" in media.image ? { image_hash: media.image.hash } : { picture: media.image.url }),
            ...(cta ? { call_to_action: cta } : {}),
          },
        };
  return {
    object_story_spec: {
      page_id: vars.META_PAGE_ID,
      // Obligatorio para salir en Instagram: sin él el creativo se crea y
      // el anuncio falla después.
      instagram_user_id: vars.META_IG_USER_ID,
      ...story,
    },
    degrees_of_freedom_spec: NO_ENHANCEMENTS,
  };
}

/**
 * Una foto distinta para cada sitio de Instagram (03/10/2026): lo que
 * hace el Administrador de anuncios al elegir otra imagen por ubicación.
 * Cada foto lleva como etiqueta los sitios donde sale, y una regla por
 * sitio dice qué etiqueta usar. La vista previa elige el sitio con
 * `dynamic_asset_label` (probado: sin él, Meta dibuja Historias con la foto
 * del Feed).
 *
 * De momento sólo en anuncios que llevan a la web: los demás destinos
 * (Direct, perfil, formulario) no se pudieron probar contra Meta todavía.
 */
function byPlacement(
  vars: MetaVars,
  copy: AdCopy,
  dest: Destination,
  original: ImageRef,
  crops: Partial<Record<Placement, ImageRef>>,
): Record<string, unknown> {
  if (dest.kind !== "web") throw new Error("el recorte por sitio sólo vale, de momento, en anuncios que llevan a la web");
  // Cada foto distinta, con los sitios donde sale.
  const labels = new Map<string, { ref: ImageRef; places: Placement[] }>();
  for (const p of PLACEMENTS) {
    const ref = crops[p] ?? original;
    const id = "hash" in ref ? ref.hash : ref.url;
    const seen = labels.get(id) ?? { ref, places: [] };
    seen.places.push(p);
    labels.set(id, seen);
  }
  // El texto, el titular, la descripción y el enlace son los mismos en los
  // tres sitios, pero también llevan etiqueta y cada regla los nombra: si
  // la regla sólo nombra la foto, Meta dibuja Feed y Reels SIN texto
  // (probado con generatepreviews el 03/10/2026).
  const everywhere = PLACEMENTS.map((name) => ({ name }));
  return {
    object_story_spec: { page_id: vars.META_PAGE_ID, instagram_user_id: vars.META_IG_USER_ID },
    asset_feed_spec: {
      images: [...labels.values()].map(({ ref, places }) => ({ ...ref, adlabels: places.map((name) => ({ name })) })),
      bodies: [{ text: copy.primaryText, adlabels: everywhere }],
      titles: [{ text: copy.headline, adlabels: everywhere }],
      ...(copy.description ? { descriptions: [{ text: copy.description, adlabels: everywhere }] } : {}),
      link_urls: [{ website_url: dest.link, adlabels: everywhere }],
      call_to_action_types: [dest.cta],
      ad_formats: ["SINGLE_IMAGE"],
      optimization_type: "PLACEMENT",
      asset_customization_rules: PLACEMENTS.map((p, i) => ({
        customization_spec: { publisher_platforms: ["instagram"], instagram_positions: POSITIONS[p] },
        image_label: { name: p },
        body_label: { name: p },
        title_label: { name: p },
        ...(copy.description ? { description_label: { name: p } } : {}),
        link_url_label: { name: p },
        priority: i + 1,
      })),
    },
    degrees_of_freedom_spec: NO_ENHANCEMENTS,
  };
}

/** Si este creativo lleva una foto por sitio (y la vista previa tiene que elegir cuál). */
export function hasPlacements(creative: Record<string, unknown>): boolean {
  return "asset_feed_spec" in creative;
}
