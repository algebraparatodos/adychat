/**
 * El único código que escribe en la cuenta de anuncios del dueño.
 *
 * Corre dentro del ejecutor, el Worker que tiene el token con
 * `ads_management` y ningún `fetch`: no hay forma de llegar a él desde
 * internet. Las tres reglas de meta-ads-agent siguen valiendo:
 *
 * 1. Lista cerrada: sólo las acciones de `shared/actions.ts`.
 * 2. Releer siempre: Meta contesta `success` a cambios que ignora, así que
 *    algo no está hecho hasta que se vuelve a leer y el valor está.
 * 3. Guardar el valor anterior, para poder deshacer a mano.
 *
 * El texto se manda como formulario con `charset=UTF-8`: por otro camino
 * el «·» llegó a Meta roto en otra cuenta y no se puede recuperar.
 */

import type { Action, AdCopy, Audience, AudienceKind, Limits, Objective, Placement } from "../shared/actions.ts";
import { AUDIENCE_KINDS, audienceTag, objectiveFromMeta, regionName, validate } from "../shared/actions.ts";
import { NO_ENHANCEMENTS, creativeOf, destinationOf, type ReadyMedia } from "../shared/creative.ts";
import { GRAPH, limitsOf, type MetaVars } from "../shared/env.ts";

export type MediaInfo = {
  kind: "image" | "video";
  name: string;
  /** Foto: su hash en Meta si ya se subió. */
  metaHash: string | null;
  /** Vídeo: su id en Meta si ya se subió. */
  metaVideoId: string | null;
};

export type Ctx = MetaVars & {
  token: string;
  media: (key: string) => Promise<MediaInfo | null>;
  /** Los bytes de una foto, en base64. */
  imageBase64: (key: string) => Promise<string | null>;
  /** Una dirección pública, firmada y con caducidad, desde la que Meta descarga el vídeo. */
  videoUrl: (key: string) => Promise<string>;
  rememberHash: (key: string, hash: string) => Promise<void>;
  rememberVideo: (key: string, videoId: string) => Promise<void>;
  /** Apunta un formulario de contactos (y su campaña, cuando ya existe) para ir bajando sus contactos. */
  rememberForm: (formId: string, campaignName: string, campaignId: string | null) => Promise<void>;
  /** El formulario de una campaña de clientes potenciales, para añadirle anuncios. */
  formOfCampaign: (campaignId: string) => Promise<string | null>;
  /** Para los tests: cuánto esperar entre dos consultas a Meta. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Meta todavía está procesando un vídeo. No es un fallo: la acción vuelve
 * a la cola y el ejecutor la retoma en el minuto siguiente, sin volver a
 * subir el vídeo (su id ya quedó guardado).
 */
export class NotReady extends Error {}

export type Outcome = {
  ok: boolean;
  /** true: todavía no se puede terminar (vídeo en proceso); reintentar. */
  retry?: boolean;
  result: unknown;
  undo: unknown;
  error: string | null;
};

class MetaError extends Error {}

async function graph(ctx: Ctx, path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  let response: Response;
  if (body) {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
    form.set("access_token", ctx.token);
    response = await fetch(`${GRAPH}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: form,
    });
  } else {
    const sep = path.includes("?") ? "&" : "?";
    response = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(ctx.token)}`);
  }
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    // El mensaje de Meta que le sirve a una persona está en error_user_msg;
    // si no hay, el técnico. El token nunca viene en el cuerpo.
    const err = (data["error"] ?? {}) as Record<string, unknown>;
    const msg = String(err["error_user_msg"] ?? err["message"] ?? text).slice(0, 300);
    throw new MetaError(`Meta ${response.status}: ${msg}`);
  }
  return data;
}

const cents = (eur: number): number => Math.round(eur * 100);

/**
 * El negocio sólo vende en su país (COUNTRY). Una clave de ciudad no
 * dice de qué país es («Gavà» sin filtro devuelve primero un Gava de
 * Kirguistán), así que se le pregunta a Meta, aunque la acción venga
 * confirmada.
 */
export async function outsideCountry(ctx: Ctx, a: Audience): Promise<string | null> {
  const keys = (a.cities ?? []).map((c) => c.key);
  if (keys.length === 0) return null;
  const res = await graph(ctx, `search?type=adgeolocationmeta&cities=${encodeURIComponent(JSON.stringify(keys))}`);
  const found = ((res["data"] ?? {}) as { cities?: Record<string, { country_code?: string; name?: string }> }).cities ?? {};
  const bad = keys.filter((k) => found[k]?.country_code !== ctx.COUNTRY);
  return bad.length > 0
    ? `el negocio sólo vende en ${regionName(ctx.COUNTRY)} y esta zona no lo es: ${bad.map((k) => found[k]?.name ?? k).join(", ")}`
    : null;
}

/**
 * La segmentación entera. Advantage se apaga en DOS campos: con uno solo,
 * Meta enciende la expansión por su cuenta al crear el conjunto
 * (aprendido en otra cuenta).
 */
export function targetingOf(a: Audience, objective?: Objective): Record<string, unknown> {
  const geo: Record<string, unknown> = {};
  if (a.countries && a.countries.length > 0) geo["countries"] = a.countries;
  if (a.cities && a.cities.length > 0) {
    geo["cities"] = a.cities.map((c) => ({ key: c.key, radius: c.radiusKm, distance_unit: "kilometer" }));
  }
  const t: Record<string, unknown> = {
    geo_locations: geo,
    age_min: a.ageMin,
    age_max: a.ageMax,
    targeting_automation: { advantage_audience: 0 },
    targeting_relaxation_types: { lookalike: 0, custom_audience: 0 },
    // SÓLO Instagram, siempre. No depende de lo que pida
    // nadie por chat. Sin `explore`: la API ya no lo acepta (desde v21).
    publisher_platforms: ["instagram"],
    instagram_positions: ["stream", "story", "reels"],
  };
  // Con formulario, Meta no deja juntar ordenador e Instagram (referencia
  // de conjuntos, LEAD_GENERATION): sólo móvil.
  if (objective === "leads_form") t["device_platforms"] = ["mobile"];
  if (a.genders && a.genders.length === 1) t["genders"] = a.genders;
  if (a.interests && a.interests.length > 0) {
    t["flexible_spec"] = [{ interests: a.interests.map((i) => ({ id: i.id, name: i.name })) }];
  }
  if (a.include && a.include.length > 0) t["custom_audiences"] = a.include.map((r) => ({ id: r.id }));
  if (a.exclude && a.exclude.length > 0) t["excluded_custom_audiences"] = a.exclude.map((r) => ({ id: r.id }));
  return t;
}

async function imageHash(ctx: Ctx, key: string, info: MediaInfo): Promise<string> {
  if (info.metaHash) return info.metaHash;
  const base64 = await ctx.imageBase64(key);
  if (!base64) throw new MetaError(`la foto ${info.name} no está en el panel`);
  const res = await graph(ctx, `${ctx.META_ACCOUNT_ID}/adimages`, { bytes: base64, name: info.name });
  const images = (res["images"] ?? {}) as Record<string, { hash?: string }>;
  const hash = Object.values(images)[0]?.hash;
  if (!hash) throw new MetaError("Meta no devolvió el hash de la foto");
  await ctx.rememberHash(key, hash);
  return hash;
}

const wait = (ctx: Ctx, ms: number) => (ctx.sleep ?? ((t: number) => new Promise<void>((r) => setTimeout(r, t))))(ms);

/**
 * Sube el vídeo (una sola vez) y espera a que Meta lo tenga listo. Meta lo
 * descarga él mismo de una dirección firmada del panel: así el ejecutor no
 * trocea nada ni gasta sus peticiones. Devuelve el id y la miniatura que
 * Meta eligió, que el creativo necesita.
 */
async function videoReady(ctx: Ctx, key: string, info: MediaInfo): Promise<{ videoId: string; thumbnail: string }> {
  let videoId = info.metaVideoId;
  if (!videoId) {
    const res = await graph(ctx, `${ctx.META_ACCOUNT_ID}/advideos`, {
      file_url: await ctx.videoUrl(key),
      name: info.name,
    });
    videoId = String(res["id"] ?? "");
    if (!videoId) throw new MetaError("Meta no devolvió el id del vídeo");
    await ctx.rememberVideo(key, videoId);
  }
  for (let i = 0; i < 12; i++) {
    const st = await graph(ctx, `${videoId}?fields=status`);
    const status = (st["status"] ?? {}) as { video_status?: string; processing_progress?: number };
    if (status.video_status === "ready") {
      const th = await graph(ctx, `${videoId}/thumbnails?fields=uri,is_preferred`);
      const list = (th["data"] ?? []) as { uri?: string; is_preferred?: boolean }[];
      const pick = list.find((t) => t.is_preferred) ?? list[0];
      if (!pick?.uri) throw new MetaError("Meta procesó el vídeo pero no dio ninguna miniatura");
      return { videoId, thumbnail: pick.uri };
    }
    if (status.video_status === "error") throw new MetaError("Meta no pudo procesar el vídeo; prueba con otro archivo (MP4 o MOV)");
    await wait(ctx, 5000);
  }
  throw new NotReady("Meta sigue procesando el vídeo");
}

/**
 * Presubida (03/10/2026): el material se sube a la biblioteca de la
 * cuenta en cuanto el dueño lo adjunta, sin esperar a que confirme, para que
 * el panel pueda pedirle a Meta la vista previa. Subir no publica nada ni
 * gasta. Un vídeo se deja procesando: el panel pregunta su estado y el
 * creativo, al confirmar, espera a que esté listo (videoReady).
 */
export async function preupload(ctx: Ctx, key: string, info: MediaInfo): Promise<void> {
  if (info.kind === "image") {
    await imageHash(ctx, key, info);
    return;
  }
  if (info.metaVideoId) return;
  const res = await graph(ctx, `${ctx.META_ACCOUNT_ID}/advideos`, { file_url: await ctx.videoUrl(key), name: info.name });
  const videoId = String(res["id"] ?? "");
  if (!videoId) throw new MetaError("Meta no devolvió el id del vídeo");
  await ctx.rememberVideo(key, videoId);
}

async function createAd(
  ctx: Ctx,
  adSetId: string,
  copy: AdCopy,
  campaignName: string,
  name: string,
  status: "ACTIVE" | "PAUSED",
  objective: Objective,
  formId: string | null,
): Promise<{ adId: string; creativeId: string }> {
  // El destino primero: sin formulario no se sube nada.
  const dest = destinationOf(ctx, copy, campaignName, objective, formId);
  let media: ReadyMedia | null = null;
  if (!copy.instagramMediaId) {
    const info = copy.mediaKey ? await ctx.media(copy.mediaKey) : null;
    if (!info || !copy.mediaKey) throw new MetaError("el material de este anuncio ya no está en el panel");
    if (objective === "video_views" && info.kind !== "video") throw new MetaError("reproducciones de vídeo: este anuncio no es un vídeo");
    if (info.kind === "video") {
      if (copy.placements) throw new MetaError("un vídeo no se puede recortar por sitio");
      media = { kind: "video", ...(await videoReady(ctx, copy.mediaKey, info)) };
    } else {
      // Los recortes por sitio que el dueño hizo en la vista previa.
      const placements: Partial<Record<Placement, string>> = {};
      for (const [p, key] of Object.entries(copy.placements ?? {}) as [Placement, string][]) {
        const crop = await ctx.media(key);
        if (!crop || crop.kind !== "image") throw new MetaError(`el recorte para ${p} ya no está en el panel`);
        placements[p] = await imageHash(ctx, key, crop);
      }
      media = { kind: "image", hash: await imageHash(ctx, copy.mediaKey, info), ...(copy.placements ? { placements } : {}) };
    }
  }
  // La misma función que dibuja la vista previa en el panel (shared/creative.ts).
  const creativeBody = { name, ...creativeOf(ctx, copy, campaignName, objective, formId, media) };
  const creative = await graph(ctx, `${ctx.META_ACCOUNT_ID}/adcreatives`, creativeBody);
  const creativeId = String(creative["id"]);
  const ad = await graph(ctx, `${ctx.META_ACCOUNT_ID}/ads`, {
    name,
    adset_id: adSetId,
    creative: { creative_id: creativeId },
    status,
    // Explícitos cuando lleva a la web: un anuncio hecho por API puede nacer
    // sin píxel ni dominio aunque el conjunto los tenga (meta-ads-agent).
    ...(dest.kind === "web"
      ? {
          conversion_domain: new URL(ctx.SITE_URL).hostname,
          tracking_specs: [{ "action.type": ["offsite_conversion"], fb_pixel: [ctx.META_PIXEL_ID] }],
        }
      : {}),
  });
  return { adId: String(ad["id"]), creativeId };
}

/**
 * El formulario de contactos de una campaña de clientes potenciales: nombre,
 * correo y teléfono, con la privacidad de la tienda. Se crea con el token de
 * la página (guía de anuncios de clientes potenciales) y queda apuntado para
 * que el ejecutor baje los contactos.
 */
async function createLeadForm(ctx: Ctx, campaignName: string): Promise<string> {
  const page = await graph(ctx, `${ctx.META_PAGE_ID}?fields=access_token`);
  const pageToken = String(page["access_token"] ?? "");
  if (!pageToken) throw new MetaError("Meta no dio el acceso a la página para crear el formulario");
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const form = await graph({ ...ctx, token: pageToken }, `${ctx.META_PAGE_ID}/leadgen_forms`, {
    name: `${campaignName} · ${stamp}`,
    locale: "ES_ES",
    questions: [{ type: "FULL_NAME" }, { type: "EMAIL" }, { type: "PHONE" }],
    privacy_policy: { url: `${ctx.SITE_URL}${ctx.PRIVACY_PATH?.trim() || "/privacidad/"}`, link_text: "Política de privacidad" },
    follow_up_action_url: ctx.SITE_URL,
    thank_you_page: {
      title: "¡Gracias!",
      body: "Te escribiremos muy pronto.",
      button_type: "VIEW_WEBSITE",
      button_text: "Ver la tienda",
      website_url: ctx.SITE_URL,
    },
  });
  const formId = String(form["id"] ?? "");
  if (!formId) throw new MetaError("Meta no devolvió el id del formulario");
  await ctx.rememberForm(formId, campaignName, null);
  return formId;
}

/**
 * Deja listo en Meta todo el material de los anuncios ANTES de crear nada.
 * Si un vídeo todavía se está procesando, sale con NotReady sin haber
 * creado ni campaña ni conjunto: al reintentar no queda nada duplicado.
 */
async function prepareMedia(ctx: Ctx, copies: AdCopy[]): Promise<void> {
  for (const copy of copies) {
    if (!copy.mediaKey) continue;
    const info = await ctx.media(copy.mediaKey);
    if (!info) throw new MetaError("el material de un anuncio ya no está en el panel");
    if (info.kind === "video") await videoReady(ctx, copy.mediaKey, info);
    else await imageHash(ctx, copy.mediaKey, info);
    // Los recortes por sitio también, antes de crear nada.
    for (const key of Object.values(copy.placements ?? {})) {
      const crop = await ctx.media(key);
      if (!crop || crop.kind !== "image") throw new MetaError("un recorte de la foto ya no está en el panel");
      await imageHash(ctx, key, crop);
    }
  }
}

/**
 * Lo que cada objetivo le pide a Meta: una fila de la tabla de objetivos de
 * rendimiento de la referencia de conjuntos (v26). Cada combinación pasó
 * `validate_only` contra la cuenta del dueño el 03/10/2026.
 */
function goalOf(ctx: Ctx, objective: Objective): { campaign: string; adSet: Record<string, unknown> } {
  const page = { page_id: ctx.META_PAGE_ID };
  switch (objective) {
    case "awareness":
      return { campaign: "OUTCOME_AWARENESS", adSet: { optimization_goal: "REACH", promoted_object: page } };
    case "traffic":
      return {
        campaign: "OUTCOME_TRAFFIC",
        adSet: { optimization_goal: "LANDING_PAGE_VIEWS", destination_type: "WEBSITE" },
      };
    case "profile_visits":
      return {
        campaign: "OUTCOME_TRAFFIC",
        // PROFILE_VISIT es el que usa la guía de visitas al perfil de
        // Instagram; VISIT_INSTAGRAM_PROFILE también pasa la validación.
        adSet: { optimization_goal: "PROFILE_VISIT", destination_type: "INSTAGRAM_PROFILE" },
      };
    case "engagement":
      return { campaign: "OUTCOME_ENGAGEMENT", adSet: { optimization_goal: "POST_ENGAGEMENT", destination_type: "ON_POST" } };
    case "video_views":
      return { campaign: "OUTCOME_ENGAGEMENT", adSet: { optimization_goal: "THRUPLAY", destination_type: "ON_VIDEO" } };
    case "messages":
      return {
        campaign: "OUTCOME_ENGAGEMENT",
        adSet: { optimization_goal: "CONVERSATIONS", destination_type: "INSTAGRAM_DIRECT", promoted_object: page },
      };
    case "leads_form":
      return {
        campaign: "OUTCOME_LEADS",
        adSet: { optimization_goal: "LEAD_GENERATION", destination_type: "ON_AD", promoted_object: page },
      };
    default:
      return {
        campaign: "OUTCOME_SALES",
        adSet: {
          optimization_goal: "OFFSITE_CONVERSIONS",
          promoted_object: { pixel_id: ctx.META_PIXEL_ID, custom_event_type: "PURCHASE" },
        },
      };
  }
}

async function createCampaign(ctx: Ctx, a: Extract<Action, { type: "create_campaign" }>): Promise<Outcome> {
  const created: Record<string, unknown> = {};
  try {
    await prepareMedia(ctx, a.ads);
    const objective = a.objective ?? "sales";
    const formId = objective === "leads_form" ? await createLeadForm(ctx, a.name) : null;
    if (formId) created["formId"] = formId;

    const goal = goalOf(ctx, objective);
    const campaign = await graph(ctx, `${ctx.META_ACCOUNT_ID}/campaigns`, {
      name: a.name,
      objective: goal.campaign,
      // Nace apagada y es el único interruptor: el conjunto y los anuncios
      // se crean encendidos, así encenderla es un solo paso.
      status: "PAUSED",
      special_ad_categories: [],
      buying_type: "AUCTION",
      // Obligatorio con el presupuesto en el conjunto. En false el tope
      // diario es exactamente el que se pone.
      is_adset_budget_sharing_enabled: false,
    });
    created["campaignId"] = String(campaign["id"]);
    if (formId) await ctx.rememberForm(formId, a.name, String(created["campaignId"]));

    const adSet = await graph(ctx, `${ctx.META_ACCOUNT_ID}/adsets`, {
      name: `${a.name} · conjunto`,
      campaign_id: created["campaignId"],
      daily_budget: cents(a.dailyBudgetEur),
      billing_event: "IMPRESSIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      ...goal.adSet,
      targeting: targetingOf(a.audience, objective),
      dsa_beneficiary: ctx.META_DSA_BENEFICIARY,
      dsa_payor: ctx.META_DSA_PAYOR,
      status: "ACTIVE",
    });
    created["adSetId"] = String(adSet["id"]);

    const ads: string[] = [];
    for (const [i, copy] of a.ads.entries()) {
      const { adId } = await createAd(ctx, String(created["adSetId"]), copy, a.name, `${a.name} · ${i + 1}`, "ACTIVE", objective, formId);
      ads.push(adId);
      created["adIds"] = ads;
    }

    // Releer: que exista, que siga apagada y que el conjunto tenga el
    // presupuesto que se pidió.
    const back = await graph(ctx, `${created["adSetId"]}?fields=daily_budget,campaign{status}`);
    const budgetOk = Number(back["daily_budget"]) === cents(a.dailyBudgetEur);
    const stillPaused = (back["campaign"] as { status?: string } | undefined)?.status === "PAUSED";
    if (!budgetOk || !stillPaused) {
      return { ok: false, result: created, undo: null, error: "Meta la creó pero al releerla no coincide el presupuesto o el estado" };
    }
    return { ok: true, result: created, undo: null, error: null };
  } catch (err) {
    if (err instanceof NotReady && Object.keys(created).filter((k) => k !== "formId").length === 0) {
      return { ok: false, retry: true, result: null, undo: null, error: err.message };
    }
    // Lo creado a medias queda apuntado (y apagado: la campaña nace en
    // pausa), para poder borrarlo desde el Administrador de anuncios.
    return { ok: false, result: created, undo: null, error: String(err instanceof Error ? err.message : err) };
  }
}

type AdSetRow = { id: string; status: string; daily_budget?: string; campaign?: { id: string; status: string } };

/**
 * Lo que costaría al día todo lo encendido si se hace este cambio. Un
 * conjunto sólo gasta si él y su campaña están encendidos.
 */
async function projectedDailyEur(
  ctx: Ctx,
  change: { level: "campaign" | "adset"; id: string; status?: string; budgetEur?: number },
): Promise<number> {
  const res = await graph(
    ctx,
    `${ctx.META_ACCOUNT_ID}/adsets?fields=id,status,daily_budget,campaign{id,status}&limit=200` +
      `&effective_status=${encodeURIComponent(JSON.stringify(["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW"]))}`,
  );
  const rows = (res["data"] ?? []) as AdSetRow[];
  let total = 0;
  for (const r of rows) {
    let adSetStatus = r.status;
    let campaignStatus = r.campaign?.status ?? "PAUSED";
    let budget = Number(r.daily_budget ?? 0) / 100;
    if (change.level === "adset" && r.id === change.id) {
      if (change.status) adSetStatus = change.status;
      if (change.budgetEur !== undefined) budget = change.budgetEur;
    }
    if (change.level === "campaign" && r.campaign?.id === change.id && change.status) campaignStatus = change.status;
    if (adSetStatus === "ACTIVE" && campaignStatus === "ACTIVE") total += budget;
  }
  return total;
}

async function checkAccountCap(
  ctx: Ctx,
  limits: Limits,
  change: Parameters<typeof projectedDailyEur>[1],
): Promise<string | null> {
  const projected = await projectedDailyEur(ctx, change);
  if (projected > limits.maxAccountDailyEur) {
    return `con este cambio lo encendido gastaría ${projected.toFixed(2)} € al día y el tope de la cuenta es ${limits.maxAccountDailyEur} €`;
  }
  return null;
}

const DAY = 86400;
/**
 * Lo máximo que Meta deja recordar a cada público. La
 * documentación de públicos web da 365 días como máximo y 180 en otro
 * campo: se pide 365 y, si Meta lo rechaza, 180.
 */
const WEB_DAYS = [365, 180];
const IG_DAYS = [730];
const WEB_EVENT: Record<Exclude<AudienceKind, "ig_engaged">, string> = {
  web_visitors: "PageView",
  web_checkout: "InitiateCheckout",
  web_buyers: "Purchase",
};

function ruleOf(ctx: Ctx, kind: AudienceKind, days: number): Record<string, unknown> {
  const ig = kind === "ig_engaged";
  return {
    inclusions: {
      operator: "or",
      rules: [
        {
          event_sources: [ig ? { id: ctx.META_IG_USER_ID, type: "ig_business" } : { id: ctx.META_PIXEL_ID, type: "pixel" }],
          retention_seconds: days * DAY,
          filter: {
            operator: "and",
            filters: [{ field: "event", operator: "eq", value: ig ? "ig_business_profile_all" : WEB_EVENT[kind] }],
          },
        },
      ],
    },
  };
}

async function createAudience(ctx: Ctx, a: Extract<Action, { type: "create_audience" }>): Promise<Outcome> {
  const tag = audienceTag(a.kind);
  // Si ya existe (por ejemplo, confirmado dos veces), no se duplica.
  const list = await graph(ctx, `${ctx.META_ACCOUNT_ID}/customaudiences?fields=id,description&limit=200`);
  const existing = ((list["data"] ?? []) as { id: string; description?: string }[]).find((r) => r.description === tag);
  if (existing) return { ok: true, result: { audienceId: existing.id, existed: true }, undo: null, error: null };

  let made: Record<string, unknown> | null = null;
  let days = 0;
  let lastError = "";
  for (const d of a.kind === "ig_engaged" ? IG_DAYS : WEB_DAYS) {
    try {
      made = await graph(ctx, `${ctx.META_ACCOUNT_ID}/customaudiences`, {
        name: `${ctx.BRAND_NAME} · ${AUDIENCE_KINDS[a.kind].name}`,
        description: tag,
        rule: ruleOf(ctx, a.kind, d),
        // Junta también a la gente de antes de crearlo, hasta donde deja Meta.
        prefill: true,
      });
      days = d;
      break;
    } catch (err) {
      lastError = String(err instanceof Error ? err.message : err);
    }
  }
  if (!made) return { ok: false, result: null, undo: null, error: lastError };
  const id = String(made["id"] ?? "");
  const back = await graph(ctx, `${id}?fields=id,description`);
  const applied = back["description"] === tag;
  return {
    ok: applied,
    result: { audienceId: id, days },
    undo: null,
    error: applied ? null : "Meta creó el público y al releerlo no coincide",
  };
}

/** Por debajo de esto un público no se enciende: Meta casi no tiene a quién enseñarle el anuncio. */
export const MIN_AUDIENCE = 100;

/**
 * La etapa caliente no se enciende hasta que su público llegue a unas 100
 * personas (criterio aprobado el 02/10/2026). Mira los públicos
 * incluidos en lo que se va a encender; Meta marca con 300 los que son
 * demasiado chicos para usarse.
 */
async function tooSmall(ctx: Ctx, level: "campaign" | "adset", id: string): Promise<string | null> {
  const adsets =
    level === "adset"
      ? [await graph(ctx, `${id}?fields=targeting`)]
      : (((await graph(ctx, `${id}/adsets?fields=targeting&limit=200`))["data"] ?? []) as Record<string, unknown>[]);
  const ids = new Set<string>();
  for (const s of adsets) {
    const t = (s["targeting"] ?? {}) as { custom_audiences?: { id: string }[] };
    for (const c of t.custom_audiences ?? []) ids.add(c.id);
  }
  const small: string[] = [];
  for (const aid of ids) {
    const r = await graph(ctx, `${aid}?fields=name,approximate_count_lower_bound,operation_status`);
    const count = Number(r["approximate_count_lower_bound"] ?? -1);
    const op = (r["operation_status"] ?? {}) as { code?: number };
    if (count < MIN_AUDIENCE || op.code === 300) {
      small.push(`«${String(r["name"] ?? aid)}» (${count < 0 ? "Meta todavía no da el tamaño" : `unas ${count} personas`})`);
    }
  }
  return small.length > 0
    ? `todavía no se enciende: estos públicos no llegan a ${MIN_AUDIENCE} personas: ${small.join(", ")}`
    : null;
}

async function setField(ctx: Ctx, id: string, field: string, value: unknown): Promise<Outcome> {
  const before = await graph(ctx, `${id}?fields=${field}`);
  await graph(ctx, id, { [field]: value });
  const after = await graph(ctx, `${id}?fields=${field}`);
  const applied = String(after[field]) === String(value);
  return {
    ok: applied,
    result: { id, [field]: after[field] },
    undo: { id, [field]: before[field] },
    error: applied ? null : `Meta aceptó el cambio y al releer ${field} sigue en ${String(after[field])}`,
  };
}

async function setAudience(ctx: Ctx, a: Extract<Action, { type: "set_audience" }>): Promise<Outcome> {
  // Se manda la segmentación entera: Meta reemplaza el campo, no lo
  // mezcla. Los públicos personalizados que tuviera se conservan.
  const before = await graph(ctx, `${a.adSetId}?fields=targeting`);
  const old = (before["targeting"] ?? {}) as Record<string, unknown>;
  const next = targetingOf(a.audience);
  // Sólo móvil en los de formulario: se conserva lo que tenía.
  if (old["device_platforms"]) next["device_platforms"] = old["device_platforms"];
  // Los públicos personalizados que no vienen en la acción se conservan.
  if (a.audience.include === undefined && old["custom_audiences"]) next["custom_audiences"] = old["custom_audiences"];
  if (a.audience.exclude === undefined && old["excluded_custom_audiences"]) {
    next["excluded_custom_audiences"] = old["excluded_custom_audiences"];
  }
  await graph(ctx, a.adSetId, { targeting: next });
  const after = await graph(ctx, `${a.adSetId}?fields=targeting`);
  const t = (after["targeting"] ?? {}) as Record<string, unknown>;
  const applied = t["age_min"] === a.audience.ageMin && t["age_max"] === a.audience.ageMax;
  return {
    ok: applied,
    result: { adSetId: a.adSetId, targeting: t },
    undo: { adSetId: a.adSetId, targeting: old },
    error: applied ? null : "Meta aceptó el público y al releerlo no coincide",
  };
}

async function updateCopy(ctx: Ctx, a: Extract<Action, { type: "update_ad_copy" }>): Promise<Outcome> {
  // Un creativo no se edita: se crea otro con el texto nuevo y se le pone
  // al anuncio. Se copia el que había para no perder foto, enlace ni botón.
  const ad = await graph(ctx, `${a.adId}?fields=name,creative{id,object_story_spec}`);
  const creative = (ad["creative"] ?? {}) as { id?: string; object_story_spec?: Record<string, unknown> };
  const spec = structuredClone(creative.object_story_spec ?? {});
  const link = (spec["link_data"] ?? null) as Record<string, unknown> | null;
  if (!link) return { ok: false, result: null, undo: null, error: "este anuncio no es de foto con enlace; se cambia desde Meta" };
  if (a.headline !== undefined) link["name"] = a.headline;
  if (a.primaryText !== undefined) link["message"] = a.primaryText;
  if (a.description !== undefined) link["description"] = a.description;
  // Al leer, Meta devuelve la foto con más campos de los que acepta al
  // escribir; con el hash basta.
  delete link["picture"];
  delete link["image_crops"];
  const fresh = await graph(ctx, `${ctx.META_ACCOUNT_ID}/adcreatives`, {
    name: `${String(ad["name"])} · texto ${new Date().toISOString().slice(0, 10)}`,
    object_story_spec: spec,
    degrees_of_freedom_spec: NO_ENHANCEMENTS,
  });
  await graph(ctx, a.adId, { creative: { creative_id: String(fresh["id"]) } });
  const after = await graph(ctx, `${a.adId}?fields=creative{id}`);
  const nowId = (after["creative"] as { id?: string } | undefined)?.id;
  const applied = nowId === String(fresh["id"]);
  return {
    ok: applied,
    result: { adId: a.adId, creativeId: nowId },
    undo: { adId: a.adId, creativeId: creative.id },
    error: applied ? null : "Meta aceptó el texto nuevo y el anuncio sigue con el creativo anterior",
  };
}

/**
 * Aplica una acción confirmada. Antes vuelve a validarla con los topes de
 * ESTE Worker, que no se pueden cambiar desde el panel.
 */
export async function apply(action: Action, ctx: Ctx): Promise<Outcome> {
  const limits = limitsOf(ctx);
  const problems = validate(action, limits);
  if (problems.length > 0) return { ok: false, result: null, undo: null, error: problems.join("; ") };

  try {
    switch (action.type) {
      case "create_campaign": {
        const abroad = await outsideCountry(ctx, action.audience);
        if (abroad) return { ok: false, result: null, undo: null, error: abroad };
        return await createCampaign(ctx, action);
      }

      case "create_audience":
        return await createAudience(ctx, action);

      case "set_status": {
        if (action.status === "ACTIVE" && action.level !== "ad") {
          const small = await tooSmall(ctx, action.level, action.id);
          if (small) return { ok: false, result: null, undo: null, error: small };
          const over = await checkAccountCap(ctx, limits, { level: action.level, id: action.id, status: "ACTIVE" });
          if (over) return { ok: false, result: null, undo: null, error: over };
        }
        return await setField(ctx, action.id, "status", action.status);
      }

      case "set_budget": {
        const over = await checkAccountCap(ctx, limits, { level: "adset", id: action.adSetId, budgetEur: action.dailyBudgetEur });
        if (over) return { ok: false, result: null, undo: null, error: over };
        return await setField(ctx, action.adSetId, "daily_budget", cents(action.dailyBudgetEur));
      }

      case "set_audience": {
        const abroad = await outsideCountry(ctx, action.audience);
        if (abroad) return { ok: false, result: null, undo: null, error: abroad };
        return await setAudience(ctx, action);
      }

      case "add_ad": {
        // El objetivo se lee de Meta, no de la acción: es el del conjunto.
        const adSet = await graph(ctx, `${action.adSetId}?fields=destination_type,optimization_goal,campaign{id,name,objective}`);
        const camp = (adSet["campaign"] ?? {}) as { id?: string; name?: string; objective?: string };
        const objective = objectiveFromMeta(camp.objective, adSet["destination_type"] as string | undefined, adSet["optimization_goal"] as string | undefined);
        if (!objective) return { ok: false, result: null, undo: null, error: `el panel no sabe añadir anuncios a un conjunto de tipo ${camp.objective ?? "desconocido"}` };
        const again = validate({ ...action, objective }, limits);
        if (again.length > 0) return { ok: false, result: null, undo: null, error: again.join("; ") };
        const formId = objective === "leads_form" && camp.id ? await ctx.formOfCampaign(camp.id) : null;
        const campaignName = camp.name ?? action.name;
        const label = action.ad.headline ?? `publicación ${action.ad.instagramMediaId}`;
        const made = await createAd(ctx, action.adSetId, action.ad, campaignName, `${campaignName} · ${label}`, "ACTIVE", objective, formId);
        return { ok: true, result: made, undo: null, error: null };
      }

      case "update_ad_copy":
        return await updateCopy(ctx, action);

      default:
        return { ok: false, result: null, undo: null, error: "el ejecutor no sabe hacer esta acción" };
    }
  } catch (err) {
    // add_ad: el vídeo se prepara antes del creativo, que es lo primero que
    // se crea, así que reintentar tampoco duplica nada.
    if (err instanceof NotReady) return { ok: false, retry: true, result: null, undo: null, error: err.message };
    return { ok: false, result: null, undo: null, error: String(err instanceof Error ? err.message : err) };
  }
}
