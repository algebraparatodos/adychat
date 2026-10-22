/**
 * Qué es de verdad un id de Meta, preguntado a Meta (22/10/2026).
 *
 * Las acciones sobre algo que ya existe (encender, pausar, presupuesto,
 * público, anuncio nuevo, texto) traen un id y un nombre que escribió el
 * modelo. Ninguno de los dos se cree: con el id de una campaña y el nivel
 * «anuncio», el ejecutor encendía la campaña sin mirar el tope de la
 * cuenta, y la tarjeta que confirma el dueño enseñaba el nombre inventado.
 *
 * Se busca el id en las campañas, los conjuntos y los anuncios DE LA
 * CUENTA configurada: así sale a la vez el nivel real y que es de esa
 * cuenta. Sólo GET: lo usan el panel (token de lectura) y el ejecutor.
 */

import type { Level } from "./actions.ts";

/** Un GET a la Graph API: `params` va en la dirección, sin el token. */
export type GraphGet = (path: string, params: Record<string, string>) => Promise<Record<string, unknown>>;

export type MetaObject = {
  level: Level;
  id: string;
  /** El nombre que tiene en Meta, no el que escribió el modelo. */
  name: string;
  status: string;
  /**
   * Lo que puede gastar al día, en euros: su presupuesto o, si no tiene, el
   * que lo gobierna (el de su conjunto, el de su campaña o la suma de los
   * conjuntos de la campaña). null: no se sabe (presupuesto total).
   */
  dailyEur: number | null;
  /** Él o lo que lo gobierna tiene presupuesto total en vez de diario. */
  lifetimeBudget: boolean;
};

export const LEVEL_ES: Record<Level, string> = { campaign: "una campaña", adset: "un conjunto de anuncios", ad: "un anuncio" };

/** Todos los estados menos borrado y archivado, con los nombres que acepta cada lista. */
const STATUSES: Record<Level, string[]> = {
  campaign: ["ACTIVE", "PAUSED", "IN_PROCESS", "WITH_ISSUES"],
  adset: ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "IN_PROCESS", "WITH_ISSUES"],
  ad: ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO", "IN_PROCESS", "WITH_ISSUES"],
};
const EDGE: Record<Level, string> = { campaign: "campaigns", adset: "adsets", ad: "ads" };
const BUDGET = "daily_budget,lifetime_budget";
const FIELDS: Record<Level, string> = {
  campaign: `id,name,status,${BUDGET}`,
  adset: `id,name,status,${BUDGET},campaign{id,${BUDGET}}`,
  ad: `id,name,status,adset{id,${BUDGET}},campaign{id,${BUDGET}}`,
};

type Row = {
  id?: string;
  name?: string;
  status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  campaign?: { id?: string; daily_budget?: string; lifetime_budget?: string };
  adset?: { id?: string; daily_budget?: string; lifetime_budget?: string };
};

const eurOf = (cents: string | undefined): number => Number(cents ?? 0) / 100;
const has = (cents: string | undefined): boolean => Number(cents ?? 0) > 0;

/** Qué es `id` en la cuenta `account`, o null si no está en ella. */
export async function whatIs(get: GraphGet, account: string, id: string): Promise<MetaObject | null> {
  const levels: Level[] = ["campaign", "adset", "ad"];
  const found = await Promise.all(
    levels.map(async (level) => {
      const res = await get(`${account}/${EDGE[level]}`, {
        fields: FIELDS[level],
        filtering: JSON.stringify([{ field: "id", operator: "IN", value: [id] }]),
        effective_status: JSON.stringify(STATUSES[level]),
        limit: "2",
      });
      const row = ((res["data"] ?? []) as Row[]).find((r) => r.id === id);
      return row ? { level, row } : null;
    }),
  );
  const hits = found.filter((f): f is { level: Level; row: Row } => f !== null);
  // Un id es una sola cosa; si Meta lo diera en dos listas, no se adivina.
  if (hits.length !== 1) return null;
  const { level, row } = hits[0]!;

  let dailyEur: number | null = null;
  let lifetimeBudget = false;
  const own = level === "ad" ? row.adset : row;
  if (has(own?.lifetime_budget) || has(row.campaign?.lifetime_budget)) lifetimeBudget = true;
  else if (has(own?.daily_budget)) dailyEur = eurOf(own?.daily_budget);
  else if (has(row.campaign?.daily_budget)) dailyEur = eurOf(row.campaign?.daily_budget);
  else if (level === "campaign") {
    // Presupuesto por conjunto: la campaña gasta lo de sus conjuntos.
    const sets = await get(`${id}/adsets`, { fields: BUDGET, limit: "200" });
    let sum = 0;
    for (const s of (sets["data"] ?? []) as Row[]) {
      if (has(s.lifetime_budget)) lifetimeBudget = true;
      sum += eurOf(s.daily_budget);
    }
    dailyEur = lifetimeBudget ? null : sum;
  } else dailyEur = 0;

  return { level, id, name: String(row.name ?? id), status: String(row.status ?? ""), dailyEur, lifetimeBudget };
}

/**
 * El problema, en palabras del dueño, si `id` no es `expected` de la cuenta;
 * null si lo es.
 */
export function mismatch(obj: MetaObject | null, id: string, expected: Level): string | null {
  if (!obj) return `el id ${id} no es ninguna campaña, conjunto ni anuncio de esta cuenta`;
  if (obj.level !== expected) {
    return `el id ${id} es ${LEVEL_ES[obj.level]} («${obj.name}»), no ${LEVEL_ES[expected]}`;
  }
  return null;
}
