/**
 * El ejecutor: la mitad que puede gastar dinero, y a la que no se llega.
 *
 * No hay `fetch` en este archivo y `workers_dev` está apagado: no tiene
 * dirección en internet. Se despierta cada minuto, aplica las acciones que
 * El dueño confirmó en el panel y se vuelve a dormir. El token con
 * `ads_management` vive aquí y en ningún otro sitio.
 */

import type { Action } from "../shared/actions.ts";
import type { MetaVars } from "../shared/env.ts";
import { missingMeta } from "../shared/env.ts";
import { signedMediaUrl } from "../shared/sign.ts";
import { syncLeads } from "./leads.ts";
import type { MailEnv } from "./mail.ts";
import { apply, preupload, type Ctx } from "./writer.ts";

export type Env = MetaVars & MailEnv & {
  DB: D1Database;
  IMAGES: KVNamespace;
  META_TOKEN_WRITE: string;
  /** La dirección del panel, desde la que Meta descarga los vídeos. */
  MEDIA_URL_BASE: string;
  /** Secreto compartido con el panel para firmar esas direcciones. */
  MEDIA_SIGNING_KEY: string;
};

/** Una propuesta que nadie confirmó en este tiempo ya no se aplica. */
const PROPOSAL_HOURS = 24;
/** Una confirmada que el ejecutor no llegó a coger en este tiempo, tampoco. */
const CONFIRMED_MINUTES = 30;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function contextOf(env: Env): Ctx {
  return {
    ...env,
    token: env.META_TOKEN_WRITE,
    media: async (key) => {
      const row = await env.DB.prepare(
        `select kind, name, meta_hash, meta_video_id from media where key = ? and complete = 1`,
      )
        .bind(key)
        .first<{ kind: "image" | "video"; name: string; meta_hash: string | null; meta_video_id: string | null }>();
      if (!row) return null;
      return { kind: row.kind, name: row.name, metaHash: row.meta_hash, metaVideoId: row.meta_video_id };
    },
    imageBase64: async (key) => {
      const bytes = await env.IMAGES.get(key, "arrayBuffer");
      return bytes ? toBase64(new Uint8Array(bytes)) : null;
    },
    videoUrl: (key) => signedMediaUrl(env.MEDIA_URL_BASE, key, env.MEDIA_SIGNING_KEY),
    rememberHash: async (key, hash) => {
      await env.DB.prepare(`update media set meta_hash = ? where key = ?`).bind(hash, key).run();
    },
    rememberVideo: async (key, videoId) => {
      await env.DB.prepare(`update media set meta_video_id = ? where key = ?`).bind(videoId, key).run();
    },
    rememberForm: async (formId, campaignName, campaignId) => {
      await env.DB.prepare(
        `insert into lead_forms (form_id, campaign_name, campaign_id) values (?, ?, ?)
         on conflict (form_id) do update set campaign_id = coalesce(excluded.campaign_id, campaign_id)`,
      )
        .bind(formId, campaignName, campaignId)
        .run();
    },
    formOfCampaign: async (campaignId) => {
      const row = await env.DB.prepare(`select form_id from lead_forms where campaign_id = ? order by created_at desc limit 1`)
        .bind(campaignId)
        .first<{ form_id: string }>();
      return row?.form_id ?? null;
    },
  };
}

export async function run(env: Env): Promise<string> {
  await env.DB.prepare(
    `update actions set state = 'expired', state_at = datetime('now')
      where (state = 'proposed' and created_at < datetime('now', ?))
         or (state = 'confirmed' and state_at < datetime('now', ?))`,
  )
    .bind(`-${PROPOSAL_HOURS} hours`, `-${CONFIRMED_MINUTES} minutes`)
    .run();

  const missing = missingMeta(env);
  if (missing.length > 0 || !env.META_TOKEN_WRITE) {
    return `sin configurar: ${[...missing, ...(env.META_TOKEN_WRITE ? [] : ["META_TOKEN_WRITE"])].join(", ")}`;
  }

  const pending = await env.DB.prepare(
    `select id, code, payload from actions where state = 'confirmed' order by id limit 3`,
  ).all<{ id: number; code: string; payload: string }>();

  const did: string[] = [];
  for (const row of pending.results ?? []) {
    // Se marca «running» con una condición: si dos ejecuciones coinciden,
    // sólo una se queda la acción.
    const took = await env.DB.prepare(
      `update actions set state = 'running' where id = ? and state = 'confirmed'`,
    )
      .bind(row.id)
      .run();
    if (!took.meta.changes) continue;

    let outcome;
    try {
      outcome = await apply(JSON.parse(row.payload) as Action, contextOf(env));
    } catch (err) {
      outcome = { ok: false, result: null, undo: null, error: `falló: ${String(err).slice(0, 200)}` };
    }

    if (outcome.retry) {
      // Un vídeo que Meta todavía procesa: vuelve a la cola sin tocar su
      // hora de confirmación, así que si tarda más de CONFIRMED_MINUTES
      // caduca en vez de reintentar para siempre.
      await env.DB.prepare(
        `update actions set state = 'confirmed', error = ? where id = ?`,
      )
        .bind("Esperando a que Meta termine de procesar el vídeo…", row.id)
        .run();
      did.push(`${row.code}: vídeo en proceso, se reintenta`);
      continue;
    }

    await env.DB.prepare(
      `update actions set state = ?, state_at = datetime('now'), result = ?, undo = ?, error = ? where id = ?`,
    )
      .bind(
        outcome.ok ? "applied" : "failed",
        JSON.stringify(outcome.result ?? null),
        outcome.undo ? JSON.stringify(outcome.undo) : null,
        outcome.error,
        row.id,
      )
      .run();
    did.push(`${row.code}: ${outcome.ok ? "aplicada" : `falló (${outcome.error})`}`);
  }
  return did.length > 0 ? did.join(" | ") : "nada que aplicar";
}

/** Cuántos archivos se suben por minuto, para no comerse el minuto entero. */
const PREUPLOAD_PER_RUN = 3;

/**
 * Sube a la biblioteca de Meta el material que el dueño adjuntó y todavía no
 * está allí, para que el panel pueda enseñar la vista previa
 * (03/10/2026). Es lo único que el ejecutor hace sin confirmación: subir no
 * publica ni gasta. Si Meta rechaza un archivo, el motivo queda en
 * `meta_error` y no se reintenta.
 */
export async function presubir(env: Env): Promise<string> {
  if (missingMeta(env).length > 0 || !env.META_TOKEN_WRITE) return "sin configurar";
  const rows = await env.DB.prepare(
    `select m.key from media m join ad_drafts d on d.id = m.draft_id
      where m.complete = 1 and d.archived = 0 and m.meta_error is null
        and ((m.kind = 'image' and m.meta_hash is null) or (m.kind = 'video' and m.meta_video_id is null))
      order by m.created_at limit ?`,
  )
    .bind(PREUPLOAD_PER_RUN)
    .all<{ key: string }>();
  const ctx = contextOf(env);
  const did: string[] = [];
  for (const { key } of rows.results ?? []) {
    const info = await ctx.media(key);
    if (!info) continue;
    try {
      await preupload(ctx, key, info);
      did.push(`${key}: subido`);
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err).slice(0, 300);
      await env.DB.prepare(`update media set meta_error = ? where key = ?`).bind(msg, key).run();
      did.push(`${key}: Meta no lo aceptó (${msg})`);
    }
  }
  return did.length > 0 ? did.join(" | ") : "nada que subir";
}

export default {
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    try {
      console.log(`[ejecutor] ${await run(env)}`);
    } catch (err) {
      console.error("[ejecutor] falló:", err);
    }
    try {
      console.log(`[presubida] ${await presubir(env)}`);
    } catch (err) {
      console.error("[presubida] falló:", err);
    }
    // Los contactos de los formularios, cada cinco minutos.
    if (new Date(event.scheduledTime).getUTCMinutes() % 5 === 0 && env.META_TOKEN_WRITE) {
      try {
        console.log(`[contactos] ${await syncLeads(env)}`);
      } catch (err) {
        console.error("[contactos] falló:", err);
      }
    }
  },
  // Sin fetch. Es lo que hace seguro a este Worker.
};
