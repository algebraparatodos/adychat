/**
 * La vista previa de los anuncios (03/10/2026): el ejecutor sube el
 * material a la biblioteca de Meta en cuanto el dueño lo adjunta, y el panel
 * le pide a Meta cómo se ve el anuncio en Instagram SÓLO LEYENDO. Lo que
 * se ve tiene que ser exactamente lo que el ejecutor crea al confirmar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import panel from "../src/panel/index.ts";
import { presubir } from "../src/executor/index.ts";
import { apply, type Ctx } from "../src/executor/writer.ts";
import { hashPassword } from "../src/panel/auth.ts";
import { counterAt, hotp } from "../src/panel/twofactor.ts";
import { validate, type Action, type AdCopy } from "../src/shared/actions.ts";
import { META_VARS, fakeD1, fakeKV, stubFetch, type Call } from "./fakes.ts";

const ORIGIN = "https://panel.test";
const FRAME = "https://business.facebook.com/ads/api/preview_iframe.php?d=AQabc&amp;t=1";

async function setup() {
  const DB = fakeD1();
  const IMAGES = fakeKV();
  const panelEnv = {
    ...META_VARS,
    DB,
    IMAGES,
    META_TOKEN_READ: "read-token",
    OPENAI_API_KEY: "sk-test",
    AI_DAILY_EUR: "1",
    AI_MONTHLY_EUR: "10",
    PANEL_USER: "Owner",
    PANEL_PASSWORD_HASH: await hashPassword("clave-de-prueba"),
    TOTP_KEY: "clave-totp-de-prueba",
    MEDIA_SIGNING_KEY: "firma-de-prueba",
  };
  const executorEnv = {
    ...META_VARS, DB, IMAGES, META_TOKEN_WRITE: "write-token",
    MEDIA_URL_BASE: "https://panel.test/panel", MEDIA_SIGNING_KEY: "firma-de-prueba",
  };
  return { DB, panelEnv, executorEnv };
}

function req(path: string, init: RequestInit & { cookie?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.method === "POST" || init.method === "PUT") headers.set("Origin", ORIGIN);
  if (init.cookie) headers.set("Cookie", init.cookie);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

type PanelEnv = Parameters<typeof panel.fetch>[1];

async function login(env: PanelEnv): Promise<string> {
  const res = await panel.fetch(req("/api/login", { method: "POST", body: JSON.stringify({ user: "owner", password: "clave-de-prueba" }) }), env);
  const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
  const setup2fa = await panel.fetch(req("/api/2fa/setup", { cookie }), env);
  const { secret } = (await setup2fa.json()) as { secret: string };
  const code = await hotp(secret.replace(/ /g, ""), counterAt(Date.now()));
  await panel.fetch(req("/api/2fa/enable", { method: "POST", body: JSON.stringify({ code }), cookie }), env);
  return cookie;
}

/** Un anuncio en preparación con un archivo, subido como lo hace la página. */
async function attach(env: PanelEnv, cookie: string, name: string, type: string): Promise<string> {
  const draft = (await (await panel.fetch(req("/api/drafts", { method: "POST", body: "{}", cookie }), env)).json()) as { id: number };
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
  const start = (await (
    await panel.fetch(req("/api/media", { method: "POST", body: JSON.stringify({ draftId: draft.id, name, type, size: bytes.length }), cookie }), env)
  ).json()) as { key: string };
  await panel.fetch(req(`/api/media/${start.key}/0`, { method: "PUT", body: bytes, cookie }), env);
  await panel.fetch(req(`/api/media/${start.key}/finish`, { method: "POST", cookie }), env);
  return start.key;
}

async function propose(DB: D1Database, action: Action): Promise<string> {
  const code = "PRV" + String(Math.floor(Math.random() * 900) + 100);
  await DB.prepare(`insert into actions (code, chat_id, type, title, lines, payload) values (?, 1, ?, 't', '[]', ?)`)
    .bind(code, action.type, JSON.stringify(action))
    .run();
  return code;
}

function campaign(ad: AdCopy, objective: "sales" | "leads_form" = "sales"): Extract<Action, { type: "create_campaign" }> {
  return { type: "create_campaign", name: "Pies de gato · Valencia", objective, dailyBudgetEur: 5, audience: { ageMin: 18, ageMax: 50, countries: ["ES"] }, ads: [ad] };
}

async function getPreview(env: PanelEnv, cookie: string, code: string, query = "ad=0&format=feed") {
  const res = await panel.fetch(req(`/api/actions/${code}/preview?${query}`, { cookie }), env);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test("presubida: la foto y el vídeo van a la biblioteca de Meta sin crear nada más", async () => {
  const { DB, panelEnv, executorEnv } = await setup();
  const cookie = await login(panelEnv);
  const img = await attach(panelEnv, cookie, "bolsa.jpg", "image/jpeg");
  const vid = await attach(panelEnv, cookie, "boulder.mp4", "video/mp4");
  const meta = stubFetch((c: Call) => {
    const p = new URL(c.url).pathname;
    if (c.method === "POST" && p.endsWith("/adimages")) return { images: { "bolsa.jpg": { hash: "hash-bolsa" } } };
    if (c.method === "POST" && p.endsWith("/advideos")) return { id: "777000000009" };
    throw new Error(`llamada inesperada: ${c.method} ${c.url}`);
  });
  const out = await presubir(executorEnv);
  meta.restore();
  assert.match(out, /subido.*subido/);
  // Sólo subió material: ni campañas, ni conjuntos, ni anuncios.
  assert.deepEqual(meta.calls.map((c) => new URL(c.url).pathname.split("/").pop()).sort(), ["adimages", "advideos"]);
  // El vídeo lo descarga Meta de una dirección firmada del panel.
  const video = meta.calls.find((c) => c.url.endsWith("/advideos"));
  assert.match(video?.body["file_url"] ?? "", /^https:\/\/panel\.test\/panel\/media\/vid_.*sig=/);
  const rows = await DB.prepare(`select key, meta_hash, meta_video_id from media order by key`).all<{ key: string; meta_hash: string | null; meta_video_id: string | null }>();
  assert.equal(rows.results.find((r) => r.key === img)?.meta_hash, "hash-bolsa");
  assert.equal(rows.results.find((r) => r.key === vid)?.meta_video_id, "777000000009");

  // Ya subido: no se vuelve a subir.
  const again = stubFetch(() => {
    throw new Error("volvió a subir algo ya subido");
  });
  assert.equal(await presubir(executorEnv), "nada que subir");
  again.restore();
});

test("presubida: si Meta rechaza un archivo, queda el motivo y no se reintenta cada minuto", async () => {
  const { DB, panelEnv, executorEnv } = await setup();
  const cookie = await login(panelEnv);
  const img = await attach(panelEnv, cookie, "rota.jpg", "image/jpeg");
  const meta = stubFetch(() => new Response(JSON.stringify({ error: { message: "x", error_user_msg: "La imagen es demasiado pequeña" } }), { status: 400 }));
  await presubir(executorEnv);
  meta.restore();
  const row = await DB.prepare(`select meta_error from media where key = ?`).bind(img).first<{ meta_error: string }>();
  assert.match(row?.meta_error ?? "", /demasiado pequeña/);
  const quiet = stubFetch(() => {
    throw new Error("reintentó un archivo rechazado");
  });
  assert.equal(await presubir(executorEnv), "nada que subir");
  quiet.restore();
  // Y el panel lo dice en la vista previa en vez de quedarse esperando.
  const code = await propose(DB, campaign({ mediaKey: img, headline: "Pies de gato", primaryText: "Agarre seco.", cta: "SHOP_NOW", path: "/" }));
  const r = await getPreview(panelEnv, cookie, code);
  assert.match(String(r.body["error"]), /Meta no aceptó este archivo: .*demasiado pequeña/);
});

test("vista previa: sin esperar al ejecutor (foto por dirección firmada), después por hash, y siempre sólo LEE", async () => {
  const { DB, panelEnv, cookie, code, img } = await (async () => {
    const s = await setup();
    const cookie = await login(s.panelEnv);
    const img = await attach(s.panelEnv, cookie, "bolsa.jpg", "image/jpeg");
    const code = await propose(s.DB, campaign({ mediaKey: img, headline: "Pies de gato talla 42", primaryText: "Agarre seco.", cta: "SHOP_NOW", path: "/" }));
    return { ...s, cookie, code, img };
  })();

  // La tarjeta sabe que tiene un anuncio para ver.
  const state = (await (await panel.fetch(req("/api/state", { cookie }), panelEnv)).json()) as { actions: { code: string; previews: string[]; payload?: unknown }[] };
  const card = state.actions.find((a) => a.code === code);
  assert.deepEqual(card?.previews, ["Pies de gato talla 42"]);
  assert.equal(card?.payload, undefined, "la tarjeta no le manda la acción entera a la página");

  // Todavía sin subir: Meta la baja del panel con una dirección firmada que
  // el propio panel entrega (y una dirección sin firma, no).
  const early = stubFetch(() => ({ data: [{ body: `<iframe src="${FRAME}" width="320" height="525"></iframe>` }] }));
  assert.ok((await getPreview(panelEnv, cookie, code)).body["src"]);
  early.restore();
  const picture = (JSON.parse(new URL(early.calls[0]!.url).searchParams.get("creative") ?? "{}") as { object_story_spec: { link_data: Record<string, string> } })
    .object_story_spec.link_data;
  assert.equal(picture["image_hash"], undefined);
  const signed = new URL(picture["picture"] ?? "");
  assert.equal(signed.pathname, `/media/${img}`);
  assert.equal((await panel.fetch(new Request(signed), panelEnv)).status, 200, "la dirección firmada sirve la foto");
  signed.searchParams.set("sig", "0".repeat(64));
  assert.equal((await panel.fetch(new Request(signed), panelEnv)).status, 403, "y sin la firma buena, no");

  await DB.prepare(`update media set meta_hash = 'hash-bolsa' where key = ?`).bind(img).run();
  const meta = stubFetch((c: Call) => {
    if (new URL(c.url).pathname.endsWith("/generatepreviews")) return { data: [{ body: `<iframe src="${FRAME}" width="320" height="525" scrolling="yes"></iframe>` }] };
    throw new Error(`llamada inesperada: ${c.method} ${c.url}`);
  });
  const ok = await getPreview(panelEnv, cookie, code, "ad=0&format=story");
  meta.restore();
  assert.deepEqual(ok.body, {
    src: FRAME.replace("&amp;", "&"),
    // Lo que mide de verdad Historias, no lo que declara Meta.
    width: 320,
    height: 567,
    // Una foto de un anuncio a la web, sin confirmar: se puede recortar.
    crop: { allowed: true, original: img, current: null },
    // El texto entero, para leerlo al lado del recuadro.
    copy: { headline: "Pies de gato talla 42", text: "Agarre seco.", button: "Comprar", goesTo: "example.com/" },
  });
  assert.ok(meta.calls.every((c) => c.method === "GET"), "la vista previa sólo lee");
  const asked = new URL(meta.calls[0]!.url);
  assert.equal(asked.searchParams.get("ad_format"), "INSTAGRAM_STORY");
  assert.equal(asked.searchParams.get("access_token"), "read-token");
  assert.match(asked.pathname, /act_1234567890\/generatepreviews$/);
});

test("vista previa: lo que se ve es exactamente el creativo que el ejecutor crea", async () => {
  const { DB, panelEnv } = await setup();
  const cookie = await login(panelEnv);
  const img = await attach(panelEnv, cookie, "bolsa.jpg", "image/jpeg");
  await DB.prepare(`update media set meta_hash = 'hash-bolsa' where key = ?`).bind(img).run();
  const ad: AdCopy = { mediaKey: img, headline: "Pies de gato talla 42", primaryText: "Agarre seco, hecho en Valencia.", description: "Envío en 48 h", cta: "SHOP_NOW", path: "/" };
  const action = campaign(ad);
  const code = await propose(DB, action);

  const seen = stubFetch(() => ({ data: [{ body: `<iframe src="${FRAME}" width="320" height="525"></iframe>` }] }));
  await getPreview(panelEnv, cookie, code);
  seen.restore();
  const previewed = JSON.parse(new URL(seen.calls[0]!.url).searchParams.get("creative") ?? "{}") as Record<string, unknown>;

  // El mismo anuncio, creado de verdad por el ejecutor (con Meta de mentira).
  const ctx: Ctx = {
    ...META_VARS,
    token: "write-token",
    media: async () => ({ kind: "image", name: "bolsa.jpg", metaHash: "hash-bolsa", metaVideoId: null }),
    imageBase64: async () => null,
    videoUrl: async () => "",
    rememberHash: async () => {},
    rememberVideo: async () => {},
    rememberForm: async () => {},
    formOfCampaign: async () => null,
    sleep: async () => {},
  };
  const meta = stubFetch((c: Call) => {
    const p = new URL(c.url).pathname;
    if (p.endsWith("/campaigns")) return { id: "120000000000001" };
    if (p.endsWith("/adsets")) return { id: "120000000000002" };
    if (p.endsWith("/adcreatives")) return { id: "120000000000003" };
    if (p.endsWith("/ads")) return { id: "120000000000004" };
    if (p.endsWith("/120000000000002")) return { daily_budget: "500", campaign: { status: "PAUSED" } };
    throw new Error(`llamada inesperada: ${c.method} ${c.url}`);
  });
  const out = await apply(action, ctx);
  meta.restore();
  assert.equal(out.ok, true, String(out.error));
  const made = meta.calls.find((c) => c.url.endsWith("/adcreatives"))?.body ?? {};
  assert.deepEqual(previewed["object_story_spec"], JSON.parse(made["object_story_spec"] ?? "null"));
  assert.deepEqual(previewed["degrees_of_freedom_spec"], JSON.parse(made["degrees_of_freedom_spec"] ?? "null"));
});

test("vista previa: el formulario sale con su botón aunque el formulario todavía no exista", async () => {
  const { DB, panelEnv } = await setup();
  const cookie = await login(panelEnv);
  const img = await attach(panelEnv, cookie, "bolsa.jpg", "image/jpeg");
  await DB.prepare(`update media set meta_hash = 'hash-bolsa' where key = ?`).bind(img).run();
  const code = await propose(DB, campaign({ mediaKey: img, headline: "Clases", primaryText: "Apúntate.", cta: "SIGN_UP" }, "leads_form"));
  const meta = stubFetch(() => ({ data: [{ body: `<iframe src="${FRAME}" width="320" height="525"></iframe>` }] }));
  const r = await getPreview(panelEnv, cookie, code);
  meta.restore();
  assert.ok(r.body["src"], JSON.stringify(r.body));
  const creative = JSON.parse(new URL(meta.calls[0]!.url).searchParams.get("creative") ?? "{}") as { object_story_spec: { link_data: { call_to_action: unknown } } };
  assert.deepEqual(creative.object_story_spec.link_data.call_to_action, { type: "SIGN_UP", value: { link: "https://fb.me/" } });
});

test("vista previa de un vídeo: espera mientras Meta lo procesa y después usa su miniatura", async () => {
  const { DB, panelEnv } = await setup();
  const cookie = await login(panelEnv);
  const vid = await attach(panelEnv, cookie, "boulder.mp4", "video/mp4");
  await DB.prepare(`update media set meta_video_id = '777000000009' where key = ?`).bind(vid).run();
  const code = await propose(DB, campaign({ mediaKey: vid, headline: "Boulder", primaryText: "Mira esto.", cta: "SHOP_NOW", path: "/" }));

  let ready = false;
  const meta = stubFetch((c: Call) => {
    const p = new URL(c.url).pathname;
    if (p.endsWith("/777000000009")) return { status: ready ? { video_status: "ready" } : { video_status: "processing", processing_progress: 40 } };
    if (p.endsWith("/thumbnails")) return { data: [{ uri: "https://thumb/1.jpg", is_preferred: true }] };
    if (p.endsWith("/generatepreviews")) return { data: [{ body: `<iframe src="${FRAME}" width="274" height="213"></iframe>` }] };
    throw new Error(`llamada inesperada: ${c.method} ${c.url}`);
  });
  assert.match(String((await getPreview(panelEnv, cookie, code, "format=reels")).body["wait"]), /procesando el vídeo \(40 %\)/);
  ready = true;
  const r = await getPreview(panelEnv, cookie, code, "format=reels");
  meta.restore();
  // Meta declara 274 × 213 para Reels, pero lo que dibuja mide 320 × 624.
  assert.deepEqual([r.body["width"], r.body["height"]], [320, 624]);
  assert.ok(meta.calls.every((c) => c.method === "GET"));
  const creative = JSON.parse(new URL(meta.calls.at(-1)!.url).searchParams.get("creative") ?? "{}") as { object_story_spec: { video_data: Record<string, unknown> } };
  assert.equal(creative.object_story_spec.video_data["video_id"], "777000000009");
  assert.equal(creative.object_story_spec.video_data["image_url"], "https://thumb/1.jpg");
});

test("vista previa: sólo se acepta un recuadro de Facebook y un formato conocido", async () => {
  const { DB, panelEnv } = await setup();
  const cookie = await login(panelEnv);
  const img = await attach(panelEnv, cookie, "bolsa.jpg", "image/jpeg");
  await DB.prepare(`update media set meta_hash = 'hash-bolsa' where key = ?`).bind(img).run();
  const code = await propose(DB, campaign({ mediaKey: img, headline: "Pies de gato", primaryText: "Agarre seco.", cta: "SHOP_NOW", path: "/" }));
  const evil = stubFetch(() => ({ data: [{ body: `<iframe src="https://otra.web/x" width="320" height="525"></iframe>` }] }));
  const r = await getPreview(panelEnv, cookie, code);
  evil.restore();
  assert.equal(r.body["src"], undefined);
  assert.ok(r.body["error"]);
  for (const bad of ["format=toString", "format=facebook_feed"]) {
    assert.equal((await getPreview(panelEnv, cookie, code, bad)).status, 400, bad);
  }
  // Sin sesión, nada.
  assert.equal((await panel.fetch(req(`/api/actions/${code}/preview`), panelEnv)).status, 401);
});

test("la página deja cargar el recuadro de Meta y nada más", async () => {
  const { panelEnv } = await setup();
  const csp = (await panel.fetch(req("/"), panelEnv)).headers.get("Content-Security-Policy") ?? "";
  assert.match(csp, /frame-src https:\/\/business\.facebook\.com https:\/\/www\.facebook\.com;/);
  assert.match(csp, /frame-ancestors 'none'/);
});

/** Un recorte, subido como lo hace el editor de la vista previa. */
async function cropOf(env: PanelEnv, cookie: string, original: string, type = "image/jpeg"): Promise<Response> {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 9, 9]);
  const start = await panel.fetch(
    req("/api/media", { method: "POST", body: JSON.stringify({ variantOf: original, name: "recorte-story.jpg", type, size: bytes.length, width: 576, height: 1024 }), cookie }),
    env,
  );
  if (start.status !== 200) return start;
  const { key } = (await start.json()) as { key: string };
  await panel.fetch(req(`/api/media/${key}/0`, { method: "PUT", body: bytes, cookie }), env);
  return panel.fetch(req(`/api/media/${key}/finish`, { method: "POST", cookie }), env);
}

async function saveCrop(env: PanelEnv, cookie: string, code: string, body: unknown) {
  const res = await panel.fetch(req(`/api/actions/${code}/crop`, { method: "POST", body: JSON.stringify(body), cookie }), env);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function payloadOf(DB: D1Database, code: string): Promise<{ ads: AdCopy[] }> {
  const row = await DB.prepare(`select payload from actions where code = ?`).bind(code).first<{ payload: string }>();
  return JSON.parse(row?.payload ?? "{}") as { ads: AdCopy[] };
}

test("recorte por sitio: se guarda en la propuesta, se ve en la tarjeta y se puede quitar", async () => {
  const { DB, panelEnv } = await setup();
  const cookie = await login(panelEnv);
  const img = await attach(panelEnv, cookie, "bolsa.jpg", "image/jpeg");
  const code = await propose(DB, campaign({ mediaKey: img, headline: "Pies de gato", primaryText: "Agarre seco.", cta: "SHOP_NOW", path: "/" }));
  const crop = ((await (await cropOf(panelEnv, cookie, img)).json()) as { key: string }).key;

  // El recorte no sale como foto suelta del anuncio (ni el modelo lo ve).
  const drafts = (await (await panel.fetch(req("/api/drafts", { cookie }), panelEnv)).json()) as { media: { key: string }[] }[];
  assert.deepEqual(drafts.flatMap((d) => d.media.map((m) => m.key)), [img]);

  const saved = await saveCrop(panelEnv, cookie, code, { ad: 0, placement: "story", key: crop });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.match((saved.body["lines"] as string[]).join("\n"), /Foto recortada a mano para: Historias/);
  assert.deepEqual((await payloadOf(DB, code)).ads[0]?.placements, { story: crop });

  // Volver a la foto original.
  const back = await saveCrop(panelEnv, cookie, code, { ad: 0, placement: "story", key: null });
  assert.doesNotMatch((back.body["lines"] as string[]).join("\n"), /recortada/);
  assert.equal((await payloadOf(DB, code)).ads[0]?.placements, undefined);
});

test("recorte por sitio: sólo de su propia foto, en JPG y antes de confirmar", async () => {
  const { DB, panelEnv } = await setup();
  const cookie = await login(panelEnv);
  const img = await attach(panelEnv, cookie, "bolsa.jpg", "image/jpeg");
  const other = await attach(panelEnv, cookie, "otra.jpg", "image/jpeg");
  const code = await propose(DB, campaign({ mediaKey: img, headline: "Pies de gato", primaryText: "Agarre seco.", cta: "SHOP_NOW", path: "/" }));
  assert.equal((await cropOf(panelEnv, cookie, img, "image/png")).status, 400, "el recorte va en JPG");
  assert.equal((await cropOf(panelEnv, cookie, "img_000000000000.jpg")).status, 404);
  const foreign = ((await (await cropOf(panelEnv, cookie, other)).json()) as { key: string }).key;
  assert.equal((await saveCrop(panelEnv, cookie, code, { ad: 0, placement: "story", key: foreign })).status, 400, "un recorte de otra foto");
  assert.equal((await saveCrop(panelEnv, cookie, code, { ad: 0, placement: "facebook", key: null })).status, 400);
  await DB.prepare(`update actions set state = 'confirmed' where code = ?`).bind(code).run();
  const mine = ((await (await cropOf(panelEnv, cookie, img)).json()) as { key: string }).key;
  assert.equal((await saveCrop(panelEnv, cookie, code, { ad: 0, placement: "story", key: mine })).status, 409, "ya confirmada");
});

test("recorte por sitio: no vale en publicaciones ya hechas ni en anuncios que no van a la web", () => {
  const limits = { maxAdSetDailyEur: 20, maxAccountDailyEur: 30, country: "ES" };
  const story = { story: "img_aaaaaaaaaaaa.jpg" };
  const photo: AdCopy = { mediaKey: "img_bbbbbbbbbbbb.jpg", headline: "a", primaryText: "b", cta: "SHOP_NOW", path: "/" };
  assert.deepEqual(validate(campaign({ ...photo, placements: story }), limits), []);
  assert.ok(validate(campaign({ mediaKey: "img_bbbbbbbbbbbb.jpg", headline: "a", primaryText: "b", cta: "SIGN_UP", placements: story }, "leads_form"), limits).length > 0);
  assert.ok(validate(campaign({ instagramMediaId: "18000000000000002", cta: "SHOP_NOW", path: "/", placements: story }), limits).length > 0);
  assert.ok(validate(campaign({ ...photo, placements: { story: "../x" } }), limits).length > 0);
});

test("recorte por sitio: la vista previa pide a Meta la foto de cada sitio, y es lo que el ejecutor publica", async () => {
  const { DB, panelEnv } = await setup();
  const cookie = await login(panelEnv);
  const img = await attach(panelEnv, cookie, "bolsa.jpg", "image/jpeg");
  const crop = ((await (await cropOf(panelEnv, cookie, img)).json()) as { key: string }).key;
  await DB.prepare(`update media set meta_hash = 'hash-original' where key = ?`).bind(img).run();
  const code = await propose(DB, campaign({ mediaKey: img, headline: "Pies de gato", primaryText: "Agarre seco.", cta: "SHOP_NOW", path: "/" }));
  await saveCrop(panelEnv, cookie, code, { ad: 0, placement: "story", key: crop });

  // El recorte todavía no está en Meta: la vista previa no espera al
  // ejecutor, se lo pasa a Meta por dirección firmada.
  const early = stubFetch(() => ({ data: [{ body: `<iframe src="${FRAME}" width="320" height="567"></iframe>` }] }));
  assert.ok((await getPreview(panelEnv, cookie, code, "format=story")).body["src"]);
  early.restore();
  const firstImages = (JSON.parse(new URL(early.calls[0]!.url).searchParams.get("creative") ?? "{}") as { asset_feed_spec: { images: Record<string, unknown>[] } })
    .asset_feed_spec.images;
  assert.match(String(firstImages.find((i) => "url" in i)?.["url"]), new RegExp(`/media/${crop}\\?exp=\\d+&sig=[0-9a-f]{64}$`));

  await DB.prepare(`update media set meta_hash = 'hash-historias' where key = ?`).bind(crop).run();
  const meta = stubFetch(() => ({ data: [{ body: `<iframe src="${FRAME}" width="320" height="567"></iframe>` }] }));
  const story = await getPreview(panelEnv, cookie, code, "format=story");
  const feed = await getPreview(panelEnv, cookie, code, "format=feed");
  meta.restore();
  assert.ok(story.body["src"] && feed.body["src"]);
  assert.equal((story.body["crop"] as Record<string, unknown>)["current"], crop);
  assert.ok(meta.calls.every((c) => c.method === "GET"));
  const [askStory, askFeed] = meta.calls.map((c) => new URL(c.url).searchParams);
  assert.equal(askStory?.get("dynamic_asset_label"), "story");
  assert.equal(askFeed?.get("dynamic_asset_label"), "feed");
  type Spec = { object_story_spec: unknown; asset_feed_spec: { images: { hash: string; adlabels: { name: string }[] }[]; asset_customization_rules: unknown[] } };
  const previewed = JSON.parse(askStory?.get("creative") ?? "{}") as Spec;
  assert.deepEqual(
    previewed.asset_feed_spec.images.map((i) => [i.hash, i.adlabels.map((l) => l.name)]),
    [["hash-original", ["feed", "reels"]], ["hash-historias", ["story"]]],
  );
  assert.equal(previewed.asset_feed_spec.asset_customization_rules.length, 3);
  // Cada regla nombra también el texto, el titular y el enlace: si sólo
  // nombra la foto, Meta dibuja Feed y Reels sin texto.
  for (const rule of previewed.asset_feed_spec.asset_customization_rules as Record<string, { name: string }>[]) {
    const place = rule["image_label"]!.name;
    for (const k of ["body_label", "title_label", "link_url_label"]) assert.equal(rule[k]?.name, place, `${place}: ${k}`);
  }
  const feedSpec = previewed.asset_feed_spec as unknown as Record<string, { adlabels?: { name: string }[] }[]>;
  for (const k of ["bodies", "titles", "link_urls"]) {
    assert.deepEqual(feedSpec[k]![0]!.adlabels?.map((l) => l.name), ["feed", "story", "reels"], k);
  }

  // El ejecutor, con la acción tal como quedó guardada, crea ese mismo creativo.
  const saved = JSON.parse((await DB.prepare(`select payload from actions where code = ?`).bind(code).first<{ payload: string }>())?.payload ?? "{}") as Action;
  const hashes: Record<string, string> = { [img]: "hash-original", [crop]: "hash-historias" };
  const ctx: Ctx = {
    ...META_VARS,
    token: "write-token",
    media: async (k) => ({ kind: "image", name: k, metaHash: hashes[k] ?? null, metaVideoId: null }),
    imageBase64: async () => null,
    videoUrl: async () => "",
    rememberHash: async () => {},
    rememberVideo: async () => {},
    rememberForm: async () => {},
    formOfCampaign: async () => null,
    sleep: async () => {},
  };
  const write = stubFetch((c: Call) => {
    const p = new URL(c.url).pathname;
    if (p.endsWith("/campaigns")) return { id: "120000000000001" };
    if (p.endsWith("/adsets")) return { id: "120000000000002" };
    if (p.endsWith("/adcreatives")) return { id: "120000000000003" };
    if (p.endsWith("/ads")) return { id: "120000000000004" };
    if (p.endsWith("/120000000000002")) return { daily_budget: "500", campaign: { status: "PAUSED" } };
    throw new Error(`llamada inesperada: ${c.method} ${c.url}`);
  });
  const out = await apply(saved, ctx);
  write.restore();
  assert.equal(out.ok, true, String(out.error));
  const made = write.calls.find((c) => c.url.endsWith("/adcreatives"))?.body ?? {};
  assert.deepEqual(JSON.parse(made["asset_feed_spec"] ?? "null"), previewed.asset_feed_spec);
  assert.deepEqual(JSON.parse(made["object_story_spec"] ?? "null"), previewed.object_story_spec);
});

test("el Feed mide según la forma de la foto, sin cortar las verticales", async () => {
  const { feedHeight } = await import("../src/panel/preview.ts");
  // Medido en el navegador: cuadrada 534 y 2:3 (que Meta recorta a 3:4) 640.
  assert.equal(feedHeight(1024, 1024), 534);
  assert.equal(feedHeight(1024, 1536), 640);
  assert.equal(feedHeight(576, 1024), 640, "más alta que 3:4: Meta la recorta a 3:4");
  assert.equal(feedHeight(1920, 1080), 216 + Math.round((318 * 1080) / 1920));
  assert.equal(feedHeight(3000, 1000), 216 + Math.round(318 / 1.91), "más apaisada que 1,91:1: Meta la recorta");
  assert.equal(feedHeight(null, null), 640, "sin medidas, la más alta");
});

test("el texto del anuncio, entero, al lado de la vista previa", async () => {
  const { copyOf, FEED_VISIBLE, feedHeight } = await import("../src/panel/preview.ts");
  const long = "Nacido en la roca, donde cada regleta cuenta. 100 % carbonato de pies de gato, grano fino y bolsa de kraft con cierre zip para que no se te escape ni un gramo.";
  const ad = (o: Record<string, unknown>) => ({ type: "create_campaign", name: "x", dailyBudgetEur: 5, audience: { ageMin: 18, ageMax: 50, countries: ["ES"] }, ...o }) as Action;
  const web = copyOf(META_VARS, ad({ ads: [{ mediaKey: "a", headline: "Pies de gato", primaryText: long, description: "Envío a toda España", cta: "SHOP_NOW", path: "/en/" }] }), 0)!;
  assert.equal(web.text, long);
  assert.ok(web.cut! <= FEED_VISIBLE && long[web.cut!] === " ", "corta en un espacio, antes de los 125");
  assert.deepEqual([web.button, web.goesTo, web.description], ["Comprar", "example.com/en/", "Envío a toda España"]);
  assert.equal(copyOf(META_VARS, ad({ ads: [{ mediaKey: "a", headline: "h", primaryText: "Corto." }] }), 0)!.cut, undefined);
  const direct = copyOf(META_VARS, ad({ objective: "messages", ads: [{ mediaKey: "a", headline: "h", primaryText: "t" }] }), 0)!;
  assert.deepEqual([direct.button, direct.goesTo], ["Enviar mensaje", "Instagram Direct"]);
  const post = copyOf(META_VARS, ad({ objective: "engagement", ads: [{ instagramMediaId: "18000000000000001" }] }), 0)!;
  assert.equal(post.existingPost, true);
  assert.equal(copyOf(META_VARS, ad({ ads: [] }), 3), undefined);
  // Con el texto largo, el Feed deja sitio para más líneas que las 2 de base.
  assert.ok(feedHeight(1024, 1024, long.length) > feedHeight(1024, 1024, 0));
  assert.equal(feedHeight(1024, 1024, 20), 534, "texto corto: las 2 líneas de base");
});
