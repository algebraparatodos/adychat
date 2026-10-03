/**
 * La configuración de la instalación, que comparten los dos Workers.
 *
 * Los identificadores de Meta van como variables normales: no son
 * secretos. Los tokens y la clave de OpenAI van con `wrangler secret put`.
 * Todo es de las cuentas del anunciante y nada viene escrito en el código:
 * los valores viven en wrangler.local.jsonc y wrangler.executor.local.jsonc,
 * fuera del repositorio.
 */

import type { Limits } from "./actions.ts";

// v21 caducó para la Marketing API el 09/09/2025 y Meta ya la atendía como
// v26 (cabecera x-ad-api-version-warning, comprobado el 30/09/2026). Cada
// versión dura ~1 año en la Marketing API: revisar el calendario en
// developers.facebook.com/docs/graph-api/changelog/versions.
export const GRAPH = "https://graph.facebook.com/v26.0";

export type MetaVars = {
  /** Con el prefijo `act_`. */
  META_ACCOUNT_ID: string;
  META_PAGE_ID: string;
  META_IG_USER_ID: string;
  /** El usuario de Instagram, sin @: el destino de los anuncios de visitas al perfil. */
  META_IG_USERNAME: string;
  META_PIXEL_ID: string;
  /** El nombre de la marca: va en los públicos que crea el panel, en el título y en las instrucciones del asistente. */
  BRAND_NAME: string;
  /** El único país donde vende, en ISO 3166 (p. ej. ES). Ningún público sale de ahí. */
  COUNTRY: string;
  /** Zona horaria del negocio (IANA). Sin poner: Europe/Madrid. */
  TIME_ZONE?: string;
  /** La página de privacidad de la web, para los formularios. Sin poner: /privacidad/. */
  PRIVACY_PATH?: string;
  /** https://example.com, sin barra final. */
  SITE_URL: string;
  MAX_ADSET_DAILY_EUR: string;
  MAX_ACCOUNT_DAILY_EUR: string;
  /**
   * Ley europea de servicios digitales (DSA): todo conjunto que se ve en
   * la UE dice a quién anuncia y quién paga. Sin estos dos campos Meta
   * rechaza el conjunto («No advertiser indicated», comprobado el
   * 03/10/2026). Anunciante: la marca; paga: el titular de la tienda.
   */
  META_DSA_BENEFICIARY: string;
  META_DSA_PAYOR: string;
};

export function limitsOf(vars: MetaVars): Limits {
  return {
    maxAdSetDailyEur: Number(vars.MAX_ADSET_DAILY_EUR) || 0,
    maxAccountDailyEur: Number(vars.MAX_ACCOUNT_DAILY_EUR) || 0,
    ...(vars.COUNTRY ? { country: vars.COUNTRY } : {}),
  };
}

/** Lo que falta por rellenar; mientras falte algo, no se escribe en Meta. */
export function missingMeta(vars: MetaVars): string[] {
  const missing: string[] = [];
  if (!/^act_\d+$/.test(vars.META_ACCOUNT_ID ?? "")) missing.push("META_ACCOUNT_ID");
  if (!/^\d+$/.test(vars.META_PAGE_ID ?? "")) missing.push("META_PAGE_ID");
  if (!/^\d+$/.test(vars.META_IG_USER_ID ?? "")) missing.push("META_IG_USER_ID");
  if (!/^[a-z0-9._]+$/.test(vars.META_IG_USERNAME ?? "")) missing.push("META_IG_USERNAME");
  if (!/^\d+$/.test(vars.META_PIXEL_ID ?? "")) missing.push("META_PIXEL_ID");
  if (!/^https:\/\/[^/]+$/.test(vars.SITE_URL ?? "")) missing.push("SITE_URL");
  if (!vars.META_DSA_BENEFICIARY?.trim()) missing.push("META_DSA_BENEFICIARY");
  if (!vars.META_DSA_PAYOR?.trim()) missing.push("META_DSA_PAYOR");
  if (!vars.BRAND_NAME?.trim()) missing.push("BRAND_NAME");
  if (!/^[A-Z]{2}$/.test(vars.COUNTRY ?? "")) missing.push("COUNTRY");
  const limits = limitsOf(vars);
  if (!(limits.maxAdSetDailyEur > 0)) missing.push("MAX_ADSET_DAILY_EUR");
  if (!(limits.maxAccountDailyEur > 0)) missing.push("MAX_ACCOUNT_DAILY_EUR");
  return missing;
}

/** La zona horaria del negocio: la de las fechas que se enseñan y la de los rangos que se le piden a Meta. */
export function timeZoneOf(vars: { TIME_ZONE?: string }): string {
  return vars.TIME_ZONE?.trim() || "Europe/Madrid";
}

/** El título del panel: la pestaña, la cabecera y el nombre en la app de autenticación. */
export function panelTitle(vars: { BRAND_NAME: string; PANEL_TITLE?: string }): string {
  return vars.PANEL_TITLE?.trim() || `ADS ${vars.BRAND_NAME ?? ""}`.trim();
}
