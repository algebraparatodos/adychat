/**
 * Bajar los contactos de los formularios del dueño y avisarle de cada uno.
 *
 * Sólo LEE de Meta (GET): con el token del ejecutor pide el de la página y
 * con ése los contactos de cada formulario apuntado en `lead_forms`, desde
 * el último que ya tiene. Necesita `leads_retrieval` en el token del
 * ejecutor; mientras no lo tenga, el error queda en `lead_forms.last_error`
 * y no se rompe nada. El aviso va por mail.ts.
 */

import { GRAPH } from "../shared/env.ts";
import { sendLeadMail, type MailEnv } from "./mail.ts";

export type LeadsEnv = MailEnv & {
  DB: D1Database;
  META_TOKEN_WRITE: string;
  META_PAGE_ID: string;
  /** La dirección del panel, para el enlace del aviso. */
  MEDIA_URL_BASE: string;
};

type MetaLead = { id: string; created_time: string; field_data?: { name: string; values?: string[] }[] };

async function get<T>(path: string, token: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`);
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

const NAMED = new Set(["full_name", "email", "phone_number"]);

function answer(lead: MetaLead, name: string): string | null {
  return lead.field_data?.find((f) => f.name === name)?.values?.[0] ?? null;
}

const unix = (iso: string): number => Math.floor(new Date(iso.replace(/\+0000$/, "Z")).getTime() / 1000) || 0;

/** Baja los contactos nuevos y avisa de los que todavía no se avisaron. */
export async function syncLeads(env: LeadsEnv): Promise<string> {
  const forms =
    (
      await env.DB.prepare(`select form_id, campaign_name, last_lead_time from lead_forms order by created_at`).all<{
        form_id: string;
        campaign_name: string;
        last_lead_time: number;
      }>()
    ).results ?? [];
  if (forms.length === 0) return "sin formularios";

  let pageToken: string | null = null;
  let fresh = 0;
  for (const f of forms) {
    try {
      pageToken ??= String((await get<{ access_token?: string }>(`${env.META_PAGE_ID}?fields=access_token`, env.META_TOKEN_WRITE)).access_token ?? "");
      if (!pageToken) throw new Error("Meta no dio el acceso a la página");
      const filtering = JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: f.last_lead_time }]);
      let page = await get<{ data?: MetaLead[]; paging?: { next?: string } }>(
        `${f.form_id}/leads?fields=id,created_time,field_data&limit=100&filtering=${encodeURIComponent(filtering)}`,
        pageToken,
      );
      const rows = [...(page.data ?? [])];
      // Una cuenta chica: con cinco páginas de cien sobra.
      for (let i = 1; i < 5 && page.paging?.next; i++) {
        const res = await fetch(page.paging.next);
        if (!res.ok) break;
        page = (await res.json()) as typeof page;
        rows.push(...(page.data ?? []));
      }
      let newest = f.last_lead_time;
      for (const lead of rows) {
        const extra = (lead.field_data ?? [])
          .filter((x) => !NAMED.has(x.name))
          .map((x) => ({ name: x.name, value: (x.values ?? []).join(", ") }));
        const done = await env.DB.prepare(
          `insert or ignore into leads (id, form_id, campaign_name, created_time, full_name, email, phone, fields)
           values (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(lead.id, f.form_id, f.campaign_name, lead.created_time, answer(lead, "full_name"), answer(lead, "email"), answer(lead, "phone_number"), JSON.stringify(extra))
          .run();
        fresh += done.meta.changes ?? 0;
        newest = Math.max(newest, unix(lead.created_time));
      }
      await env.DB.prepare(`update lead_forms set checked_at = datetime('now'), last_error = null, last_lead_time = ? where form_id = ?`)
        .bind(newest, f.form_id)
        .run();
    } catch (err) {
      await env.DB.prepare(`update lead_forms set checked_at = datetime('now'), last_error = ? where form_id = ?`)
        .bind(String(err instanceof Error ? err.message : err).slice(0, 300), f.form_id)
        .run();
    }
  }

  // Se avisa de a uno: si Resend falla, se reintenta en la siguiente vuelta.
  const pending =
    (
      await env.DB.prepare(
        `select id, campaign_name, created_time, full_name, email, phone, fields from leads where notified_at is null order by created_time limit 10`,
      ).all<{ id: string; campaign_name: string; created_time: string; full_name: string | null; email: string | null; phone: string | null; fields: string }>()
    ).results ?? [];
  let sent = 0;
  for (const l of pending) {
    const problem = await sendLeadMail(env, {
      campaignName: l.campaign_name,
      createdTime: l.created_time,
      fullName: l.full_name,
      email: l.email,
      phone: l.phone,
      extra: JSON.parse(l.fields) as { name: string; value: string }[],
      panelUrl: `${env.MEDIA_URL_BASE}/`,
    });
    if (problem) {
      await env.DB.prepare(`update leads set notify_error = ? where id = ?`).bind(problem, l.id).run();
    } else {
      await env.DB.prepare(`update leads set notified_at = datetime('now'), notify_error = null where id = ?`).bind(l.id).run();
      sent++;
    }
  }
  return `${fresh} contactos nuevos, ${sent} avisados`;
}
