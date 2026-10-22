/**
 * Lo que el modelo puede hacer desde el chat.
 *
 * Dos clases de herramientas, y la diferencia es todo el diseño:
 *
 * - Las de LEER van a Meta con el token de sólo lectura y devuelven datos.
 * - Las de PROPONER no tocan Meta: validan la acción, la guardan como
 *   «propuesta» y el panel le enseña al dueño una tarjeta. Sólo su clic en
 *   «Confirmar» la pasa al ejecutor.
 */

import { AUDIENCE_KINDS, CTAS, OBJECTIVES, regionName, validate, type Action, type AdCopy, type Audience, type AudienceKind, type Level } from "../shared/actions.ts";
import { describe } from "../shared/actions.ts";
import { limitsOf, type MetaVars } from "../shared/env.ts";
import {
  MetaReader,
  audiences,
  citiesOutsideCountry,
  insights,
  instagramPosts,
  adSetAudiences,
  searchInterests,
  searchLocations,
  structure,
} from "./meta-read.ts";
import { listDrafts, type MediaEnv } from "./media.ts";
import { mismatch, whatIs } from "../shared/objects.ts";

export type ToolEnv = MetaVars & { DB: D1Database; META_TOKEN_READ: string };

const audienceRef = {
  type: "object",
  properties: { id: { type: "string" }, name: { type: "string" } },
  required: ["id", "name"],
};

const audienceSchema = {
  type: "object",
  properties: {
    ageMin: { type: "integer", minimum: 18, maximum: 65 },
    ageMax: { type: "integer", minimum: 18, maximum: 65 },
    genders: { type: "array", items: { type: "integer", enum: [1, 2] }, description: "1 hombres, 2 mujeres; vacío = todos" },
    countries: { type: "array", items: { type: "string" }, description: "Códigos ISO, p. ej. ES" },
    cities: {
      type: "array",
      items: {
        type: "object",
        properties: { key: { type: "string" }, name: { type: "string" }, radiusKm: { type: "integer", minimum: 17, maximum: 80 } },
        required: ["key", "name", "radiusKm"],
      },
      description: "La key sale de buscar_zona",
    },
    interests: {
      type: "array",
      items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } }, required: ["id", "name"] },
      description: "Los id salen de buscar_intereses",
    },
    include: {
      type: "array",
      items: audienceRef,
      description: "Sólo a la gente de estos públicos personalizados (de ver_publicos). Para la etapa caliente.",
    },
    exclude: {
      type: "array",
      items: audienceRef,
      description: "Nunca a estos públicos. Los compradores (y en reconocimiento o tráfico, también los visitantes) se excluyen solos.",
    },
  },
  required: ["ageMin", "ageMax"],
};

const adSchema = {
  type: "object",
  properties: {
    mediaKey: { type: "string", description: "La clave de una foto o un vídeo de ESE anuncio, de ver_material. O esto o instagramMediaId." },
    instagramMediaId: {
      type: "string",
      description: "En vez de material subido: el id de una publicación que ya está en Instagram (de ver_publicaciones). Sale con su foto y su texto; no lleva titular ni texto. No vale con formulario.",
    },
    headline: { type: "string", description: "Titular, 60 caracteres como mucho (con material subido)" },
    primaryText: { type: "string", description: "El texto principal del anuncio (con material subido)" },
    description: { type: "string" },
    cta: {
      type: "string",
      enum: CTAS,
      description: "Botón. Objetivos de web: SHOP_NOW, BUY_NOW, ORDER_NOW o LEARN_MORE. Formulario: SIGN_UP, LEARN_MORE, GET_QUOTE, APPLY_NOW o SUBSCRIBE. Mensajes y visitas al perfil: no se pone (lo pone el panel).",
    },
    path: { type: "string", description: "Sólo en objetivos de web: la página de la web a la que lleva, p. ej. /" },
  },
};

const range = {
  since: { type: "string", description: "AAAA-MM-DD" },
  until: { type: "string", description: "AAAA-MM-DD" },
};

export const TOOLS = [
  {
    name: "ver_campanas",
    description: "Las campañas de la cuenta con sus conjuntos (presupuesto, público) y anuncios (texto, estado, rechazos). Úsala antes de proponer cambios para tener los id.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "ver_resultados",
    description: "Resultados de un periodo: gasto, impresiones, clics, compras, ingresos, coste por compra, ROAS. Nivel cuenta, campaña, conjunto o anuncio; opcionalmente día a día.",
    parameters: {
      type: "object",
      properties: {
        level: { type: "string", enum: ["account", "campaign", "adset", "ad"] },
        ...range,
        daily: { type: "boolean" },
      },
      required: ["level", "since", "until"],
    },
  },
  {
    name: "buscar_zona",
    description: "Busca ciudades o regiones del país del negocio en Meta y devuelve su key para usarla en un público. El negocio sólo vende en su país: no hay zonas de otros países.",
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  },
  {
    name: "buscar_intereses",
    description: "Busca intereses de Meta (temas relacionados con lo que vende el negocio) con su tamaño.",
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  },
  {
    name: "ver_material",
    description: "Los anuncios que el dueño está preparando y el material (fotos y vídeos) que subió a cada uno, con su clave. Cada anuncio usa SU material.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "ver_acciones",
    description: "Las últimas acciones propuestas y en qué quedaron (esperando, aplicada, falló y por qué).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "ver_publicaciones",
    description: "Las últimas publicaciones de la cuenta de Instagram del negocio (id, tipo, fecha, texto, me gusta), para promocionar una que ya funciona.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "ver_contactos",
    description: "Los contactos que dejaron su nombre, correo y teléfono en los formularios de las campañas de clientes potenciales, los más nuevos primero.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "ver_publicos",
    description: "Los públicos personalizados de la cuenta (visitantes de la web, llegaron al pago, compradores, interacción en Instagram) con su id, su tamaño aproximado y si Meta ya deja usarlos.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "proponer_crear_publico",
    description: "Propone crear uno de los públicos personalizados del panel. No gasta nada. Se recuerda lo máximo que deja Meta.",
    parameters: {
      type: "object",
      properties: { kind: { type: "string", enum: Object.keys(AUDIENCE_KINDS) } },
      required: ["kind"],
    },
  },
  {
    name: "proponer_campana",
    description:
      "Propone crear una campaña con un conjunto y de 1 a 5 anuncios. Se crea apagada. Objetivo: sales (ventas, por compra), awareness (reconocimiento, por alcance), traffic (visitas a la web), profile_visits (visitas al perfil de Instagram), engagement (interacción con el anuncio), video_views (que vean el vídeo; sólo vídeos), messages (mensajes por Instagram Direct) o leads_form (formulario de contacto en Instagram: nombre, correo y teléfono).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        objective: { type: "string", enum: OBJECTIVES },
        dailyBudgetEur: { type: "number", description: "La cifra que dijo el dueño. Nunca una que propongas tú." },
        audience: audienceSchema,
        ads: { type: "array", items: adSchema, minItems: 1, maxItems: 5 },
      },
      required: ["name", "objective", "dailyBudgetEur", "audience", "ads"],
    },
  },
  {
    name: "proponer_estado",
    description: "Propone encender (ACTIVE) o pausar (PAUSED) una campaña, conjunto o anuncio. Encender una campaña nueva es encender su campaña.",
    parameters: {
      type: "object",
      properties: {
        level: { type: "string", enum: ["campaign", "adset", "ad"] },
        id: { type: "string" },
        name: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "PAUSED"] },
      },
      required: ["level", "id", "name", "status"],
    },
  },
  {
    name: "proponer_presupuesto",
    description: "Propone cambiar el presupuesto diario de un conjunto a la cifra que dijo el dueño.",
    parameters: {
      type: "object",
      properties: {
        adSetId: { type: "string" },
        name: { type: "string" },
        dailyBudgetEur: { type: "number", description: "La cifra que dijo el dueño. Nunca una que propongas tú." },
      },
      required: ["adSetId", "name", "dailyBudgetEur"],
    },
  },
  {
    name: "proponer_publico",
    description: "Propone reemplazar el público (zona, edad, género, intereses, públicos incluidos y excluidos) de un conjunto. Hay que mandar el público completo, no sólo lo que cambia; si no mandas include/exclude, se quedan los que tenía.",
    parameters: {
      type: "object",
      properties: { adSetId: { type: "string" }, name: { type: "string" }, audience: audienceSchema },
      required: ["adSetId", "name", "audience"],
    },
  },
  {
    name: "proponer_anuncio",
    description: "Propone añadir un anuncio nuevo a un conjunto que ya existe. El botón y el enlace van según el objetivo del conjunto (míralo en ver_campanas).",
    parameters: {
      type: "object",
      properties: { adSetId: { type: "string" }, name: { type: "string" }, ad: adSchema },
      required: ["adSetId", "name", "ad"],
    },
  },
  {
    name: "proponer_texto",
    description: "Propone cambiar el titular, el texto o la descripción de un anuncio (Meta lo vuelve a revisar).",
    parameters: {
      type: "object",
      properties: {
        adId: { type: "string" },
        name: { type: "string" },
        headline: { type: "string" },
        primaryText: { type: "string" },
        description: { type: "string" },
      },
      required: ["adId", "name"],
    },
  },
] as const;

const PROPOSE: Record<string, Action["type"]> = {
  proponer_crear_publico: "create_audience",
  proponer_campana: "create_campaign",
  proponer_estado: "set_status",
  proponer_presupuesto: "set_budget",
  proponer_publico: "set_audience",
  proponer_anuncio: "add_ad",
  proponer_texto: "update_ad_copy",
};

function code(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

function copiesOf(action: Action): AdCopy[] {
  if (action.type === "create_campaign") return action.ads;
  if (action.type === "add_ad") return [action.ad];
  return [];
}

/**
 * Exclusiones automáticas (criterio aprobado el 02/10/2026): los
 * compradores no ven nunca un anuncio, y una campaña de reconocimiento o de
 * tráfico (la etapa fría) tampoco se gasta en quien ya visitó la web.
 */
async function autoExclude(env: ToolEnv, action: Action): Promise<void> {
  if (action.type !== "create_campaign" && action.type !== "set_audience") return;
  if (!env.META_TOKEN_READ || !env.META_ACCOUNT_ID) return;
  const meta = new MetaReader(env.META_TOKEN_READ, env.META_ACCOUNT_ID);
  let cold: boolean;
  let exclude = action.audience.exclude;
  if (action.type === "create_campaign") {
    cold = action.objective === "awareness" || action.objective === "traffic";
  } else {
    const now = await adSetAudiences(meta, action.adSetId);
    cold = now.objective === "awareness" || now.objective === "traffic";
    // Sin exclusiones en la propuesta, se parte de las que ya tiene.
    exclude ??= now.excluded;
  }
  const kinds: AudienceKind[] = cold ? ["web_buyers", "web_visitors"] : ["web_buyers"];
  const mine = (await audiences(meta)).filter((a) => a.tipo && kinds.includes(a.tipo));
  if (mine.length === 0) return;
  const next = [...(exclude ?? [])];
  const included = new Set((action.audience.include ?? []).map((r) => r.id));
  for (const a of mine) {
    if (!included.has(a.id) && !next.some((r) => r.id === a.id)) next.push({ id: a.id, name: a.nombre });
  }
  action.audience.exclude = next;
}

/** El objeto de Meta que toca una acción sobre algo que ya existe, y qué tiene que ser. */
function targetOf(action: Action): { id: string; level: Level } | null {
  switch (action.type) {
    case "set_status":
      return { id: action.id, level: action.level };
    case "set_budget":
    case "set_audience":
    case "add_ad":
      return { id: action.adSetId, level: "adset" };
    case "update_ad_copy":
      return { id: action.adId, level: "ad" };
    default:
      return null;
  }
}

async function propose(env: ToolEnv, type: Action["type"], args: Record<string, unknown>, chatId: number): Promise<unknown> {
  const action = { ...args, type } as Action;
  if (action.type === "create_campaign" || action.type === "set_audience") {
    // Sin género o con los dos quiere decir «todos».
    const a = action.audience as Audience;
    if (a.genders && a.genders.length !== 1) delete a.genders;
    await autoExclude(env, action);
  }
  if (action.type === "add_ad" && /^\d{5,25}$/.test(action.adSetId) && env.META_TOKEN_READ && env.META_ACCOUNT_ID) {
    // El botón y el enlace dependen del objetivo del conjunto: se lee de Meta.
    const now = await adSetAudiences(new MetaReader(env.META_TOKEN_READ, env.META_ACCOUNT_ID), action.adSetId);
    if (now.objective) action.objective = now.objective;
    else delete action.objective;
  }
  const errors = validate(action, limitsOf(env));
  if (action.type === "create_audience" && env.META_TOKEN_READ && env.META_ACCOUNT_ID) {
    const already = (await audiences(new MetaReader(env.META_TOKEN_READ, env.META_ACCOUNT_ID))).find((a) => a.tipo === action.kind);
    if (already) errors.push(`ese público ya existe: «${already.nombre}» (id ${already.id}); mira ver_publicos`);
  }
  const objective = action.type === "create_campaign" || action.type === "add_ad" ? (action.objective ?? "sales") : null;
  for (const copy of copiesOf(action)) {
    if (!copy.mediaKey) continue;
    // Sólo material de esta conversación: el de otra es de otra campaña.
    const m = await env.DB.prepare(
      `select m.kind as kind from media m join ad_drafts d on d.id = m.draft_id where m.key = ? and m.complete = 1 and m.variant_of is null and d.chat_id = ?`,
    )
      .bind(copy.mediaKey, chatId)
      .first<{ kind: string }>();
    if (!m) errors.push(`el material ${copy.mediaKey} no existe en esta conversación o no terminó de subirse; mira ver_material`);
    else if (objective === "video_views" && m.kind !== "video") errors.push(`reproducciones de vídeo: ${copy.mediaKey} es una foto; hace falta un vídeo`);
  }
  if ((action.type === "create_campaign" || action.type === "set_audience") && env.META_TOKEN_READ && env.META_ACCOUNT_ID) {
    const cities = ((action.audience as Audience).cities ?? []).map((c) => c.key);
    const abroad = await citiesOutsideCountry(new MetaReader(env.META_TOKEN_READ, env.META_ACCOUNT_ID), cities, env.COUNTRY);
    if (abroad.length > 0) errors.push(`el negocio sólo vende en ${regionName(env.COUNTRY)} y esto no lo es: ${abroad.join(", ")}. Busca la zona otra vez con buscar_zona.`);
  }
  // El id, el nivel y el nombre los escribió el modelo: se le pregunta a Meta
  // qué es de verdad. La tarjeta lleva el nombre y el presupuesto de Meta;
  // el ejecutor lo vuelve a comprobar al aplicar (22/10/2026).
  const target = targetOf(action);
  if (target && errors.length === 0) {
    if (!env.META_TOKEN_READ || !env.META_ACCOUNT_ID) errors.push("la cuenta de Meta todavía no está conectada al panel");
    else {
      const meta = new MetaReader(env.META_TOKEN_READ, env.META_ACCOUNT_ID);
      const obj = await whatIs((path, params) => meta.get(path, params), env.META_ACCOUNT_ID, target.id);
      const wrong = mismatch(obj, target.id, target.level);
      if (wrong || !obj) errors.push(`${wrong ?? "no está en la cuenta"}; mira ver_campanas`);
      else {
        (action as { name: string }).name = obj.name;
        if (action.type === "set_status" || action.type === "set_budget") action.seen = { dailyEur: obj.dailyEur, status: obj.status };
      }
    }
  }
  if (errors.length > 0) return { error: "no se puede proponer así", problemas: errors };

  const card = describe(action);
  const c = code();
  await env.DB.prepare(`insert into actions (code, chat_id, type, title, lines, payload) values (?, ?, ?, ?, ?, ?)`)
    .bind(c, chatId, action.type, card.title, JSON.stringify(card.lines), JSON.stringify(action))
    .run();
  return {
    propuesta: c,
    estado: "esperando que el dueño pulse Confirmar en la tarjeta. Todavía NO está hecho.",
  };
}

/** Ejecuta una herramienta; nunca lanza, el error vuelve al modelo como dato. */
export async function runTool(
  env: ToolEnv,
  name: string,
  args: Record<string, unknown>,
  proposed: string[],
  chatId: number,
): Promise<unknown> {
  try {
    const type = PROPOSE[name];
    if (type) {
      const out = await propose(env, type, args, chatId);
      const c = (out as { propuesta?: string }).propuesta;
      if (c) proposed.push(c);
      return out;
    }

    if (name === "ver_material") return await listDrafts(env as unknown as MediaEnv, chatId);
    if (name === "ver_contactos") {
      const rows = await env.DB.prepare(
        `select full_name as nombre, email as correo, phone as telefono, campaign_name as campana, created_time as cuando, fields as otras_respuestas
           from leads order by created_time desc limit 50`,
      ).all();
      return { contactos: rows.results ?? [], nota: "Cada contacto nuevo también le llega al dueño por correo." };
    }
    if (name === "ver_acciones") {
      const rows = await env.DB.prepare(
        `select code, title, state, state_at, error, result from actions order by id desc limit 15`,
      ).all();
      return rows.results ?? [];
    }

    if (!env.META_TOKEN_READ || !env.META_ACCOUNT_ID) {
      return { error: "la cuenta de Meta todavía no está conectada al panel" };
    }
    const meta = new MetaReader(env.META_TOKEN_READ, env.META_ACCOUNT_ID);
    switch (name) {
      case "ver_campanas":
        return await structure(meta);
      case "ver_resultados":
        return await insights(
          meta,
          args["level"] as "account" | "campaign" | "adset" | "ad",
          { since: String(args["since"]), until: String(args["until"]) },
          Boolean(args["daily"]),
        );
      case "ver_publicos":
        return await audiences(meta);
      case "ver_publicaciones":
        try {
          return await instagramPosts(meta, env.META_IG_USER_ID);
        } catch (err) {
          // Sin instagram_basic Meta da error de permiso: eso no quiere decir
          // que no haya publicaciones.
          return {
            error: `todavía no puedo leer las publicaciones de Instagram (falta el permiso instagram_basic en el acceso de lectura del panel). No quiere decir que no haya. Detalle: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
          };
        }
      case "buscar_zona":
        return await searchLocations(meta, String(args["q"] ?? ""), env.COUNTRY);
      case "buscar_intereses":
        return await searchInterests(meta, String(args["q"] ?? ""));
      default:
        return { error: `herramienta desconocida: ${name}` };
    }
  } catch (err) {
    return { error: String(err instanceof Error ? err.message : err).slice(0, 400) };
  }
}
