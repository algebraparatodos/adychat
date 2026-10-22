/**
 * La verificación en dos pasos del panel (03/10/2026): obligatoria,
 * con el secreto cifrado, y un código no vale dos veces.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import panel from "../src/panel/index.ts";
import { hashPassword } from "../src/panel/auth.ts";
import { base32, counterAt, hotp } from "../src/panel/twofactor.ts";
import { META_VARS, fakeD1, fakeKV } from "./fakes.ts";

const ORIGIN = "https://panel.test";

async function env() {
  return {
    ...META_VARS,
    DB: fakeD1(),
    IMAGES: fakeKV(),
    META_TOKEN_READ: "",
    OPENAI_API_KEY: "",
    AI_DAILY_EUR: "1",
    AI_MONTHLY_EUR: "10",
    PANEL_USER: "Owner",
    PANEL_PASSWORD_HASH: await hashPassword("clave-de-prueba"),
    TOTP_KEY: "clave-totp-de-prueba",
    PANEL_EXTRA_USERS: JSON.stringify({ Admin: await hashPassword("clave-de-admin") }),
  };
}

function req(path: string, init: RequestInit & { cookie?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.method === "POST") headers.set("Origin", ORIGIN);
  if (init.cookie) headers.set("Cookie", init.cookie);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

async function login(e: Awaited<ReturnType<typeof env>>, code?: string): Promise<Response> {
  return panel.fetch(
    req("/api/login", { method: "POST", body: JSON.stringify({ user: "Owner", password: "clave-de-prueba", code }) }),
    e,
  );
}
const cookieOf = (r: Response) => (r.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";

test("el código coincide con el ejemplo del RFC 6238 (SHA-1)", async () => {
  const secret = base32(new TextEncoder().encode("12345678901234567890"));
  // RFC 6238, T = 59 s → 94287082; con 6 cifras, 287082.
  assert.equal(await hotp(secret, counterAt(59_000)), "287082");
  assert.equal(await hotp(secret, counterAt(1111111109_000)), "081804");
});

test("es obligatoria: la sesión vieja y la nueva sólo pueden activarla, y al activarla se cierran las demás", async () => {
  const e = await env();
  const old = cookieOf(await login(e));
  const res = await login(e);
  assert.equal(res.status, 200);
  const cookie = cookieOf(res);
  for (const path of ["/api/state", "/api/chats", "/api/knowledge", "/api/overview"]) {
    const r = await panel.fetch(req(path, { cookie }), e);
    assert.equal(r.status, 403, path);
  }
  const setup = (await (await panel.fetch(req("/api/2fa/setup", { cookie }), e)).json()) as { secret: string; uri: string; qr: string };
  assert.match(setup.uri, /^otpauth:\/\/totp\/ADS%20Example%20Climbing%20Shop%3AOwner\?secret=[A-Z2-7]{32}&issuer=/);
  assert.match(setup.qr, /^data:image\/gif;base64,/);
  // Recargar la pantalla no cambia la clave (un QR ya escaneado sigue valiendo).
  const again = (await (await panel.fetch(req("/api/2fa/setup", { cookie }), e)).json()) as { secret: string };
  assert.equal(again.secret, setup.secret);
  // El secreto no está en claro en la base.
  const raw = await e.DB.prepare(`select pending from two_factor where id = 1`).first<{ pending: string }>();
  assert.ok(!raw?.pending.includes(setup.secret.replace(/ /g, "")));

  const bad = await panel.fetch(req("/api/2fa/enable", { method: "POST", body: JSON.stringify({ code: "000000" }), cookie }), e);
  assert.equal(bad.status, 400);
  const secret = setup.secret.replace(/ /g, "");
  const code = await hotp(secret, counterAt(Date.now()));
  const on = await panel.fetch(req("/api/2fa/enable", { method: "POST", body: JSON.stringify({ code }), cookie }), e);
  assert.equal(on.status, 200);
  assert.equal((await panel.fetch(req("/api/state", { cookie }), e)).status, 200);
  // La sesión abierta antes de activarla ya no vale.
  assert.equal((await panel.fetch(req("/api/state", { cookie: old }), e)).status, 401);
  // Y no se puede volver a «activar» encima con otra clave.
  assert.equal((await panel.fetch(req("/api/2fa/setup", { cookie }), e)).status, 404);
});

test("activada, entrar pide el código; uno malo o repetido no da sesión", async () => {
  const e = await env();
  const first = cookieOf(await login(e));
  const { secret } = (await (await panel.fetch(req("/api/2fa/setup", { cookie: first }), e)).json()) as { secret: string };
  const s = secret.replace(/ /g, "");
  const now = counterAt(Date.now());
  await panel.fetch(req("/api/2fa/enable", { method: "POST", body: JSON.stringify({ code: await hotp(s, now) }), cookie: first }), e);

  const noCode = await login(e);
  assert.equal(noCode.status, 401);
  assert.equal(((await noCode.json()) as { need2fa?: boolean }).need2fa, true);
  assert.equal(noCode.headers.get("Set-Cookie"), null);

  assert.equal((await login(e, "123456")).status, 401);
  // El mismo código con el que se activó ya está usado.
  assert.equal((await login(e, await hotp(s, now))).status, 401);
  const ok = await login(e, await hotp(s, now + 1));
  assert.equal(ok.status, 200);
  assert.match(cookieOf(ok), /^sp_session=/);
  // Repetido, no.
  assert.equal((await login(e, await hotp(s, now + 1))).status, 401);
});

test("Admin entra sin dos pasos; al dueño se le siguen exigiendo, y activarlos no echa al admin", async () => {
  const e = await env();
  const asAdmin = (password: string, code?: string) =>
    panel.fetch(req("/api/login", { method: "POST", body: JSON.stringify({ user: "admin", password, code }) }), e);
  assert.equal((await asAdmin("clave-de-prueba")).status, 401, "con la contraseña del dueño no entra");
  const j = cookieOf(await asAdmin("clave-de-admin"));
  assert.equal((await panel.fetch(req("/api/state", { cookie: j }), e)).status, 200, "Admin usa el panel sin activar nada");
  // Una sesión sin usuario (la escribía una versión vieja del panel) no vale.
  await e.DB.prepare(`insert into sessions (token_hash, expires_at) values (?, datetime('now', '+1 day'))`)
    .bind(await (await import("../src/panel/auth.ts")).sha256("vieja"))
    .run();
  assert.equal((await panel.fetch(req("/api/state", { cookie: "sp_session=vieja" }), e)).status, 401);

  const m = cookieOf(await login(e));
  assert.equal((await panel.fetch(req("/api/state", { cookie: m }), e)).status, 403, "el dueño sigue obligado");
  const { secret } = (await (await panel.fetch(req("/api/2fa/setup", { cookie: m }), e)).json()) as { secret: string };
  const s = secret.replace(/ /g, "");
  await panel.fetch(req("/api/2fa/enable", { method: "POST", body: JSON.stringify({ code: await hotp(s, counterAt(Date.now())) }), cookie: m }), e);
  assert.equal((await panel.fetch(req("/api/state", { cookie: j }), e)).status, 200, "la sesión del admin sigue");
  assert.equal((await panel.fetch(req("/api/state", { cookie: "sp_session=vieja" }), e)).status, 401, "la vieja del dueño se cerró");
  // Con los dos pasos del dueño activados, Admin sigue entrando sin código.
  assert.equal((await asAdmin("clave-de-admin")).status, 200);
});

test("activados, cada ruta exige una sesión que dio el código; una abierta sin él (versión vieja) se cierra", async () => {
  const e = await env();
  const first = cookieOf(await login(e));
  const { secret } = (await (await panel.fetch(req("/api/2fa/setup", { cookie: first }), e)).json()) as { secret: string };
  const s = secret.replace(/ /g, "");
  const now = counterAt(Date.now());
  await panel.fetch(req("/api/2fa/enable", { method: "POST", body: JSON.stringify({ code: await hotp(s, now) }), cookie: first }), e);
  // La que activó los dos pasos dio el código: sigue dentro.
  assert.equal((await panel.fetch(req("/api/state", { cookie: first }), e)).status, 200);

  // Lo que escribía un panel de antes de los dos pasos: usuario y contraseña, sin código.
  const { sha256 } = await import("../src/panel/auth.ts");
  for (const [token, user] of [["sin-codigo", "owner"], ["sin-usuario", null]] as const) {
    await e.DB.prepare(`insert into sessions (token_hash, expires_at, user) values (?, datetime('now', '+1 day'), ?)`)
      .bind(await sha256(token), user)
      .run();
    for (const path of ["/api/state", "/api/chats", "/api/knowledge", "/api/overview", "/api/actions/ABC123"]) {
      const r = await panel.fetch(req(path, { cookie: `sp_session=${token}` }), e);
      assert.equal(r.status, 401, `${token} ${path}`);
    }
  }
  // Y la sesión sin código queda borrada, no sólo frenada.
  const left = await e.DB.prepare(`select count(*) as n from sessions where token_hash = ?`).bind(await sha256("sin-codigo")).first<{ n: number }>();
  assert.equal(left?.n, 0);

  // Entrar con el código da una sesión que sí vale.
  const ok = await login(e, await hotp(s, now + 1));
  assert.equal((await panel.fetch(req("/api/state", { cookie: cookieOf(ok) }), e)).status, 200);
});
