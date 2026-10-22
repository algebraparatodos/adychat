/**
 * Entrar al panel: un usuario y una contraseña, los que se eligieron al instalarlo.
 *
 * La contraseña no está en ningún sitio en claro: el Worker guarda sólo su
 * PBKDF2 (secreto PANEL_PASSWORD_HASH, generado con `npm run hash`). La
 * sesión es un token aleatorio en una cookie HttpOnly y SameSite=Strict;
 * en la base se guarda sólo su SHA-256, así que leer la base no deja
 * entrar a nadie. Cinco fallos seguidos desde la misma IP la bloquean un
 * cuarto de hora.
 */

const ITERATIONS = 100_000; // el máximo que acepta PBKDF2 en Workers
const SESSION_DAYS = 30;
const MAX_FAILURES = 5;
export const COOKIE = "sp_session";

const enc = new TextEncoder();

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** Formato: pbkdf2$<iteraciones>$<sal base64>$<hash base64>. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const got = await derive(password, unb64(salt), Number(iter));
  return sameBytes(got, unb64(hash));
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function tooManyFailures(db: D1Database, ip: string): Promise<boolean> {
  const row = await db
    .prepare(`select count(*) as n from login_failures where ip = ? and at > datetime('now', '-15 minutes')`)
    .bind(ip)
    .first<{ n: number }>();
  return Number(row?.n ?? 0) >= MAX_FAILURES;
}

export async function recordFailure(db: D1Database, ip: string): Promise<void> {
  await db.prepare(`insert into login_failures (ip) values (?)`).bind(ip).run();
  await db.prepare(`delete from login_failures where at < datetime('now', '-1 day')`).run();
}

/**
 * `user`: quién entró, en minúsculas (los dos pasos se exigen sólo al dueño).
 * `twoFactor`: si al entrar se dio el código de la app. Queda en la sesión
 * para que cada ruta lo pueda exigir, no sólo la de entrar.
 */
export async function startSession(db: D1Database, user: string, twoFactor = false): Promise<string> {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, "");
  await db
    .prepare(`insert into sessions (token_hash, expires_at, user, two_factor) values (?, datetime('now', ?), ?, ?)`)
    .bind(await sha256(token), `+${SESSION_DAYS} days`, user, twoFactor ? 1 : 0)
    .run();
  await db.prepare(`delete from sessions where expires_at < datetime('now')`).run();
  return token;
}

/** `base` es la ruta del panel ("" o "/panel"): la cookie no sale de ahí. */
export function sessionCookie(token: string, base = ""): string {
  return `${COOKIE}=${token}; Path=${base || "/"}; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearCookie(base = ""): string {
  return `${COOKIE}=; Path=${base || "/"}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function readCookie(request: Request): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=") || null;
  }
  return null;
}

export type Session = { user: string; twoFactor: boolean };

/**
 * Quién tiene esta sesión y si pasó los dos pasos, o null si no hay sesión.
 *
 * Una sesión sin usuario no vale (22/10/2026): las escribían versiones
 * viejas del panel, de antes de los dos pasos, que seguían publicadas en
 * sus direcciones de versión de workers.dev con la misma base. Antes se
 * tomaban por sesiones del dueño y daban el panel sin el código del móvil.
 */
export async function sessionUser(request: Request, db: D1Database): Promise<Session | null> {
  const token = readCookie(request);
  if (!token) return null;
  const row = await db
    .prepare(`select user, two_factor from sessions where token_hash = ? and expires_at > datetime('now')`)
    .bind(await sha256(token))
    .first<{ user: string | null; two_factor: number | null }>();
  if (!row?.user) return null;
  return { user: row.user, twoFactor: row.two_factor === 1 };
}

/** La sesión que acaba de dar el código de la app (al activar los dos pasos). */
export async function markTwoFactor(request: Request, db: D1Database): Promise<void> {
  const token = readCookie(request);
  if (token) await db.prepare(`update sessions set two_factor = 1 where token_hash = ?`).bind(await sha256(token)).run();
}

/**
 * Cierra las demás sesiones de ESE usuario (al activar los dos pasos). Las
 * viejas sin usuario eran del dueño.
 */
export async function endOtherSessions(request: Request, db: D1Database, user: string, isMain: boolean): Promise<void> {
  const token = readCookie(request);
  await db
    .prepare(`delete from sessions where token_hash != ? and (user = ? or (? and user is null))`)
    .bind(token ? await sha256(token) : "", user, isMain ? 1 : 0)
    .run();
}

export async function endSession(request: Request, db: D1Database): Promise<void> {
  const token = readCookie(request);
  if (token) await db.prepare(`delete from sessions where token_hash = ?`).bind(await sha256(token)).run();
}
