/**
 * El material de los anuncios: fotos y vídeos que el dueño sube POR ANUNCIO
 *. Cada anuncio en preparación es una fila de `ad_drafts` y
 * su material cuelga de ella.
 *
 * Los bytes van a Workers KV, que es gratis y no pide tarjeta (R2 sí).
 * KV admite 25 MB por valor, así que el navegador sube los vídeos en trozos
 * de 20 MB: `<clave>#0`, `<clave>#1`... Una foto va en una sola clave.
 *
 * Meta descarga los vídeos de aquí mismo, de /media/<clave> con una firma
 * que sólo el ejecutor sabe hacer (shared/sign.ts).
 */

import { verifyMediaSignature } from "../shared/sign.ts";

export const CHUNK = 20 * 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_VIDEO = 200 * 1024 * 1024;
const TYPES: Record<string, { kind: "image" | "video"; ext: string }> = {
  "image/jpeg": { kind: "image", ext: "jpg" },
  "image/png": { kind: "image", ext: "png" },
  "image/webp": { kind: "image", ext: "webp" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/quicktime": { kind: "video", ext: "mov" },
};
export const KEY_RE = /^(img|vid)_[a-f0-9]{12}\.(jpg|png|webp|mp4|mov)$/;

export type MediaEnv = { DB: D1Database; IMAGES: KVNamespace; MEDIA_SIGNING_KEY?: string };

type Json = (data: unknown, status?: number) => Response;

type MediaRow = {
  key: string;
  draft_id: number;
  kind: "image" | "video";
  name: string;
  content_type: string;
  size: number;
  chunks: number;
  complete: number;
  width: number | null;
  height: number | null;
};

export async function listDrafts(env: MediaEnv, chatId: number): Promise<unknown[]> {
  const drafts = await env.DB.prepare(`select id, label, created_at from ad_drafts where archived = 0 and chat_id = ? order by id`).bind(chatId).all<{
    id: number;
    label: string;
    created_at: string;
  }>();
  const media = await env.DB.prepare(
    `select m.key, m.draft_id, m.kind, m.name, m.width, m.height, m.size from media m join ad_drafts d on d.id = m.draft_id
      where m.complete = 1 and m.variant_of is null and d.chat_id = ? order by m.created_at`,
  ).bind(chatId).all<MediaRow>();
  return (drafts.results ?? []).map((d) => ({
    ...d,
    media: (media.results ?? []).filter((m) => m.draft_id === d.id).map((m) => ({
      key: m.key,
      kind: m.kind,
      name: m.name,
      width: m.width,
      height: m.height,
      mb: Math.round((m.size / 1048576) * 10) / 10,
    })),
  }));
}

export async function createDraft(env: MediaEnv, chatId: number, label: string | undefined, json: Json): Promise<Response> {
  const count = await env.DB.prepare(`select count(*) as n from ad_drafts where chat_id = ?`).bind(chatId).first<{ n: number }>();
  const name = (label ?? "").replace(/[^\p{L}\p{N} .,:·'()-]+/gu, "").trim().slice(0, 60) || `Anuncio ${Number(count?.n ?? 0) + 1}`;
  const row = await env.DB.prepare(`insert into ad_drafts (chat_id, label) values (?, ?) returning id, label, created_at`)
    .bind(chatId, name)
    .first();
  return json({ ...row, media: [] });
}

export async function archiveDraft(env: MediaEnv, id: number, json: Json): Promise<Response> {
  await env.DB.prepare(`update ad_drafts set archived = 1 where id = ?`).bind(id).run();
  return json({ ok: true });
}

/**
 * Paso 1: el navegador anuncia qué va a subir y recibe la clave. Un recorte
 * hecho en la vista previa (`variantOf`) es un JPG que cuelga de su foto
 * original: no sale como foto suelta del anuncio.
 */
export async function startUpload(env: MediaEnv, body: Record<string, unknown>, json: Json): Promise<Response> {
  let draftId = Number(body["draftId"]);
  const variantOf = typeof body["variantOf"] === "string" ? body["variantOf"] : null;
  if (variantOf !== null) {
    const original = await env.DB.prepare(`select draft_id from media where key = ? and kind = 'image' and complete = 1 and variant_of is null`)
      .bind(variantOf)
      .first<{ draft_id: number }>();
    if (!original) return json({ error: "Esa foto ya no está en el panel." }, 404);
    if (body["type"] !== "image/jpeg") return json({ error: "El recorte va en JPG." }, 400);
    draftId = original.draft_id;
  }
  const draft = await env.DB.prepare(`select id from ad_drafts where id = ? and archived = 0`).bind(draftId).first();
  if (!draft) return json({ error: "Ese anuncio no existe." }, 404);
  const type = String(body["type"] ?? "");
  const t = TYPES[type];
  if (!t) return json({ error: "Sube una foto (JPG, PNG o WebP) o un vídeo (MP4 o MOV)." }, 400);
  const size = Number(body["size"]);
  const max = t.kind === "image" ? MAX_IMAGE : MAX_VIDEO;
  if (!(size > 0 && size <= max)) {
    return json({ error: t.kind === "image" ? "La foto pasa de 8 MB." : "El vídeo pasa de 200 MB." }, 400);
  }
  const hex = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = `${t.kind === "image" ? "img" : "vid"}_${hex}.${t.ext}`;
  const chunks = t.kind === "image" ? 1 : Math.ceil(size / CHUNK);
  const name = String(body["name"] ?? key).replace(/[^\w.\- ]+/g, "").slice(0, 80) || key;
  const width = Number(body["width"]) || null;
  const height = Number(body["height"]) || null;
  await env.DB.prepare(
    `insert into media (key, draft_id, kind, name, content_type, size, chunks, width, height, variant_of) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(key, draftId, t.kind, name, type, size, chunks, width, height, variantOf)
    .run();
  return json({ key, chunks, chunkSize: CHUNK });
}

function chunkKey(row: MediaRow, n: number): string {
  return row.kind === "image" ? row.key : `${row.key}#${n}`;
}

async function row(env: MediaEnv, key: string): Promise<MediaRow | null> {
  return env.DB.prepare(`select * from media where key = ?`).bind(key).first<MediaRow>();
}

/** Paso 2: cada trozo (una foto es un solo trozo). */
export async function putChunk(env: MediaEnv, key: string, n: number, request: Request, json: Json): Promise<Response> {
  const r = await row(env, key);
  if (!r || r.complete) return json({ error: "Ese archivo no está esperando trozos." }, 404);
  if (!(Number.isInteger(n) && n >= 0 && n < r.chunks)) return json({ error: "Trozo fuera de rango." }, 400);
  const bytes = await request.arrayBuffer();
  const expected = n < r.chunks - 1 ? CHUNK : r.size - CHUNK * (r.chunks - 1);
  if (bytes.byteLength !== expected) return json({ error: "El trozo no tiene el tamaño esperado." }, 400);
  await env.IMAGES.put(chunkKey(r, n), bytes, { metadata: { contentType: r.content_type } });
  return json({ ok: true });
}

/** Paso 3: se comprueba que llegaron todos los trozos y se da por bueno. */
export async function finishUpload(env: MediaEnv, key: string, json: Json): Promise<Response> {
  const r = await row(env, key);
  if (!r) return json({ error: "No existe." }, 404);
  for (let n = 0; n < r.chunks; n++) {
    const got = await env.IMAGES.get(chunkKey(r, n), "arrayBuffer");
    if (!got) return json({ error: `Falta el trozo ${n + 1} de ${r.chunks}. Vuelve a subirlo.` }, 409);
  }
  await env.DB.prepare(`update media set complete = 1 where key = ?`).bind(key).run();
  return json({ key, kind: r.kind, name: r.name, width: r.width, height: r.height, mb: Math.round((r.size / 1048576) * 10) / 10 });
}

export async function removeMedia(env: MediaEnv, key: string, json: Json): Promise<Response> {
  const r = await row(env, key);
  if (!r) return json({ error: "No existe." }, 404);
  // Sus recortes se van con ella.
  const crops = await env.DB.prepare(`select key from media where variant_of = ?`).bind(key).all<{ key: string }>();
  for (const c of crops.results ?? []) {
    await env.IMAGES.delete(c.key);
    await env.DB.prepare(`delete from media where key = ?`).bind(c.key).run();
  }
  for (let n = 0; n < r.chunks; n++) await env.IMAGES.delete(chunkKey(r, n));
  await env.DB.prepare(`delete from media where key = ?`).bind(key).run();
  return json({ ok: true });
}

/** El archivo entero, trozo a trozo, sin cargarlo todo en memoria. */
function stream(env: MediaEnv, r: MediaRow): Response {
  let n = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (n >= r.chunks) {
        controller.close();
        return;
      }
      const part = await env.IMAGES.get(chunkKey(r, n++), "arrayBuffer");
      if (!part) {
        controller.error(new Error("falta un trozo"));
        return;
      }
      controller.enqueue(new Uint8Array(part));
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": r.content_type,
      "Content-Length": String(r.size),
      "Cache-Control": "private, max-age=3600",
      "X-Robots-Tag": "noindex",
    },
  });
}

/** Para el propio panel (con sesión): miniaturas y vista previa. */
export async function serveOwn(env: MediaEnv, key: string): Promise<Response> {
  const r = await row(env, key);
  if (!r || !r.complete) return new Response("No existe", { status: 404 });
  return stream(env, r);
}

/** Para Meta: sólo con la firma del ejecutor y antes de que caduque. */
export async function serveSigned(env: MediaEnv, key: string, url: URL): Promise<Response> {
  const ok = await verifyMediaSignature(key, url.searchParams.get("exp") ?? "", url.searchParams.get("sig") ?? "", env.MEDIA_SIGNING_KEY ?? "");
  if (!ok) return new Response("No autorizado", { status: 403 });
  return serveOwn(env, key);
}
