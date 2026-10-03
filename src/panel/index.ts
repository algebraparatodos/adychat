/**
 * El panel del dueño: la mitad con dirección en internet.
 *
 * Tiene el token de SÓLO LECTURA de Meta y la clave de OpenAI del dueño.
 * No puede escribir en Meta: lo que confirma el dueño queda en la base y lo
 * aplica el ejecutor, que no tiene dirección (ver src/executor/index.ts).
 */

import {
  clearCookie,
  endOtherSessions,
  endSession,
  sessionUser,
  recordFailure,
  sessionCookie,
  startSession,
  tooManyFailures,
  verifyPassword,
} from "./auth.ts";
import { turn, type ChatEnv } from "./chat.ts";
import { KNOWLEDGE_MAX, createChat, deleteChat, getKnowledge, listChats, renameChat, resolveChat, saveKnowledge } from "./chats.ts";
import { MetaReader, insights, structure } from "./meta-read.ts";
import { FORMATS, preview, previewAds, type Format } from "./preview.ts";
import { PLACEMENTS, describe, validate, type Action, type Placement } from "../shared/actions.ts";
import { PAGE } from "./ui.ts";
import * as twoFactor from "./twofactor.ts";
import {
  KEY_RE,
  archiveDraft,
  createDraft,
  finishUpload,
  listDrafts,
  putChunk,
  removeMedia,
  serveOwn,
  serveSigned,
  startUpload,
} from "./media.ts";
import { limitsOf, missingMeta, panelTitle, timeZoneOf } from "../shared/env.ts";
import { signedMediaUrl } from "../shared/sign.ts";

export type Env = ChatEnv & {
  /** Las fotos, en Workers KV: gratis y sin tarjeta (R2 la pide). */
  IMAGES: KVNamespace;
  PANEL_USER: string;
  PANEL_PASSWORD_HASH: string;
  /** Cifra el secreto de la verificación en dos pasos en la base (twofactor.ts). */
  TOTP_KEY: string;
  /**
   * Otros usuarios, como JSON {"usuario": "<hash de npm run hash>"}. Entran
   * SIN verificación en dos pasos (03/10/2026): sólo se le exige a
   * PANEL_USER, que es el dueño.
   */
  PANEL_EXTRA_USERS?: string;
  /** Firma las direcciones desde las que Meta baja los vídeos (shared/sign.ts). */
  MEDIA_SIGNING_KEY?: string;
  /**
   * La ruta bajo la que se sirve: "" en workers.dev, "/panel" cuando va en
   * example.com/panel (ruta del Worker en la zona del dueño; el
   * resto del dominio lo sigue sirviendo GitHub Pages).
   */
  BASE_PATH?: string;
  /** El título del panel. Sin poner: «ADS» y BRAND_NAME. */
  PANEL_TITLE?: string;
};


function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

function html(env: Env): Response {
  return new Response(PAGE.replaceAll("{{PANEL_TITLE}}", escapeHtml(panelTitle(env))), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-src https://business.facebook.com https://www.facebook.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/** Un POST que no viene de la propia página se rechaza (CSRF). */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin;
}

function daysAgo(n: number, timeZone: string): string {
  const d = new Date(Date.now() - n * 86400_000);
  return d.toLocaleDateString("sv-SE", { timeZone });
}

type ActionRow = { code: string; title: string; lines: string; state: string; state_at: string; error: string | null; created_at: string; payload: string };

function card(row: ActionRow): Record<string, unknown> {
  const { payload, ...rest } = row;
  // Los anuncios que se pueden ver antes de confirmar (botón «Ver cómo queda»).
  const previews = previewAds(JSON.parse(payload) as Action).map((a) => a.label);
  return { ...rest, lines: JSON.parse(row.lines) as string[], previews };
}

async function actionByCode(db: D1Database, code: string): Promise<ActionRow | null> {
  return db
    .prepare(`select code, title, lines, state, state_at, error, created_at, payload from actions where code = ?`)
    .bind(code)
    .first<ActionRow>();
}

function extraUsers(env: Env): Record<string, string> {
  try {
    const parsed = JSON.parse(env.PANEL_EXTRA_USERS ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string").map(([k, v]) => [k.toLowerCase(), v]),
    );
  } catch {
    return {};
  }
}

async function login(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  if (await tooManyFailures(env.DB, ip)) {
    return json({ error: "Demasiados intentos. Espera un cuarto de hora." }, 429);
  }
  const body = (await request.json().catch(() => ({}))) as { user?: string; password?: string; code?: string };
  const user = typeof body.user === "string" ? body.user.trim().toLowerCase() : "";
  const isMain = user === env.PANEL_USER.toLowerCase();
  const extraHash = isMain ? undefined : extraUsers(env)[user];
  const userOk = isMain || Boolean(extraHash);
  // Se calcula un hash aunque el usuario esté mal: que no se note por el
  // tiempo de respuesta cuál de los dos falló.
  const passOk = await verifyPassword(String(body.password ?? ""), (isMain ? env.PANEL_PASSWORD_HASH : extraHash ?? env.PANEL_PASSWORD_HASH) ?? "");
  if (!userOk || !passOk) {
    await recordFailure(env.DB, ip);
    return json({ error: "Usuario o contraseña incorrectos." }, 401);
  }
  // Con los dos pasos activados, sin el código de la app no hay sesión (sólo el dueño).
  if (isMain && (await twoFactor.isEnabled(env.DB))) {
    const code = String(body.code ?? "").replace(/\s/g, "");
    if (!code) return json({ need2fa: true, error: "Escribe el código de 6 cifras de tu app de autenticación." }, 401);
    if (!(await twoFactor.verify(env.DB, env.TOTP_KEY, code))) {
      await recordFailure(env.DB, ip);
      return json({ need2fa: true, error: "El código no es correcto o ya se usó. Prueba con el siguiente." }, 401);
    }
  }
  const token = await startSession(env.DB, user);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token, env.BASE_PATH ?? "") });
}

async function overview(env: Env, days: number): Promise<Response> {
  if (!env.META_TOKEN_READ || missingMeta(env).includes("META_ACCOUNT_ID")) {
    return json({ error: "La cuenta de Meta todavía no está conectada al panel." }, 503);
  }
  const meta = new MetaReader(env.META_TOKEN_READ, env.META_ACCOUNT_ID);
  const range = { since: daysAgo(days - 1, timeZoneOf(env)), until: daysAgo(0, timeZoneOf(env)) };
  try {
    const [total, campaigns, daily, tree] = await Promise.all([
      insights(meta, "account", range),
      insights(meta, "campaign", range),
      insights(meta, "account", range, true),
      structure(meta),
    ]);
    return json({ range, total: total[0] ?? null, campaigns, daily, tree });
  } catch (err) {
    return json({ error: String(err instanceof Error ? err.message : err) }, 502);
  }
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // HEAD se atiende como GET (el runtime quita el cuerpo): si no, los
  // monitores y Meta al tantear un vídeo ven 404 donde hay página.
  const method = request.method === "HEAD" ? "GET" : request.method;
  const base = env.BASE_PATH ?? "";
  // /panel sin barra: se redirige a /panel/ para que las rutas relativas
  // de la página (api/…) apunten dentro del panel y no a la tienda.
  if (base && url.pathname === base) return Response.redirect(`${url.origin}${base}/`, 301);
  if (base && !url.pathname.startsWith(`${base}/`)) return new Response("No existe", { status: 404 });
  const path = url.pathname.slice(base.length);

  if (method === "GET" && path === "/") return html(env);
  // Meta descarga los vídeos de aquí, con la firma del ejecutor y sin sesión.
  const signed = path.match(/^\/media\/([^/]+)$/);
  if (method === "GET" && signed && KEY_RE.test(decodeURIComponent(signed[1] ?? ""))) {
    return serveSigned(env, decodeURIComponent(signed[1] ?? ""), url);
  }
  if ((method === "POST" || method === "PUT") && !sameOrigin(request)) return json({ error: "origen no permitido" }, 403);
  if (method === "POST" && path === "/api/login") return login(request, env);

  if (!path.startsWith("/api/")) return new Response("No existe", { status: 404 });
  const user = await sessionUser(request, env.DB, env.PANEL_USER);
  if (!user) return json({ error: "sesión" }, 401);
  const isMain = user === env.PANEL_USER.toLowerCase();

  if (method === "POST" && path === "/api/logout") {
    await endSession(request, env.DB);
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie(env.BASE_PATH ?? "") });
  }

  // Para el dueño los dos pasos son obligatorios: sin activarlos, la sesión
  // sólo sirve para activarlos.
  if (isMain && !(await twoFactor.isEnabled(env.DB))) {
    if (method === "GET" && path === "/api/2fa/setup") {
      return json(await twoFactor.setup(env.DB, env.TOTP_KEY, env.PANEL_USER, panelTitle(env)));
    }
    if (method === "POST" && path === "/api/2fa/enable") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "local";
      if (await tooManyFailures(env.DB, ip)) return json({ error: "Demasiados intentos. Espera un cuarto de hora." }, 429);
      const body = (await request.json().catch(() => ({}))) as { code?: string };
      const ok = await twoFactor.enable(env.DB, env.TOTP_KEY, String(body.code ?? "").replace(/\s/g, ""));
      if (!ok) {
        await recordFailure(env.DB, ip);
        return json({ error: `El código no es correcto. Mira que sea el de «${panelTitle(env)}» y que no haya cambiado.` }, 400);
      }
      // Cualquier otra sesión abierta antes queda fuera: vuelve a entrar con el código.
      await endOtherSessions(request, env.DB, user, true);
      return json({ ok: true });
    }
    return json({ setup2fa: true, error: "Antes tienes que activar la verificación en dos pasos." }, 403);
  }

  if (method === "GET" && path === "/api/state") {
    const chatId = await resolveChat(env.DB, url.searchParams.get("chat"));
    const [messages, actions] = await Promise.all([
      env.DB.prepare(`select role, content, at from messages where chat_id = ? order by id desc limit 40`).bind(chatId).all(),
      env.DB.prepare(`select code, title, lines, state, state_at, error, created_at, payload from actions where chat_id = ? order by id desc limit 40`)
        .bind(chatId)
        .all<ActionRow>(),
    ]);
    return json({
      chatId,
      chats: await listChats(env.DB),
      messages: (messages.results ?? []).reverse(),
      actions: (actions.results ?? []).map(card),
      drafts: await listDrafts(env, chatId),
      limits: limitsOf(env),
      missing: [...missingMeta(env), ...(env.META_TOKEN_READ ? [] : ["META_TOKEN_READ"]), ...(env.OPENAI_API_KEY ? [] : ["OPENAI_API_KEY"])],
    });
  }

  if (method === "POST" && path === "/api/chat") {
    const body = (await request.json().catch(() => ({}))) as { text?: string; chatId?: number };
    const text = String(body.text ?? "").trim().slice(0, 4000);
    if (!text) return json({ error: "mensaje vacío" }, 400);
    const result = await turn(env, await resolveChat(env.DB, body.chatId), text);
    const cards = [];
    for (const c of result.proposed) {
      const row = await actionByCode(env.DB, c);
      if (row) cards.push(card(row));
    }
    return json({ reply: result.reply, cards });
  }

  // La vista previa de Meta de un anuncio de la propuesta (sólo lectura).
  const previewMatch = path.match(/^\/api\/actions\/([A-Z0-9]{6})\/preview$/);
  if (method === "GET" && previewMatch) {
    if (!env.META_TOKEN_READ || missingMeta(env).length > 0) return json({ error: "La cuenta de Meta todavía no está conectada al panel." });
    const row = await env.DB.prepare(`select payload, state from actions where code = ?`)
      .bind(previewMatch[1] ?? "")
      .first<{ payload: string; state: string }>();
    if (!row) return json({ error: "no existe" }, 404);
    const format = url.searchParams.get("format") ?? "feed";
    if (!Object.hasOwn(FORMATS, format)) return json({ error: "formato no válido" }, 400);
    const index = Math.max(0, Number(url.searchParams.get("ad")) || 0);
    const meta = new MetaReader(env.META_TOKEN_READ, env.META_ACCOUNT_ID);
    // Una foto que el ejecutor todavía no subió, Meta la baja de aquí mismo (15 min).
    const sign = env.MEDIA_SIGNING_KEY
      ? (key: string) => signedMediaUrl(`${url.origin}${base}`, key, env.MEDIA_SIGNING_KEY ?? "", 900)
      : undefined;
    return json(await preview(env.DB, meta, env, JSON.parse(row.payload) as Action, index, format as Format, row.state, sign));
  }

  // El recorte de la foto de un anuncio para un sitio de Instagram, hecho en
  // la vista previa. Cambia la propuesta, así que sólo antes de confirmar.
  const cropMatch = path.match(/^\/api\/actions\/([A-Z0-9]{6})\/crop$/);
  if (method === "POST" && cropMatch) {
    const body = (await request.json().catch(() => ({}))) as { ad?: unknown; placement?: unknown; key?: unknown };
    const code = cropMatch[1] ?? "";
    const row = await env.DB.prepare(`select payload, state from actions where code = ?`).bind(code).first<{ payload: string; state: string }>();
    if (!row) return json({ error: "no existe" }, 404);
    if (row.state !== "proposed") return json({ error: "Esta propuesta ya no se puede cambiar." }, 409);
    const action = JSON.parse(row.payload) as Action;
    const ad = previewAds(action)[Number(body.ad)]?.copy;
    if (!ad?.mediaKey) return json({ error: "Este anuncio no tiene una foto para recortar." }, 400);
    const placement = String(body.placement ?? "") as Placement;
    if (!PLACEMENTS.includes(placement)) return json({ error: "sitio no válido" }, 400);
    const key = body.key === null ? null : String(body.key ?? "");
    if (key !== null) {
      const crop = await env.DB.prepare(`select variant_of from media where key = ? and complete = 1`).bind(key).first<{ variant_of: string | null }>();
      if (!crop || crop.variant_of !== ad.mediaKey) return json({ error: "Ese recorte no es de esta foto." }, 400);
    }
    // `ad` es el anuncio dentro de `action`: se cambia ahí mismo.
    const placements = { ...(ad.placements ?? {}) };
    if (key) placements[placement] = key;
    else delete placements[placement];
    if (Object.keys(placements).length > 0) ad.placements = placements;
    else delete ad.placements;
    const problems = validate(action, limitsOf(env));
    if (problems.length > 0) return json({ error: problems.join("; ") }, 400);
    const described = describe(action);
    await env.DB.prepare(`update actions set payload = ?, title = ?, lines = ? where code = ? and state = 'proposed'`)
      .bind(JSON.stringify(action), described.title, JSON.stringify(described.lines), code)
      .run();
    const updated = await actionByCode(env.DB, code);
    return updated ? json(card(updated)) : json({ error: "no existe" }, 404);
  }

  const actionMatch = path.match(/^\/api\/actions\/([A-Z0-9]{6})(?:\/(confirm|cancel))?$/);
  if (actionMatch) {
    const [, code, verb] = actionMatch;
    if (method === "POST" && verb) {
      const next = verb === "confirm" ? "confirmed" : "cancelled";
      await env.DB.prepare(`update actions set state = ?, state_at = datetime('now') where code = ? and state = 'proposed'`)
        .bind(next, code)
        .run();
    }
    const row = await actionByCode(env.DB, code ?? "");
    return row ? json(card(row)) : json({ error: "no existe" }, 404);
  }

  // Conversaciones.
  if (method === "GET" && path === "/api/chats") return json(await listChats(env.DB));
  if (method === "POST" && path === "/api/chats") return json(await createChat(env.DB));
  const chatRename = path.match(/^\/api\/chats\/(\d+)\/rename$/);
  if (method === "POST" && chatRename) {
    const body = (await request.json().catch(() => ({}))) as { title?: unknown };
    const chat = await renameChat(env.DB, Number(chatRename[1]), body.title);
    return chat ? json(chat) : json({ error: "Escribe un nombre." }, 400);
  }
  const chatDelete = path.match(/^\/api\/chats\/(\d+)\/delete$/);
  if (method === "POST" && chatDelete) {
    const out = await deleteChat(env, Number(chatDelete[1]));
    return "error" in out ? json({ error: out.error }, out.status) : json(out);
  }

  // «Conocimiento»: el contexto de la marca que el modelo lee en cada turno.
  if (method === "GET" && path === "/api/leads") {
    const rows = await env.DB.prepare(
      `select id, full_name, email, phone, campaign_name, created_time, fields from leads order by created_time desc limit 200`,
    ).all();
    const forms = await env.DB.prepare(`select campaign_name, checked_at, last_error from lead_forms order by created_at desc`).all();
    return json({ leads: rows.results ?? [], forms: forms.results ?? [] });
  }
  if (method === "GET" && path === "/api/knowledge") return json({ ...(await getKnowledge(env.DB)), max: KNOWLEDGE_MAX });
  if (method === "PUT" && path === "/api/knowledge") {
    const body = (await request.json().catch(() => ({}))) as { content?: unknown };
    if (typeof body.content !== "string") return json({ error: "falta el texto" }, 400);
    if (body.content.length > KNOWLEDGE_MAX) return json({ error: `Como mucho ${KNOWLEDGE_MAX} caracteres.` }, 400);
    return json({ ...(await saveKnowledge(env.DB, body.content)), max: KNOWLEDGE_MAX });
  }

  // Anuncios en preparación y su material (fotos y vídeos POR ANUNCIO).
  if (method === "GET" && path === "/api/drafts") {
    return json(await listDrafts(env, await resolveChat(env.DB, url.searchParams.get("chat"))));
  }
  if (method === "POST" && path === "/api/drafts") {
    const body = (await request.json().catch(() => ({}))) as { label?: string; chatId?: number };
    return createDraft(env, await resolveChat(env.DB, body.chatId), body.label, json);
  }
  const draftArchive = path.match(/^\/api\/drafts\/(\d+)\/archive$/);
  if (method === "POST" && draftArchive) return archiveDraft(env, Number(draftArchive[1]), json);
  if (method === "POST" && path === "/api/media") {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return startUpload(env, body, json);
  }
  const mediaPath = path.match(/^\/api\/media\/([^/]+)(?:\/(\d+|finish|delete))?$/);
  if (mediaPath && KEY_RE.test(mediaPath[1] ?? "")) {
    const key = mediaPath[1] ?? "";
    const verb = mediaPath[2];
    if (method === "GET" && !verb) return serveOwn(env, key);
    if (method === "PUT" && verb && /^\d+$/.test(verb)) return putChunk(env, key, Number(verb), request, json);
    if (method === "POST" && verb === "finish") return finishUpload(env, key, json);
    if (method === "POST" && verb === "delete") return removeMedia(env, key, json);
  }

  if (method === "GET" && path === "/api/overview") {
    const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 7, 1), 90);
    return overview(env, days);
  }

  return json({ error: "no existe" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (err) {
      console.error("[panel]", err);
      return json({ error: "Algo falló en el panel." }, 500);
    }
  },
};
