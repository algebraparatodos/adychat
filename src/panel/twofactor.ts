/**
 * Verificación en dos pasos del panel (03/10/2026): además de la
 * contraseña, un código de 6 cifras de una app de autenticación (Google
 * Authenticator, Microsoft Authenticator...). TOTP estándar (RFC 6238):
 * HMAC-SHA1, 30 segundos, 6 cifras.
 *
 * Es OBLIGATORIA: mientras no esté activada, cualquier sesión sólo puede
 * abrir la pantalla para activarla (index.ts). Al activarla se cierran
 * todas las demás sesiones, y desde entonces entrar pide el código.
 *
 * El secreto se guarda cifrado (AES-GCM con el secreto TOTP_KEY del
 * Worker): leer la base no alcanza para generar códigos. Un código ya usado
 * no vale dos veces.
 *
 * Si el dueño pierde el móvil: borrar la fila y la próxima
 * vez que entre vuelve a pedir activarla.
 */

import qrcode from "qrcode-generator";

const STEP = 30;
const DIGITS = 6;
/** Se acepta el código de 30 s antes y después, por relojes desfasados. */
const WINDOW = 1;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const enc = new TextEncoder();

export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(s: string): Uint8Array {
  const clean = s.replace(/[\s=]/g, "").toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("base32 no válido");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** El código de un intervalo de 30 s (el `counter`). */
export async function hotp(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", unbase32(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const off = (mac[mac.length - 1] ?? 0) & 15;
  const bin =
    (((mac[off] ?? 0) & 0x7f) << 24) | ((mac[off + 1] ?? 0) << 16) | ((mac[off + 2] ?? 0) << 8) | (mac[off + 3] ?? 0);
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

export const counterAt = (ms: number): number => Math.floor(ms / 1000 / STEP);

/** El intervalo en el que vale el código, o null si no vale. */
async function match(secret: string, code: string, now: number, after: number): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const c = counterAt(now);
  for (let d = -WINDOW; d <= WINDOW; d++) {
    // Un código ya usado (o uno anterior) no vale otra vez.
    if (c + d <= after) continue;
    if ((await hotp(secret, c + d)) === code) return c + d;
  }
  return null;
}

// --- El secreto, cifrado en la base ---

async function aesKey(raw: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const toB64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function seal(keyRaw: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyRaw), enc.encode(secret)));
  return `${toB64(iv)}.${toB64(ct)}`;
}

async function open(keyRaw: string, sealed: string): Promise<string> {
  const [iv, ct] = sealed.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv ?? "") }, await aesKey(keyRaw), fromB64(ct ?? ""));
  return new TextDecoder().decode(plain);
}

// --- Estado ---

type Row = { secret: string | null; pending: string | null; enabled: number; last_counter: number };

async function row(db: D1Database): Promise<Row | null> {
  return db.prepare(`select secret, pending, enabled, last_counter from two_factor where id = 1`).first<Row>();
}

export async function isEnabled(db: D1Database): Promise<boolean> {
  return (await row(db))?.enabled === 1;
}

/**
 * Lo que hace falta para activarla: la clave para escribir a mano, el
 * enlace otpauth:// (en el móvil abre la app) y el QR para escanear.
 * Reusa la clave pendiente si ya había una, para que recargar la página no
 * invalide un QR ya escaneado.
 */
export async function setup(db: D1Database, keyRaw: string, user: string, issuer = "ADS"): Promise<{ secret: string; uri: string; qr: string }> {
  const r = await row(db);
  let secret: string;
  if (r?.pending) {
    secret = await open(keyRaw, r.pending);
  } else {
    secret = base32(crypto.getRandomValues(new Uint8Array(20)));
    await db
      .prepare(
        `insert into two_factor (id, pending) values (1, ?)
         on conflict (id) do update set pending = excluded.pending`,
      )
      .bind(await seal(keyRaw, secret))
      .run();
  }
  const label = encodeURIComponent(`${issuer}:${user}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;
  const q = qrcode(0, "M");
  q.addData(uri);
  q.make();
  return { secret: secret.replace(/(.{4})/g, "$1 ").trim(), uri, qr: q.createDataURL(5, 4) };
}

/** Activa con el primer código bueno de la clave pendiente. */
export async function enable(db: D1Database, keyRaw: string, code: string, now = Date.now()): Promise<boolean> {
  const r = await row(db);
  if (!r?.pending || r.enabled === 1) return false;
  const secret = await open(keyRaw, r.pending);
  const used = await match(secret, code.trim(), now, -1);
  if (used === null) return false;
  await db
    .prepare(`update two_factor set secret = pending, pending = null, enabled = 1, last_counter = ?, enabled_at = datetime('now') where id = 1`)
    .bind(used)
    .run();
  return true;
}

/** Comprueba el código al entrar. Guarda el intervalo usado: no se puede repetir. */
export async function verify(db: D1Database, keyRaw: string, code: string, now = Date.now()): Promise<boolean> {
  const r = await row(db);
  if (!r?.secret || r.enabled !== 1) return false;
  const used = await match(await open(keyRaw, r.secret), code.trim(), now, r.last_counter);
  if (used === null) return false;
  // Con la condición, dos entradas a la vez con el mismo código no pasan las dos.
  const took = await db
    .prepare(`update two_factor set last_counter = ? where id = 1 and last_counter < ?`)
    .bind(used, used)
    .run();
  return Boolean(took.meta.changes);
}
