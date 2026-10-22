/**
 * Leer la cuenta de anuncios del dueño. Sólo GET, con el token de sólo
 * lectura: este archivo corre en el Worker que tiene dirección en
 * internet, y `test/boundary.test.ts` falla si alguien le añade un POST.
 */

import { AUDIENCE_KINDS, OBJECTIVE_ES, audienceTag, objectiveFromMeta, type AudienceKind, type Objective } from "../shared/actions.ts";
import { GRAPH } from "../shared/env.ts";

export class MetaReader {
  #token: string;
  readonly account: string;

  constructor(token: string, account: string) {
    this.#token = token;
    this.account = account;
  }

  async get<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      query.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    query.set("access_token", this.#token);
    const res = await fetch(`${GRAPH}/${path}?${query}`, { headers: { Accept: "application/json" } });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const err = (JSON.parse(text) as { error?: { message?: string; error_user_msg?: string } }).error;
        msg = err?.error_user_msg ?? err?.message ?? text;
      } catch {
        // se queda el texto tal cual
      }
      throw new Error(`Meta ${res.status}: ${msg.slice(0, 300)}`);
    }
    return JSON.parse(text) as T;
  }

  /** Una lista, siguiendo páginas. La cuenta del dueño es chica: con 5 sobra. */
  async list<T>(path: string, params: Record<string, unknown> = {}, maxPages = 5): Promise<T[]> {
    const rows: T[] = [];
    let page = await this.get<{ data?: T[]; paging?: { next?: string } }>(path, { limit: 100, ...params });
    rows.push(...(page.data ?? []));
    for (let i = 1; i < maxPages && page.paging?.next; i++) {
      const res = await fetch(page.paging.next);
      if (!res.ok) break;
      page = (await res.json()) as typeof page;
      rows.push(...(page.data ?? []));
    }
    return rows;
  }
}

const ALL_STATUSES = ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "DISAPPROVED"];

type Action = { action_type: string; value: string };
type InsightRow = {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  date_start?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  ctr?: string;
  cpm?: string;
  frequency?: string;
  actions?: Action[];
  action_values?: Action[];
};

/** Meta cuenta la compra dos veces con nombres distintos; se toma una. */
function pick(list: Action[] | undefined, types: string[]): number {
  for (const t of types) {
    const hit = list?.find((a) => a.action_type === t);
    if (hit) return Number(hit.value);
  }
  return 0;
}

const PURCHASE = ["offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase"];
const CHECKOUT = ["offsite_conversion.fb_pixel_initiate_checkout", "initiate_checkout"];

export type Metrics = {
  gasto: number;
  impresiones: number;
  alcance: number;
  clics_enlace: number;
  ctr: number;
  cpm: number;
  frecuencia: number;
  pedidos_iniciados: number;
  compras: number;
  ingresos: number;
  coste_por_compra: number | null;
  roas: number | null;
};

function metrics(r: InsightRow): Metrics {
  const gasto = Number(r.spend ?? 0);
  const compras = pick(r.actions, PURCHASE);
  const ingresos = pick(r.action_values, PURCHASE);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    gasto: round(gasto),
    impresiones: Number(r.impressions ?? 0),
    alcance: Number(r.reach ?? 0),
    clics_enlace: Number(r.inline_link_clicks ?? 0),
    ctr: round(Number(r.ctr ?? 0)),
    cpm: round(Number(r.cpm ?? 0)),
    frecuencia: round(Number(r.frequency ?? 0)),
    pedidos_iniciados: pick(r.actions, CHECKOUT),
    compras,
    ingresos: round(ingresos),
    coste_por_compra: compras > 0 ? round(gasto / compras) : null,
    roas: gasto > 0 ? round(ingresos / gasto) : null,
  };
}

const FIELDS =
  "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,inline_link_clicks,ctr,cpm,frequency,actions,action_values";

export type Range = { since: string; until: string };

export async function insights(
  meta: MetaReader,
  level: "account" | "campaign" | "adset" | "ad",
  range: Range,
  daily = false,
): Promise<(Metrics & { id?: string; nombre?: string; dia?: string })[]> {
  const rows = await meta.list<InsightRow>(`${meta.account}/insights`, {
    level,
    fields: FIELDS,
    time_range: range,
    ...(daily ? { time_increment: 1 } : {}),
  });
  return rows.map((r) => {
    const id = level === "campaign" ? r.campaign_id : level === "adset" ? r.adset_id : level === "ad" ? r.ad_id : undefined;
    const nombre = level === "campaign" ? r.campaign_name : level === "adset" ? r.adset_name : level === "ad" ? r.ad_name : undefined;
    return {
      ...(id ? { id } : {}),
      ...(nombre ? { nombre } : {}),
      ...(daily && r.date_start ? { dia: r.date_start } : {}),
      ...metrics(r),
    };
  });
}

type Campaign = { id: string; name: string; status: string; effective_status: string; created_time: string; objective?: string };
type AdSet = {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  campaign_id: string;
  destination_type?: string;
  optimization_goal?: string;
  daily_budget?: string;
  targeting?: Record<string, unknown>;
};
type Creative = {
  thumbnail_url?: string;
  object_story_spec?: {
    link_data?: { name?: string; message?: string; link?: string };
    video_data?: { title?: string; message?: string; call_to_action?: { value?: { link?: string } } };
  };
  asset_feed_spec?: { titles?: { text?: string }[]; bodies?: { text?: string }[]; link_urls?: { website_url?: string }[] };
  source_instagram_media_id?: string;
};
type Ad = {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  adset_id: string;
  ad_review_feedback?: Record<string, unknown>;
  creative?: Creative;
};

/**
 * El titular, el texto y el enlace de un anuncio, salga de donde salga: foto
 * (link_data), vídeo (video_data) o una foto por sitio (asset_feed_spec). Antes
 * sólo se leía la foto y los otros quedaban sin texto.
 */
export function adCopy(cr: Creative | undefined): { titular?: string; texto?: string; enlace?: string; publicacion_de_instagram?: boolean } {
  const ld = cr?.object_story_spec?.link_data;
  const vd = cr?.object_story_spec?.video_data;
  const af = cr?.asset_feed_spec;
  const out: { titular?: string; texto?: string; enlace?: string; publicacion_de_instagram?: boolean } = {};
  const titular = ld?.name ?? vd?.title ?? af?.titles?.[0]?.text;
  const texto = ld?.message ?? vd?.message ?? af?.bodies?.[0]?.text;
  const enlace = ld?.link ?? vd?.call_to_action?.value?.link ?? af?.link_urls?.[0]?.website_url;
  if (titular) out.titular = titular;
  if (texto) out.texto = texto;
  if (enlace) out.enlace = enlace;
  if (cr?.source_instagram_media_id) out.publicacion_de_instagram = true;
  return out;
}

/** Campañas → conjuntos → anuncios, con lo que el dueño necesita ver. */
export async function structure(meta: MetaReader, forScreen = false): Promise<unknown[]> {
  const filter = { effective_status: ALL_STATUSES };
  const [campaigns, adsets, ads] = await Promise.all([
    meta.list<Campaign>(`${meta.account}/campaigns`, { fields: "id,name,status,effective_status,created_time,objective", ...filter }),
    meta.list<AdSet>(`${meta.account}/adsets`, {
      fields: "id,name,status,effective_status,campaign_id,daily_budget,targeting,destination_type,optimization_goal",
      ...filter,
    }),
    meta.list<Ad>(`${meta.account}/ads`, {
      fields: "id,name,status,effective_status,adset_id,ad_review_feedback,creative{object_story_spec,asset_feed_spec,source_instagram_media_id,thumbnail_url}",
      ...filter,
    }),
  ]);
  return campaigns.map((c) => ({
    id: c.id,
    nombre: c.name,
    estado: c.status,
    estado_real: c.effective_status,
    creada: c.created_time.slice(0, 10),
    conjuntos: adsets
      .filter((s) => s.campaign_id === c.id)
      .map((s) => ({
        id: s.id,
        nombre: s.name,
        estado: s.status,
        estado_real: s.effective_status,
        presupuesto_diario_eur: s.daily_budget ? Number(s.daily_budget) / 100 : null,
        objetivo: objectiveFromMeta(c.objective, s.destination_type, s.optimization_goal) ?? c.objective ?? null,
        // Para la pantalla «Campañas creadas»; el modelo no lo necesita.
        ...(forScreen ? { objetivo_es: objectiveLabel(c.objective, s) } : {}),
        segmentacion: summarizeTargeting(s.targeting ?? {}),
        anuncios: ads
          .filter((a) => a.adset_id === s.id)
          .map((a) => ({
            id: a.id,
            nombre: a.name,
            estado: a.status,
            estado_real: a.effective_status,
            ...adCopy(a.creative),
            ...(forScreen && a.creative?.thumbnail_url ? { miniatura: a.creative.thumbnail_url } : {}),
            ...(a.ad_review_feedback ? { rechazo: a.ad_review_feedback } : {}),
          })),
      })),
  }));
}

function objectiveLabel(campaignObjective: string | undefined, s: AdSet): string | null {
  const o = objectiveFromMeta(campaignObjective, s.destination_type, s.optimization_goal);
  return o ? OBJECTIVE_ES[o] : (campaignObjective ?? null);
}

function summarizeTargeting(t: Record<string, unknown>): Record<string, unknown> {
  const geo = (t["geo_locations"] ?? {}) as { countries?: string[]; cities?: { key: string; name?: string; radius?: number }[] };
  const flex = (t["flexible_spec"] ?? []) as { interests?: { id: string; name: string }[] }[];
  return {
    paises: geo.countries ?? [],
    ciudades: (geo.cities ?? []).map((c) => ({ key: c.key, nombre: c.name, radio_km: c.radius })),
    edad: [t["age_min"], t["age_max"]],
    generos: t["genders"] ?? "todos",
    plataformas: t["publisher_platforms"] ?? "automáticas",
    intereses: flex.flatMap((f) => f.interests ?? []),
    solo_a: ((t["custom_audiences"] ?? []) as { id: string; name?: string }[]).map((c) => c.name ?? c.id),
    nunca_a: ((t["excluded_custom_audiences"] ?? []) as { id: string; name?: string }[]).map((c) => c.name ?? c.id),
  };
}

/** Sólo en el país del negocio (COUNTRY): no vende fuera. */
export async function searchLocations(meta: MetaReader, q: string, country: string): Promise<unknown[]> {
  const res = await meta.get<{ data?: { key: string; name: string; type: string; region?: string; country_code?: string }[] }>(
    "search",
    { type: "adgeolocation", q, country_code: country, location_types: ["city", "region"], limit: 8 },
  );
  return (res.data ?? []).map((d) => ({ key: d.key, nombre: d.name, tipo: d.type, region: d.region, pais: d.country_code }));
}

/** Las claves de ciudad que NO son del país del negocio (con su nombre, para decirlo). */
export async function citiesOutsideCountry(meta: MetaReader, keys: string[], country: string): Promise<string[]> {
  if (keys.length === 0) return [];
  const res = await meta.get<{ data?: { cities?: Record<string, { country_code?: string; name?: string }> } }>("search", {
    type: "adgeolocationmeta",
    cities: keys,
  });
  const found = res.data?.cities ?? {};
  return keys.filter((k) => found[k]?.country_code !== country).map((k) => found[k]?.name ?? k);
}

export async function searchInterests(meta: MetaReader, q: string): Promise<unknown[]> {
  const res = await meta.get<{ data?: { id: string; name: string; audience_size_lower_bound?: number; audience_size_upper_bound?: number; path?: string[] }[] }>(
    "search",
    { type: "adinterest", q, limit: 10, locale: "es_ES" },
  );
  return (res.data ?? []).map((d) => ({
    id: d.id,
    nombre: d.name,
    tamano: d.audience_size_lower_bound ? `${d.audience_size_lower_bound}–${d.audience_size_upper_bound}` : undefined,
    categoria: d.path?.join(" › "),
  }));
}

export type PanelAudience = {
  id: string;
  nombre: string;
  /** El tipo, si lo creó el panel. */
  tipo: AudienceKind | null;
  personas_aprox: number | null;
  /** false si Meta todavía no deja usarlo (demasiado chico, por ejemplo). */
  utilizable: boolean;
  estado: string;
};

/** Los públicos personalizados de la cuenta, con su tamaño. */
export async function audiences(meta: MetaReader): Promise<PanelAudience[]> {
  const rows = await meta.list<{
    id: string;
    name: string;
    description?: string;
    approximate_count_lower_bound?: number;
    operation_status?: { code?: number; description?: string };
    delivery_status?: { code?: number; description?: string };
  }>(`${meta.account}/customaudiences`, {
    fields: "id,name,description,approximate_count_lower_bound,operation_status,delivery_status",
  });
  const kinds = Object.keys(AUDIENCE_KINDS) as AudienceKind[];
  return rows.map((r) => {
    const count = r.approximate_count_lower_bound;
    return {
      id: r.id,
      nombre: r.name,
      tipo: kinds.find((k) => r.description === audienceTag(k)) ?? null,
      personas_aprox: typeof count === "number" && count >= 0 ? count : null,
      utilizable: r.operation_status?.code !== 300 && (r.delivery_status?.code ?? 200) === 200,
      estado: r.delivery_status?.description ?? r.operation_status?.description ?? "",
    };
  });
}

/** El objetivo de la campaña de un conjunto y a quién excluye hoy, para saber qué excluir. */
export async function adSetAudiences(
  meta: MetaReader,
  adSetId: string,
): Promise<{ objective: Objective | null; excluded: { id: string; name: string }[] }> {
  const r = await meta.get<{
    campaign?: { objective?: string };
    destination_type?: string;
    optimization_goal?: string;
    targeting?: { excluded_custom_audiences?: { id: string; name?: string }[] };
  }>(adSetId, { fields: "campaign{objective},destination_type,optimization_goal,targeting" });
  return {
    objective: objectiveFromMeta(r.campaign?.objective, r.destination_type, r.optimization_goal),
    excluded: (r.targeting?.excluded_custom_audiences ?? []).map((c) => ({ id: c.id, name: c.name ?? c.id })),
  };
}

/**
 * Las publicaciones de la cuenta de Instagram del negocio, para promocionar una que ya está
 * hecha. Necesita `instagram_basic` en el token de lectura:
 * sin él, Meta da error de permiso, que NO quiere decir que no haya.
 */
export async function instagramPosts(meta: MetaReader, igUserId: string): Promise<unknown[]> {
  const rows = await meta.list<{
    id: string;
    caption?: string;
    media_type?: string;
    permalink?: string;
    timestamp?: string;
    like_count?: number;
    comments_count?: number;
  }>(`${igUserId}/media`, { fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count", limit: 25 }, 1);
  return rows.map((m) => ({
    id: m.id,
    tipo: m.media_type === "VIDEO" ? "vídeo o reel" : m.media_type === "CAROUSEL_ALBUM" ? "carrusel" : "foto",
    fecha: m.timestamp?.slice(0, 10),
    texto: (m.caption ?? "").slice(0, 200),
    me_gusta: m.like_count,
    comentarios: m.comments_count,
    enlace: m.permalink,
  }));
}
