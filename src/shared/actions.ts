/**
 * La lista cerrada de cosas que el panel puede hacerle a la cuenta de
 * anuncios del dueño.
 *
 * El modelo nunca escribe en Meta: rellena una de estas acciones, el
 * panel la valida y se la enseña al dueño en una tarjeta, y sólo cuando él
 * pulsa «Confirmar» el ejecutor (el Worker sin dirección en internet) la
 * aplica. El ejecutor vuelve a pasar `validate` con SUS topes, que viven
 * en su propia configuración: aunque alguien tomara el panel y escribiera
 * en la base una acción confirmada, no podría saltárselos.
 *
 * Este archivo no hace llamadas a nada. Es puro para que lo compartan los
 * dos Workers y los tests.
 */

export type Level = "campaign" | "adset" | "ad";
export type Cta = "SHOP_NOW" | "BUY_NOW" | "ORDER_NOW" | "LEARN_MORE" | "SIGN_UP" | "SUBSCRIBE" | "GET_QUOTE" | "APPLY_NOW";
/** Botones de un anuncio que lleva a la web. */
export const WEB_CTAS: Cta[] = ["SHOP_NOW", "BUY_NOW", "ORDER_NOW", "LEARN_MORE"];
/** Botones que Meta acepta en un anuncio con formulario (guía de anuncios de clientes potenciales). */
export const LEAD_CTAS: Cta[] = ["SIGN_UP", "LEARN_MORE", "GET_QUOTE", "APPLY_NOW", "SUBSCRIBE"];
export const CTAS: Cta[] = [...new Set([...WEB_CTAS, ...LEAD_CTAS])];

export type City = { key: string; name: string; radiusKm: number };
export type Interest = { id: string; name: string };
/** Un público personalizado ya creado en Meta, por su id. */
export type AudienceRef = { id: string; name: string };

/**
 * Los públicos personalizados que el panel sabe crear (lista cerrada).
 * Cada uno se recuerda lo máximo que deja Meta.
 */
export type AudienceKind = "web_visitors" | "web_checkout" | "web_buyers" | "ig_engaged";
export const AUDIENCE_KINDS: Record<AudienceKind, { name: string; what: string }> = {
  web_visitors: { name: "Visitantes de la web", what: "la gente que entró en la web" },
  web_checkout: { name: "Llegaron al pago", what: "la gente que empezó a pagar en la web" },
  web_buyers: { name: "Compradores web", what: "la gente que compró en la web" },
  ig_engaged: { name: "Interacción en Instagram", what: "la gente que interactuó con la cuenta de Instagram del negocio" },
};
/** Con esta marca en la descripción de Meta se reconoce un público del panel. */
export const audienceTag = (kind: AudienceKind): string => `panel:${kind}`;

/**
 * El objetivo de la campaña (todo lo del Administrador de
 * anuncios que tenga sentido sólo en Instagram). Cada uno es una fila de
 * la tabla de objetivos de Meta, validada contra la cuenta el 03/10/2026.
 */
export type Objective =
  | "sales"
  | "awareness"
  | "traffic"
  | "profile_visits"
  | "engagement"
  | "video_views"
  | "messages"
  | "leads_form";
/**
 * Los que llevan a la web: piden página y un botón de WEB_CTAS. Los demás
 * llevan a Instagram (perfil o Direct) o al formulario, y el botón lo pone
 * el ejecutor (o sale de LEAD_CTAS).
 */
export const WEB_OBJECTIVES: Objective[] = ["sales", "awareness", "traffic", "engagement", "video_views"];
/**
 * El objetivo de un conjunto que ya existe, a partir de lo que dice Meta
 * (para añadirle anuncios con el botón y el enlace que le tocan).
 */
export function objectiveFromMeta(campaignObjective?: string, destination?: string, goal?: string): Objective | null {
  switch (campaignObjective) {
    case "OUTCOME_SALES":
      return "sales";
    case "OUTCOME_AWARENESS":
      return "awareness";
    case "OUTCOME_TRAFFIC":
      return destination === "INSTAGRAM_PROFILE" ? "profile_visits" : "traffic";
    case "OUTCOME_ENGAGEMENT":
      if (destination === "INSTAGRAM_DIRECT") return "messages";
      return destination === "ON_VIDEO" || goal === "THRUPLAY" ? "video_views" : "engagement";
    case "OUTCOME_LEADS":
      return destination === "ON_AD" ? "leads_form" : null;
    default:
      return null;
  }
}
export const OBJECTIVES: Objective[] = [
  "sales",
  "awareness",
  "traffic",
  "profile_visits",
  "engagement",
  "video_views",
  "messages",
  "leads_form",
];

export type Audience = {
  ageMin: number;
  ageMax: number;
  /** Vacío o sin poner = todos. 1 hombres, 2 mujeres (así lo numera Meta). */
  genders?: (1 | 2)[];
  countries?: string[];
  cities?: City[];
  interests?: Interest[];
  /** Sólo a la gente de estos públicos personalizados. Sin poner: no se toca. */
  include?: AudienceRef[];
  /** Nunca a la gente de estos públicos. Sin poner: no se toca. */
  exclude?: AudienceRef[];
};

/**
 * Los tres sitios de Instagram donde sale un anuncio, que son
 * también las pestañas de la vista previa. Cada uno puede llevar su propio
 * recorte de la foto (03/10/2026).
 */
export type Placement = "feed" | "story" | "reels";
export const PLACEMENTS: Placement[] = ["feed", "story", "reels"];
export const PLACEMENT_ES: Record<Placement, string> = { feed: "Feed", story: "Historias", reels: "Reels" };
/** Las fotos recortadas en el panel: siempre JPG. */
export const CROP_KEY = /^img_[a-f0-9]{12}\.jpg$/;

export type AdCopy = {
  /**
   * La foto o el vídeo que el dueño subió para ESTE anuncio (clave en KV).
   * Cada anuncio tiene su propio material.
   */
  mediaKey?: string;
  /**
   * O, en vez de material subido, una publicación que ya está en
   * la cuenta de Instagram del negocio (su id de Instagram). Sale con su foto y su texto:
   * titular y texto no se usan.
   */
  instagramMediaId?: string;
  headline?: string;
  primaryText?: string;
  description?: string;
  /** Web: uno de WEB_CTAS; formulario: uno de LEAD_CTAS; perfil y Direct: lo pone el ejecutor. */
  cta?: Cta;
  /** Ruta dentro de la web, por ejemplo "/" o "/en/". Nunca otro dominio. Sólo en los objetivos de web. */
  path?: string;
  /**
   * Recortes propios de la foto por sitio de Instagram (clave en KV de la
   * versión recortada). Los pone el dueño desde la vista previa, no el modelo.
   * Un sitio sin recorte usa la foto original.
   */
  placements?: Partial<Record<Placement, string>>;
};

export type Action =
  | {
      type: "create_campaign";
      name: string;
      /** Sin poner (acciones viejas): ventas. */
      objective?: Objective;
      dailyBudgetEur: number;
      audience: Audience;
      ads: AdCopy[];
    }
  | { type: "create_audience"; kind: AudienceKind }
  | { type: "set_status"; level: Level; id: string; name: string; status: "ACTIVE" | "PAUSED" }
  | { type: "set_budget"; adSetId: string; name: string; dailyBudgetEur: number }
  | { type: "set_audience"; adSetId: string; name: string; audience: Audience }
  | {
      type: "add_ad";
      adSetId: string;
      name: string;
      ad: AdCopy;
      /** El del conjunto, que el panel lee de Meta; el ejecutor lo vuelve a leer. */
      objective?: Objective;
    }
  | {
      type: "update_ad_copy";
      adId: string;
      name: string;
      headline?: string;
      primaryText?: string;
      description?: string;
    };

export type Limits = {
  /** Tope de presupuesto diario de un conjunto, en euros. */
  maxAdSetDailyEur: number;
  /** Tope de la suma de presupuestos diarios de todo lo que está encendido. */
  maxAccountDailyEur: number;
  /** El único país donde vende el negocio (ISO, p. ej. ES). Sin él no pasa ningún público. */
  country?: string;
};

const ID = /^\d{5,25}$/;
const MAX_ADS = 5;

function checkAudience(a: Audience, errors: string[], country: string | undefined): void {
  if (!(Number.isInteger(a.ageMin) && a.ageMin >= 18 && a.ageMin <= 65)) errors.push("edad mínima entre 18 y 65");
  if (!(Number.isInteger(a.ageMax) && a.ageMax >= a.ageMin && a.ageMax <= 65)) errors.push("edad máxima entre la mínima y 65");
  const countries = a.countries ?? [];
  const cities = a.cities ?? [];
  if (countries.length === 0 && cities.length === 0) errors.push("falta la zona (país o ciudades)");
  // El negocio sólo vende en su país (COUNTRY). Las ciudades se
  // comprueban contra Meta en el panel y otra vez en el ejecutor.
  if (!country) errors.push("falta el país del negocio en la configuración (COUNTRY)");
  else for (const c of countries) if (c !== country) errors.push(`el negocio sólo vende en ${regionName(country)}: el país sólo puede ser ${country}, no ${c}`);
  for (const c of cities) {
    if (!c.key) errors.push(`ciudad sin clave de Meta: ${c.name}`);
    if (!(c.radiusKm >= 17 && c.radiusKm <= 80)) errors.push(`el radio de ${c.name} tiene que estar entre 17 y 80 km`);
  }
  for (const i of a.interests ?? []) if (!ID.test(i.id)) errors.push(`interés no válido: ${i.name}`);
  for (const g of a.genders ?? []) if (g !== 1 && g !== 2) errors.push("género no válido");
  for (const r of [...(a.include ?? []), ...(a.exclude ?? [])]) if (!ID.test(r.id)) errors.push(`público no válido: ${r.name}`);
  const included = new Set((a.include ?? []).map((r) => r.id));
  for (const r of a.exclude ?? []) if (included.has(r.id)) errors.push(`«${r.name}» no puede estar incluido y excluido a la vez`);
}

function checkCopy(c: AdCopy, objective: Objective, errors: string[]): void {
  if (!c.mediaKey === !c.instagramMediaId) errors.push("cada anuncio lleva material subido o una publicación de Instagram (una de las dos)");
  if (c.instagramMediaId !== undefined) {
    if (!ID.test(c.instagramMediaId)) errors.push("publicación de Instagram no válida");
    if (objective === "leads_form") errors.push("un anuncio con formulario no puede ser una publicación ya hecha: hace falta subir el material");
  } else {
    if (!c.headline || c.headline.length > 60) errors.push("el titular tiene que tener entre 1 y 60 caracteres");
    if (!c.primaryText || c.primaryText.length > 1500) errors.push("el texto tiene que tener entre 1 y 1500 caracteres");
  }
  if (c.description && c.description.length > 60) errors.push("la descripción no puede pasar de 60 caracteres");
  if (c.placements) {
    if (!c.mediaKey) errors.push("sólo se puede recortar una foto subida al panel");
    if (!WEB_OBJECTIVES.includes(objective) || !c.cta || !c.path) errors.push("el recorte por sitio sólo vale, de momento, en anuncios que llevan a la web");
    for (const [p, key] of Object.entries(c.placements)) {
      if (!PLACEMENTS.includes(p as Placement)) errors.push(`sitio de Instagram no válido: ${p}`);
      if (typeof key !== "string" || !CROP_KEY.test(key)) errors.push(`recorte no válido para ${p}`);
    }
  }
  if (WEB_OBJECTIVES.includes(objective)) {
    // Una publicación ya hecha puede salir sin botón; si lleva, va a la web.
    const needsLink = c.instagramMediaId === undefined || c.cta !== undefined || c.path !== undefined;
    if (needsLink) {
      if (!c.cta || !WEB_CTAS.includes(c.cta)) errors.push(`botón no válido para un anuncio que lleva a la web: ${c.cta ?? "ninguno"}`);
      if (!c.path || !c.path.startsWith("/") || c.path.startsWith("//")) errors.push("el enlace tiene que ser una página de la web");
    }
  } else if (objective === "leads_form") {
    if (!c.cta || !LEAD_CTAS.includes(c.cta)) errors.push(`botón no válido para un formulario: ${c.cta ?? "ninguno"} (vale ${LEAD_CTAS.join(", ")})`);
  }
}

function checkBudget(eur: number, limits: Limits, errors: string[]): void {
  if (!(Number.isFinite(eur) && eur >= 1)) errors.push("el presupuesto diario mínimo es 1 €");
  else if (eur > limits.maxAdSetDailyEur) errors.push(`el presupuesto diario no puede pasar de ${limits.maxAdSetDailyEur} €`);
  else if (Math.round(eur * 100) !== eur * 100) errors.push("el presupuesto va con dos decimales como mucho");
}

/** Devuelve la lista de problemas; vacía quiere decir que se puede aplicar. */
export function validate(action: Action, limits: Limits): string[] {
  const errors: string[] = [];
  switch (action.type) {
    case "create_campaign":
      if (!action.name.trim()) errors.push("falta el nombre de la campaña");
      if (action.objective !== undefined && !OBJECTIVES.includes(action.objective)) errors.push("objetivo no válido");
      checkBudget(action.dailyBudgetEur, limits, errors);
      checkAudience(action.audience, errors, limits.country);
      if (action.ads.length === 0 || action.ads.length > MAX_ADS) errors.push(`entre 1 y ${MAX_ADS} anuncios`);
      for (const ad of action.ads) checkCopy(ad, action.objective ?? "sales", errors);
      if (action.objective === "video_views" && action.ads.some((ad) => ad.instagramMediaId === undefined && !ad.mediaKey)) {
        errors.push("reproducciones de vídeo: cada anuncio lleva un vídeo");
      }
      break;
    case "create_audience":
      if (!(action.kind in AUDIENCE_KINDS)) errors.push("tipo de público no válido");
      break;
    case "set_status":
      if (!ID.test(action.id)) errors.push("identificador no válido");
      if (!["campaign", "adset", "ad"].includes(action.level)) errors.push("nivel no válido");
      if (action.status !== "ACTIVE" && action.status !== "PAUSED") errors.push("estado no válido");
      break;
    case "set_budget":
      if (!ID.test(action.adSetId)) errors.push("identificador no válido");
      checkBudget(action.dailyBudgetEur, limits, errors);
      break;
    case "set_audience":
      if (!ID.test(action.adSetId)) errors.push("identificador no válido");
      checkAudience(action.audience, errors, limits.country);
      break;
    case "add_ad":
      if (!ID.test(action.adSetId)) errors.push("identificador no válido");
      if (action.objective !== undefined && !OBJECTIVES.includes(action.objective)) errors.push("objetivo no válido");
      checkCopy(action.ad, action.objective ?? "sales", errors);
      break;
    case "update_ad_copy":
      if (!ID.test(action.adId)) errors.push("identificador no válido");
      if (action.headline === undefined && action.primaryText === undefined && action.description === undefined) {
        errors.push("no cambia nada");
      }
      if (action.headline !== undefined && (!action.headline || action.headline.length > 60)) errors.push("titular de 1 a 60 caracteres");
      if (action.primaryText !== undefined && (!action.primaryText || action.primaryText.length > 1500)) errors.push("texto de 1 a 1500 caracteres");
      if (action.description !== undefined && action.description.length > 60) errors.push("descripción de 60 caracteres como mucho");
      break;
    default:
      errors.push("acción desconocida");
  }
  return errors;
}

const LEVEL: Record<Level, string> = { campaign: "la campaña", adset: "el conjunto", ad: "el anuncio" };
const CTA_ES: Record<Cta, string> = {
  SHOP_NOW: "Comprar",
  BUY_NOW: "Comprar ya",
  ORDER_NOW: "Pedir ahora",
  LEARN_MORE: "Más información",
  SIGN_UP: "Registrarte",
  SUBSCRIBE: "Suscribirte",
  GET_QUOTE: "Pedir presupuesto",
  APPLY_NOW: "Solicitar",
};

const OBJECTIVE_ES: Record<Objective, string> = {
  sales: "Ventas (busca compradores)",
  awareness: "Reconocimiento (llegar a más gente)",
  traffic: "Tráfico (visitas a la web)",
  profile_visits: "Tráfico (visitas al perfil de Instagram)",
  engagement: "Interacción (me gusta, comentarios, guardados)",
  video_views: "Interacción (que vean el vídeo entero)",
  messages: "Interacción (mensajes por Instagram Direct)",
  leads_form: "Clientes potenciales (formulario en Instagram)",
};

/** El nombre de un país a partir de su código ISO, en castellano (FR → Francia). */
export function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(["es"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function eur(n: number): string {
  return `${n.toFixed(2).replace(".", ",").replace(",00", "")} €`;
}

export function describeAudience(a: Audience): string[] {
  const zone = [
    ...(a.countries ?? []).map((c) => regionName(c)),
    ...(a.cities ?? []).map((c) => `${c.name} (+${c.radiusKm} km)`),
  ].join(", ");
  const genders = !a.genders || a.genders.length !== 1 ? "todos" : a.genders[0] === 2 ? "mujeres" : "hombres";
  const lines = [
    `Zona: ${zone}`,
    `Edad: ${a.ageMin}–${a.ageMax} · Género: ${genders}`,
    "Dónde sale: Instagram (feed, historias y reels)",
  ];
  if (a.interests && a.interests.length > 0) lines.push(`Intereses: ${a.interests.map((i) => i.name).join(", ")}`);
  if (a.include && a.include.length > 0) lines.push(`Sólo a: ${a.include.map((r) => r.name).join(", ")}`);
  if (a.exclude && a.exclude.length > 0) lines.push(`Nunca a: ${a.exclude.map((r) => r.name).join(", ")}`);
  return lines;
}

function describeCopy(c: AdCopy, objective: Objective, n?: number): string[] {
  const label = n ? `Anuncio ${n}` : "Anuncio";
  const goesTo =
    objective === "messages"
      ? "botón Enviar mensaje → Instagram Direct"
      : objective === "profile_visits"
        ? "botón Ver perfil → tu perfil de Instagram"
        : objective === "leads_form"
          ? `botón ${CTA_ES[c.cta ?? "SIGN_UP"]} → formulario (nombre, correo y teléfono)`
          : c.cta && c.path
            ? `botón ${CTA_ES[c.cta]} → ${c.path}`
            : "sin botón";
  if (c.instagramMediaId) return [`${label}: la publicación de Instagram ${c.instagramMediaId}, con su foto y su texto · ${goesTo}`];
  const text = c.primaryText ?? "";
  const lines = [`${label}: «${c.headline}» · ${goesTo}`, `Texto: ${text.length > 140 ? `${text.slice(0, 140)}…` : text}`];
  const cropped = PLACEMENTS.filter((p) => c.placements?.[p]);
  if (cropped.length > 0) lines.push(`Foto recortada a mano para: ${cropped.map((p) => PLACEMENT_ES[p]).join(", ")}`);
  return lines;
}

/** Lo que se ve en la tarjeta: un título y el detalle, en castellano llano. */
export function describe(action: Action): { title: string; lines: string[] } {
  switch (action.type) {
    case "create_campaign":
      return {
        title: `Crear la campaña «${action.name}»`,
        lines: [
          `${OBJECTIVE_ES[action.objective ?? "sales"]} · ${eur(action.dailyBudgetEur)} al día`,
          ...describeAudience(action.audience),
          ...(action.objective === "leads_form" ? ["Formulario: nombre, correo y teléfono. Los contactos llegan al panel y a tu correo."] : []),
          ...action.ads.flatMap((ad, i) => describeCopy(ad, action.objective ?? "sales", action.ads.length > 1 ? i + 1 : undefined)),
          "Se crea APAGADA. Para que empiece a gastar hay que encenderla aparte.",
        ],
      };
    case "create_audience": {
      const k = AUDIENCE_KINDS[action.kind];
      return {
        title: `Crear el público «${k.name}»`,
        lines: [
          `Junta ${k.what}, durante el máximo de tiempo que deja Meta.`,
          "No gasta nada: sólo sirve para incluir o excluir a esa gente en las campañas.",
        ],
      };
    }
    case "set_status":
      return {
        title: `${action.status === "ACTIVE" ? "Encender" : "Pausar"} ${LEVEL[action.level]} «${action.name}»`,
        lines: action.status === "ACTIVE" ? ["Empieza a gastar en cuanto Meta lo apruebe."] : ["Deja de gastar en unos minutos."],
      };
    case "set_budget":
      return {
        title: `Presupuesto de «${action.name}»`,
        lines: [`Pasa a ${eur(action.dailyBudgetEur)} al día.`],
      };
    case "set_audience":
      return { title: `Cambiar el público de «${action.name}»`, lines: describeAudience(action.audience) };
    case "add_ad":
      return {
        title: `Añadir un anuncio a «${action.name}»`,
        lines: [...describeCopy(action.ad, action.objective ?? "sales"), "Se crea encendido dentro de su conjunto: gasta si la campaña está encendida."],
      };
    case "update_ad_copy": {
      const lines: string[] = [];
      if (action.headline !== undefined) lines.push(`Titular nuevo: «${action.headline}»`);
      if (action.primaryText !== undefined) lines.push(`Texto nuevo: ${action.primaryText}`);
      if (action.description !== undefined) lines.push(`Descripción nueva: ${action.description}`);
      lines.push("Meta vuelve a revisar el anuncio (suele tardar minutos).");
      return { title: `Cambiar el texto de «${action.name}»`, lines };
    }
  }
}
