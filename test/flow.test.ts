/**
 * El circuito entero, por el camino que usa el dueño: entra, sube una foto,
 * pide una campaña por el chat, la confirma en la tarjeta y el ejecutor la
 * crea. Meta y OpenAI son de mentira; el resto es el código de verdad.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import panel from "../src/panel/index.ts";
import { run } from "../src/executor/index.ts";
import { hashPassword } from "../src/panel/auth.ts";
import { counterAt, hotp } from "../src/panel/twofactor.ts";
import { META_VARS, accountObjects, fakeD1, fakeKV, stubFetch, type Call } from "./fakes.ts";

const ORIGIN = "https://panel.test";

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

/** Sube un archivo como lo hace la página: anuncia, manda trozos y cierra. */
async function upload(
  env: Parameters<typeof panel.fetch>[1],
  cookie: string,
  draftId: number,
  name: string,
  type: string,
  bytes: Uint8Array,
): Promise<{ key: string; kind: string }> {
  const start = await panel.fetch(
    req("/api/media", { method: "POST", body: JSON.stringify({ draftId, name, type, size: bytes.length, width: 1080, height: 1350 }), cookie }),
    env,
  );
  assert.equal(start.status, 200, await start.clone().text());
  const s = (await start.json()) as { key: string; chunks: number; chunkSize: number };
  for (let n = 0; n < s.chunks; n++) {
    const part = bytes.slice(n * s.chunkSize, (n + 1) * s.chunkSize);
    const put = await panel.fetch(req(`/api/media/${s.key}/${n}`, { method: "PUT", body: part, cookie }), env);
    assert.equal(put.status, 200, await put.clone().text());
  }
  const fin = await panel.fetch(req(`/api/media/${s.key}/finish`, { method: "POST", cookie }), env);
  assert.equal(fin.status, 200, await fin.clone().text());
  return (await fin.json()) as { key: string; kind: string };
}

async function newDraft(env: Parameters<typeof panel.fetch>[1], cookie: string): Promise<number> {
  const res = await panel.fetch(req("/api/drafts", { method: "POST", body: "{}", cookie }), env);
  return ((await res.json()) as { id: number }).id;
}

async function login(env: Parameters<typeof panel.fetch>[1]): Promise<string> {
  const res = await panel.fetch(
    req("/api/login", { method: "POST", body: JSON.stringify({ user: "owner", password: "clave-de-prueba" }) }),
    env,
  );
  assert.equal(res.status, 200);
  const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
  assert.match(cookie, /^sp_session=/);
  // La primera vez, el panel obliga a activar los dos pasos: se activan
  // como lo haríal dueño con su app.
  const setup2fa = await panel.fetch(req("/api/2fa/setup", { cookie }), env);
  if (setup2fa.status === 200) {
    const { secret } = (await setup2fa.json()) as { secret: string };
    const code = await hotp(secret.replace(/ /g, ""), counterAt(Date.now()));
    const on = await panel.fetch(req("/api/2fa/enable", { method: "POST", body: JSON.stringify({ code }), cookie }), env);
    assert.equal(on.status, 200, await on.clone().text());
  }
  return cookie;
}

test("sin sesión no se entra, y una contraseña mala no da sesión", async () => {
  const { panelEnv } = await setup();
  assert.equal((await panel.fetch(req("/api/state"), panelEnv)).status, 401);
  const bad = await panel.fetch(
    req("/api/login", { method: "POST", body: JSON.stringify({ user: "Owner", password: "no" }) }),
    panelEnv,
  );
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get("Set-Cookie"), null);
  // Un POST desde otra web se rechaza aunque traiga la cookie.
  const csrf = await panel.fetch(
    new Request(`${ORIGIN}/api/logout`, { method: "POST", headers: { Origin: "https://otra.web" } }),
    panelEnv,
  );
  assert.equal(csrf.status, 403);
});

test("de la frase del dueño a la campaña creada en Meta", async () => {
  const { DB, panelEnv, executorEnv } = await setup();
  const cookie = await login(panelEnv);

  // 1. Crea un anuncio y le sube una foto.
  const draftId = await newDraft(panelEnv, cookie);
  const image = await upload(panelEnv, cookie, draftId, "bolsa.jpg", "image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]));

  // 2. Pide la campaña. El modelo de mentira contesta con la herramienta y
  //    después con texto.
  let openaiCalls = 0;
  const chatFetch = stubFetch((c: Call) => {
    if (c.url.includes("api.openai.com")) {
      openaiCalls++;
      const sent = JSON.parse(c.body["json"] ?? "{}") as { input: unknown[]; include?: string[] };
      assert.deepEqual(sent.include, ["reasoning.encrypted_content"]);
      if (openaiCalls === 1) {
        return {
          output: [
            { type: "reasoning", id: "rs_1", encrypted_content: "xyz", summary: [] },
            {
              type: "function_call",
              call_id: "call_1",
              name: "proponer_campana",
              arguments: JSON.stringify({
                name: "Pies de gato · Valencia",
                dailyBudgetEur: 10,
                audience: {
                  ageMin: 18,
                  ageMax: 45,
                  genders: [1, 2],
                  cities: [{ key: "100001", name: "Valencia", radiusKm: 25 }],
                },
                ads: [{ mediaKey: image.key, headline: "Pies de gato · 79 €", primaryText: "Agarre seco, hecho en Valencia.", cta: "SHOP_NOW", path: "/" }],
              }),
            },
          ],
          usage: { input_tokens: 3000, output_tokens: 400 },
        };
      }
      // En la segunda vuelta el modelo tiene que ver lo que devolvió la
      // herramienta y su propio razonamiento.
      const kinds = sent.input.map((i) => (i as { type?: string }).type ?? "msg");
      assert.ok(kinds.includes("reasoning") && kinds.includes("function_call_output"));
      return {
        output: [{ type: "message", content: [{ type: "output_text", text: "Te dejé la campaña propuesta abajo." }] }],
        usage: { input_tokens: 3500, output_tokens: 60 },
      };
    }
    // Sólo puede LEER en Meta: de qué país es cada ciudad (sólo España).
    if (c.method === "GET" && c.url.includes("graph.facebook.com") && c.url.includes("adgeolocationmeta")) {
      return { data: { cities: { "100001": { country_code: "ES", name: "Valencia" } } } };
    }
    // Y qué públicos hay, para excluir solo a los compradores.
    if (c.method === "GET" && c.url.includes("/customaudiences")) {
      return { data: [{ id: "238000000000003", name: "Example Climbing Shop · Compradores web", description: "panel:web_buyers" }] };
    }
    throw new Error(`llamada inesperada desde el chat: ${c.method} ${c.url}`);
  });
  const chat = await panel.fetch(
    req("/api/chat", { method: "POST", body: JSON.stringify({ text: "Quiero una campaña en Valencia con 10 € al día" }), cookie }),
    panelEnv,
  );
  chatFetch.restore();
  assert.equal(chat.status, 200);
  const turn = (await chat.json()) as { reply: string; cards: { code: string; state: string; title: string; lines: string[] }[] };
  assert.equal(turn.cards.length, 1);
  const card = turn.cards[0]!;
  assert.equal(card.state, "proposed");
  assert.match(card.lines.join("\n"), /Valencia \(\+25 km\)/);
  assert.match(card.lines.join("\n"), /Género: todos/);
  // Ventas: los compradores se excluyen solos, aunque el modelo no lo pidió.
  assert.match(card.lines.join("\n"), /Nunca a: Example Climbing Shop · Compradores web/);
  assert.match(card.lines.join("\n"), /^Ventas/m);
  // El chat no escribió en Meta ni una vez: sólo leyó el país de la ciudad.
  assert.ok(chatFetch.calls.every((c) => !(c.url.includes("graph.facebook.com") && c.method !== "GET")));
  assert.ok(chatFetch.calls.some((c) => c.url.includes("adgeolocationmeta")), "comprobó que la ciudad es de España");
  // Y apuntó lo que costó.
  const usage = await DB.prepare(`select count(*) as n, sum(cost_eur) as eur from ai_usage`).first<{ n: number; eur: number }>();
  assert.equal(usage?.n, 2);
  assert.ok((usage?.eur ?? 0) > 0 && (usage?.eur ?? 1) < 0.01);

  // 3. Sin confirmar, el ejecutor no hace nada.
  const idle = stubFetch(() => {
    throw new Error("el ejecutor habló con Meta sin nada confirmado");
  });
  assert.equal(await run(executorEnv), "nada que aplicar");
  idle.restore();

  // 4. El dueño confirma.
  const confirmed = await panel.fetch(req(`/api/actions/${card.code}/confirm`, { method: "POST", cookie }), panelEnv);
  assert.equal(((await confirmed.json()) as { state: string }).state, "confirmed");

  // 5. El ejecutor la aplica contra un Meta de mentira.
  const meta = stubFetch((c: Call) => {
    const u = new URL(c.url);
    assert.equal(u.hostname, "graph.facebook.com");
    if (c.method === "POST") {
      assert.equal(c.body["access_token"], "write-token");
      if (u.pathname.endsWith("/campaigns")) return { id: "120000000000001" };
      if (u.pathname.endsWith("/adimages")) return { images: { "bolsa.jpg": { hash: "hash123" } } };
      if (u.pathname.endsWith("/adsets")) return { id: "120000000000002" };
      if (u.pathname.endsWith("/adcreatives")) return { id: "120000000000003" };
      if (u.pathname.endsWith("/ads")) return { id: "120000000000004" };
    }
    if (u.pathname.endsWith("/search") && u.searchParams.get("type") === "adgeolocationmeta") {
      return { data: { cities: { "100001": { country_code: "ES", name: "Valencia" } } } };
    }
    if (u.pathname.endsWith("/120000000000002")) return { daily_budget: "1000", campaign: { status: "PAUSED" } };
    throw new Error(`llamada inesperada: ${c.method} ${c.url}`);
  });
  const did = await run(executorEnv);
  meta.restore();
  assert.match(did, /aplicada/);

  const posts = meta.calls.filter((c) => c.method === "POST");
  const byPath = (p: string) => posts.find((c) => new URL(c.url).pathname.endsWith(p))?.body ?? {};
  assert.equal(byPath("/campaigns")["status"], "PAUSED");
  assert.equal(byPath("/campaigns")["objective"], "OUTCOME_SALES");
  assert.equal(byPath("/campaigns")["is_adset_budget_sharing_enabled"], "false");
  const adset = byPath("/adsets");
  assert.equal(adset["daily_budget"], "1000");
  assert.deepEqual(JSON.parse(adset["promoted_object"] ?? "{}"), { pixel_id: "999999999999", custom_event_type: "PURCHASE" });
  // Sin los dos campos de la DSA Meta rechaza el conjunto en España.
  assert.equal(adset["dsa_beneficiary"], "Example Climbing Shop");
  assert.equal(adset["dsa_payor"], "Ana Ejemplo");
  const targeting = JSON.parse(adset["targeting"] ?? "{}");
  assert.deepEqual(targeting.targeting_automation, { advantage_audience: 0 });
  assert.deepEqual(targeting.targeting_relaxation_types, { lookalike: 0, custom_audience: 0 });
  assert.equal(targeting.genders, undefined);
  assert.deepEqual(targeting.excluded_custom_audiences, [{ id: "238000000000003" }]);
  assert.equal(targeting.custom_audiences, undefined);
  // SÓLO Instagram, aunque nadie lo haya pedido.
  assert.deepEqual(targeting.publisher_platforms, ["instagram"]);
  assert.deepEqual(targeting.instagram_positions, ["stream", "story", "reels"]);
  assert.equal(targeting.facebook_positions, undefined);
  const creative = JSON.parse(byPath("/adcreatives")["object_story_spec"] ?? "{}");
  assert.equal(creative.instagram_user_id, "17841400000000000");
  assert.equal(creative.link_data.name, "Pies de gato · 79 €");
  assert.equal(creative.link_data.image_hash, "hash123");
  assert.match(creative.link_data.link, /^https:\/\/example\.com\/\?utm_source=meta&utm_medium=paid&utm_campaign=pies-de-gato-valencia$/);
  const ad = byPath("/ads");
  assert.equal(ad["conversion_domain"], "example.com");

  const row = await DB.prepare(`select state, result from actions where code = ?`).bind(card.code).first<{ state: string; result: string }>();
  assert.equal(row?.state, "applied");
  assert.equal(JSON.parse(row?.result ?? "{}").campaignId, "120000000000001");
  // El hash de la foto quedó guardado: la próxima vez no se vuelve a subir.
  const img = await DB.prepare(`select meta_hash from media where key = ?`).bind(image.key).first<{ meta_hash: string }>();
  assert.equal(img?.meta_hash, "hash123");
});

test("encender algo que pasa el tope de la cuenta no llega a Meta", async () => {
  const { DB, executorEnv } = await setup();
  const action = { type: "set_status", level: "campaign", id: "120000000000001", name: "Nueva", status: "ACTIVE" };
  await DB.prepare(`insert into actions (code, type, title, lines, payload, state) values ('ABCDEF', 'set_status', 't', '[]', ?, 'confirmed')`)
    .bind(JSON.stringify(action))
    .run();
  // Ya hay 25 € encendidos; la campaña nueva suma 10 y el tope es 30.
  const meta = stubFetch((c: Call) => {
    if (c.method === "POST") throw new Error("intentó escribir pasando el tope");
    const known = accountObjects(c, { campaigns: [{ id: "120000000000001", name: "Nueva", status: "PAUSED" }] });
    if (known) return known;
    if (new URL(c.url).pathname.endsWith("/120000000000001/adsets")) return { data: [] };
    return {
      data: [
        { id: "1", status: "ACTIVE", daily_budget: "2500", campaign: { id: "120000000000009", status: "ACTIVE" } },
        { id: "2", status: "ACTIVE", daily_budget: "1000", campaign: { id: "120000000000001", status: "PAUSED" } },
      ],
    };
  });
  await run(executorEnv);
  meta.restore();
  const row = await DB.prepare(`select state, error from actions where code = 'ABCDEF'`).first<{ state: string; error: string }>();
  assert.equal(row?.state, "failed");
  assert.match(row?.error ?? "", /35\.00 € al día y el tope de la cuenta es 30/);
});

test("un presupuesto por encima del tope se frena en el ejecutor aunque alguien lo meta en la base", async () => {
  const { DB, executorEnv } = await setup();
  const action = { type: "set_budget", adSetId: "120000000000002", name: "x", dailyBudgetEur: 500 };
  await DB.prepare(`insert into actions (code, type, title, lines, payload, state) values ('QWERTY', 'set_budget', 't', '[]', ?, 'confirmed')`)
    .bind(JSON.stringify(action))
    .run();
  const meta = stubFetch(() => {
    throw new Error("habló con Meta");
  });
  await run(executorEnv);
  meta.restore();
  const row = await DB.prepare(`select state, error from actions where code = 'QWERTY'`).first<{ state: string; error: string }>();
  assert.equal(row?.state, "failed");
  assert.match(row?.error ?? "", /no puede pasar de 20/);
});

test("con el tope de la IA alcanzado, el chat no llama a OpenAI", async () => {
  const { DB, panelEnv } = await setup();
  const cookie = await login(panelEnv);
  await DB.prepare(`insert into ai_usage (day, input_tokens, output_tokens, cost_eur) values (?, 0, 0, 5)`)
    .bind(new Date().toISOString().slice(0, 10))
    .run();
  const f = stubFetch(() => {
    throw new Error("llamó a OpenAI con el tope alcanzado");
  });
  const res = await panel.fetch(req("/api/chat", { method: "POST", body: JSON.stringify({ text: "hola" }), cookie }), panelEnv);
  f.restore();
  const body = (await res.json()) as { reply: string };
  assert.match(body.reply, /tope de gasto/);
});

test("servido bajo /panel: redirige, entra y la cookie no sale de /panel", async () => {
  const { panelEnv } = await setup();
  const env = { ...panelEnv, BASE_PATH: "/panel" };
  const bare = await panel.fetch(req("/panel"), env);
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.get("Location"), `${ORIGIN}/panel/`);
  assert.equal((await panel.fetch(req("/panel/"), env)).status, 200);
  // Lo que no es del panel no lo contesta este Worker.
  assert.equal((await panel.fetch(req("/api/state"), env)).status, 404);
  const res = await panel.fetch(
    req("/panel/api/login", { method: "POST", body: JSON.stringify({ user: "Owner", password: "clave-de-prueba" }) }),
    env,
  );
  assert.equal(res.status, 200);
  const setCookie = res.headers.get("Set-Cookie") ?? "";
  assert.match(setCookie, /Path=\/panel;/);
  const cookie = setCookie.split(";")[0] ?? "";
  // Sin los dos pasos activados, la sesión sólo sirve para activarlos.
  const state = await panel.fetch(req("/panel/api/state", { cookie }), env);
  assert.equal(state.status, 403);
  assert.equal(((await state.json()) as { setup2fa?: boolean }).setup2fa, true);
  assert.equal((await panel.fetch(req("/panel/api/2fa/setup", { cookie }), env)).status, 200);
});

test("la foto subida se vuelve a ver desde el panel", async () => {
  const { panelEnv } = await setup();
  const cookie = await login(panelEnv);
  const draftId = await newDraft(panelEnv, cookie);
  const m = await upload(panelEnv, cookie, draftId, "logo.png", "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  const got = await panel.fetch(req(`/api/media/${m.key}`, { cookie }), panelEnv);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("Content-Type"), "image/png");
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  // Y aparece en su anuncio, que es lo que mira el asistente.
  const drafts = (await (await panel.fetch(req("/api/drafts", { cookie }), panelEnv)).json()) as { id: number; media: { key: string }[] }[];
  assert.deepEqual(drafts.find((d) => d.id === draftId)?.media.map((x) => x.key), [m.key]);
});

test("un vídeo grande se sube en trozos y Meta sólo lo baja con la firma", async () => {
  const { panelEnv } = await setup();
  const cookie = await login(panelEnv);
  const draftId = await newDraft(panelEnv, cookie);
  const bytes = new Uint8Array(20 * 1024 * 1024 + 7);
  bytes[0] = 1; bytes[bytes.length - 1] = 9;
  const m = await upload(panelEnv, cookie, draftId, "reel.mp4", "video/mp4", bytes);
  assert.equal(m.kind, "video");
  // Sin firma no sale.
  assert.equal((await panel.fetch(req(`/media/${m.key}`), panelEnv)).status, 403);
  // Con la firma del ejecutor sale entero, en orden.
  const { signedMediaUrl } = await import("../src/shared/sign.ts");
  const url = await signedMediaUrl("https://panel.test", m.key, "firma-de-prueba");
  const res = await panel.fetch(new Request(url), panelEnv);
  assert.equal(res.status, 200);
  const back = new Uint8Array(await res.arrayBuffer());
  assert.equal(back.length, bytes.length);
  assert.equal(back[0], 1);
  assert.equal(back[back.length - 1], 9);
  // Una firma de otro secreto no vale.
  const fake = await signedMediaUrl("https://panel.test", m.key, "otra");
  assert.equal((await panel.fetch(new Request(fake), panelEnv)).status, 403);
});

test("anuncio con vídeo: Meta lo baja, se espera a que esté listo y sale con miniatura", async () => {
  const { DB, panelEnv, executorEnv } = await setup();
  const cookie = await login(panelEnv);
  const draftId = await newDraft(panelEnv, cookie);
  const video = await upload(panelEnv, cookie, draftId, "reel.mp4", "video/mp4", new Uint8Array([0, 0, 0, 24]));
  const action = {
    type: "create_campaign", name: "Reel", dailyBudgetEur: 5,
    audience: { ageMin: 18, ageMax: 40, countries: ["ES"] },
    ads: [{ mediaKey: video.key, headline: "Agarre seco", primaryText: "Pies de gato de Valencia", cta: "SHOP_NOW", path: "/" }],
  };
  await DB.prepare(`insert into actions (code, type, title, lines, payload, state) values ('VIDEO1', 'create_campaign', 't', '[]', ?, 'confirmed')`)
    .bind(JSON.stringify(action)).run();

  // Primera vuelta: Meta todavía procesa. No se crea NADA y vuelve a la cola.
  let ready = false;
  const handler = (c: Call) => {
    const u = new URL(c.url);
    if (c.method === "POST" && u.pathname.endsWith("/advideos")) {
      assert.match(c.body["file_url"] ?? "", /^https:\/\/panel\.test\/panel\/media\/vid_[a-f0-9]{12}\.mp4\?exp=\d+&sig=[0-9a-f]{64}$/);
      return { id: "900000000000001" };
    }
    if (u.pathname.endsWith("/search")) return { data: { cities: Object.fromEntries((JSON.parse(u.searchParams.get("cities") ?? "[]") as string[]).map((k) => [k, { country_code: "ES" }])) } };
    if (u.pathname.endsWith("/900000000000001")) return { status: { video_status: ready ? "ready" : "processing" } };
    if (u.pathname.endsWith("/900000000000001/thumbnails")) return { data: [{ uri: "https://scontent/thumb2.jpg", is_preferred: true }] };
    if (c.method === "POST" && u.pathname.endsWith("/campaigns")) return { id: "120000000000011" };
    if (c.method === "POST" && u.pathname.endsWith("/adsets")) return { id: "120000000000012" };
    if (c.method === "POST" && u.pathname.endsWith("/adcreatives")) return { id: "120000000000013" };
    if (c.method === "POST" && u.pathname.endsWith("/ads")) return { id: "120000000000014" };
    if (u.pathname.endsWith("/120000000000012")) return { daily_budget: "500", campaign: { status: "PAUSED" } };
    throw new Error(`llamada inesperada: ${c.method} ${c.url}`);
  };
  const env1 = { ...executorEnv };
  const f1 = stubFetch(handler);
  const origTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void) => origTimeout(fn, 0)) as typeof setTimeout;
  const did1 = await run(env1);
  f1.restore();
  assert.match(did1, /vídeo en proceso/);
  assert.ok(f1.calls.every((c) => !(c.method === "POST" && /\/(campaigns|adsets|ads|adcreatives)$/.test(new URL(c.url).pathname))), "no creó nada");
  let st = await DB.prepare(`select state from actions where code = 'VIDEO1'`).first<{ state: string }>();
  assert.equal(st?.state, "confirmed");

  // Segunda vuelta: ya está listo. No lo vuelve a subir.
  ready = true;
  const f2 = stubFetch(handler);
  const did2 = await run(env1);
  f2.restore();
  globalThis.setTimeout = origTimeout;
  assert.match(did2, /aplicada/);
  assert.ok(f2.calls.every((c) => !new URL(c.url).pathname.endsWith("/advideos")), "no volvió a subir el vídeo");
  const creative = JSON.parse(f2.calls.find((c) => new URL(c.url).pathname.endsWith("/adcreatives"))?.body["object_story_spec"] ?? "{}");
  assert.equal(creative.video_data.video_id, "900000000000001");
  assert.equal(creative.video_data.image_url, "https://scontent/thumb2.jpg");
  assert.equal(creative.video_data.title, "Agarre seco");
  assert.equal(creative.link_data, undefined);
  st = await DB.prepare(`select state from actions where code = 'VIDEO1'`).first<{ state: string }>();
  assert.equal(st?.state, "applied");
});

test("cada conversación tiene su historia, su material y su título, y el conocimiento llega al modelo", async () => {
  const { DB, panelEnv } = await setup();
  const cookie = await login(panelEnv);
  const post = (path: string, body: unknown, method = "POST") =>
    panel.fetch(req(path, { method, body: JSON.stringify(body), cookie }), panelEnv);

  // Conocimiento guardado desde su sección.
  const k = await post("/api/knowledge", { content: "Vendo pies de gato. Hablo de tú y sin exagerar." }, "PUT");
  assert.equal(k.status, 200);

  const a = (await (await post("/api/chats", {})).json()) as { id: number };
  const b = (await (await post("/api/chats", {})).json()) as { id: number };
  const sent: { instructions: string; input: { role?: string; content?: unknown }[] }[] = [];
  const f = stubFetch((c: Call) => {
    if (!c.url.includes("api.openai.com")) return {};
    sent.push(JSON.parse(c.body["json"] ?? "{}"));
    return { output: [{ type: "message", content: [{ type: "output_text", text: "vale" }] }], usage: { input_tokens: 10, output_tokens: 5 } };
  });
  try {
    await post("/api/chat", { chatId: a.id, text: "Campaña para Valencia" });
    await post("/api/chat", { chatId: b.id, text: "Campaña para Gavà" });
    await post("/api/chat", { chatId: a.id, text: "Sigamos" });
  } finally {
    f.restore();
  }
  assert.match(sent[0]!.instructions, /Hablo de tú y sin exagerar/);
  // Y la guía interna de tipos de campaña va siempre.
  assert.match(sent[0]!.instructions, /Los tipos de campaña de Meta/);
  assert.match(sent[0]!.instructions, /Promoción de la app/);
  // En la tercera llamada (conversación A) no aparece nada de la B.
  const third = JSON.stringify(sent[2]!.input);
  assert.match(third, /Campaña para Valencia/);
  assert.doesNotMatch(third, /Gavà/);

  const chats = (await (await panel.fetch(req("/api/chats", { cookie }), panelEnv)).json()) as { id: number; title: string }[];
  assert.equal(chats.find((c) => c.id === a.id)?.title, "Campaña para Valencia");
  assert.equal(chats[0]?.id, a.id, "la última usada va primero");

  // El material de B no se ve desde A, ni se puede proponer desde A.
  const draftB = ((await (await post("/api/drafts", { chatId: b.id })).json()) as { id: number }).id;
  const m = await upload(panelEnv, cookie, draftB, "gava.jpg", "image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 7]));
  const draftsA = (await (await panel.fetch(req(`/api/drafts?chat=${a.id}`, { cookie }), panelEnv)).json()) as unknown[];
  assert.equal(draftsA.length, 0);
  const { runTool } = await import("../src/panel/tools.ts");
  const out = (await runTool(panelEnv, "proponer_anuncio", {
    adSetId: "1", name: "x", ad: { mediaKey: m.key, headline: "h", primaryText: "t", cta: "SHOP_NOW", path: "/" },
  }, [], a.id)) as { error?: string };
  assert.equal(out.error, "no se puede proponer así");
  assert.equal((await DB.prepare(`select count(*) as n from actions`).first<{ n: number }>())?.n, 0);
});

test("borrar una conversación cancela sus propuestas, borra su material y respeta lo que se está aplicando", async () => {
  const { DB, panelEnv } = await setup();
  const IMAGES = panelEnv.IMAGES;
  const cookie = await login(panelEnv);
  const post = (path: string, body: unknown = {}) => panel.fetch(req(path, { method: "POST", body: JSON.stringify(body), cookie }), panelEnv);

  const chat = (await (await post("/api/chats")).json()) as { id: number };
  const draft = ((await (await post("/api/drafts", { chatId: chat.id })).json()) as { id: number }).id;
  const m = await upload(panelEnv, cookie, draft, "foto.jpg", "image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 9]));
  await DB.prepare(`insert into messages (chat_id, role, content) values (?, 'user', 'hola')`).bind(chat.id).run();
  await DB.prepare(`insert into actions (code, chat_id, type, title, lines, payload, state) values ('AAAAAA', ?, 'set_status', 't', '[]', '{}', 'running')`).bind(chat.id).run();
  await DB.prepare(`insert into actions (code, chat_id, type, title, lines, payload) values ('BBBBBB', ?, 'set_status', 't', '[]', '{}')`).bind(chat.id).run();

  // Con algo aplicándose, no se borra nada.
  const busy = await post(`/api/chats/${chat.id}/delete`);
  assert.equal(busy.status, 409);
  assert.ok(await IMAGES.get(m.key, "arrayBuffer"));

  await DB.prepare(`update actions set state = 'applied' where code = 'AAAAAA'`).run();
  const ok = await post(`/api/chats/${chat.id}/delete`);
  assert.equal(ok.status, 200);
  assert.equal(await IMAGES.get(m.key, "arrayBuffer"), null, "el material se borra del KV");
  assert.equal((await DB.prepare(`select count(*) as n from media`).first<{ n: number }>())?.n, 0);
  assert.equal((await DB.prepare(`select count(*) as n from messages where chat_id = ?`).bind(chat.id).first<{ n: number }>())?.n, 0);
  assert.equal((await DB.prepare(`select state from actions where code = 'BBBBBB'`).first<{ state: string }>())?.state, "cancelled");
  assert.equal((await DB.prepare(`select state from actions where code = 'AAAAAA'`).first<{ state: string }>())?.state, "applied", "el registro se conserva");
  assert.equal((await DB.prepare(`select count(*) as n from chats where id = ?`).bind(chat.id).first<{ n: number }>())?.n, 0);
});

test("una conversación se puede renombrar y el primer mensaje ya no le cambia el nombre", async () => {
  const { panelEnv } = await setup();
  const cookie = await login(panelEnv);
  const post = (path: string, body: unknown = {}) => panel.fetch(req(path, { method: "POST", body: JSON.stringify(body), cookie }), panelEnv);
  const c = (await (await post("/api/chats")).json()) as { id: number };
  assert.equal((await post(`/api/chats/${c.id}/rename`, { title: "   " })).status, 400);
  const r = (await (await post(`/api/chats/${c.id}/rename`, { title: "  Campaña   rocódromos " })).json()) as { title: string };
  assert.equal(r.title, "Campaña rocódromos");
  const { touchChat } = await import("../src/panel/chats.ts");
  await touchChat(panelEnv.DB, c.id, "Otra cosa");
  const list = (await (await panel.fetch(req("/api/chats", { cookie }), panelEnv)).json()) as { id: number; title: string }[];
  assert.equal(list.find((x) => x.id === c.id)?.title, "Campaña rocódromos");
});

test("El negocio sólo vende en su país: ni el panel ni el ejecutor dejan pasar una zona de fuera", async () => {
  const { validate } = await import("../src/shared/actions.ts");
  const base = { type: "set_audience" as const, adSetId: "120000000000002", name: "x" };
  assert.match(validate({ ...base, audience: { ageMin: 18, ageMax: 45, countries: ["FR"] } } as never, { maxAdSetDailyEur: 20, maxAccountDailyEur: 30, country: "ES" }).join(), /sólo vende en España/);
  assert.equal(validate({ ...base, audience: { ageMin: 18, ageMax: 45, countries: ["ES"] } } as never, { maxAdSetDailyEur: 20, maxAccountDailyEur: 30, country: "ES" }).length, 0);

  // Una ciudad de Kirguistán con el nombre de Gavà: el ejecutor la frena aunque venga confirmada.
  const { DB, executorEnv } = await setup();
  const action = { ...base, audience: { ageMin: 18, ageMax: 45, cities: [{ key: "1219263", name: "Gavà", radiusKm: 17 }] } };
  await DB.prepare(`insert into actions (code, type, title, lines, payload, state) values ('FUERA1', 'set_audience', 't', '[]', ?, 'confirmed')`).bind(JSON.stringify(action)).run();
  const meta = stubFetch((c: Call) => {
    const u = new URL(c.url);
    if (u.pathname.endsWith("/search")) return { data: { cities: { "1219263": { country_code: "KG", name: "Gava" } } } };
    throw new Error(`no debería llegar a Meta: ${c.method} ${c.url}`);
  });
  try {
    await run(executorEnv);
  } finally {
    meta.restore();
  }
  const row = await DB.prepare(`select state, error from actions where code = 'FUERA1'`).first<{ state: string; error: string }>();
  assert.equal(row?.state, "failed");
  assert.match(row?.error ?? "", /sólo vende en España.*Gava/);
  assert.ok(meta.calls.every((c) => c.method !== "POST"), "no escribió nada en Meta");
});

test("el tope de la cuenta no se salta diciendo «anuncio» con el id de una campaña", async () => {
  const { DB, executorEnv } = await setup();
  // El modelo dice que es un anuncio y lo llama «Anuncio viejo»; es una campaña de 15 €.
  const action = { type: "set_status", level: "ad", id: "120000000000001", name: "Anuncio viejo", status: "ACTIVE" };
  await DB.prepare(`insert into actions (code, type, title, lines, payload, state) values ('NIVEL1', 'set_status', 't', '[]', ?, 'confirmed')`)
    .bind(JSON.stringify(action))
    .run();
  const meta = stubFetch((c: Call) => {
    if (c.method === "POST") throw new Error("encendió la campaña");
    const known = accountObjects(c, { campaigns: [{ id: "120000000000001", name: "Rocódromos", status: "PAUSED" }] });
    if (known) return known;
    if (new URL(c.url).pathname.endsWith("/120000000000001/adsets")) return { data: [{ daily_budget: "1500" }] };
    return { data: [{ id: "1", status: "ACTIVE", daily_budget: "2500", campaign: { id: "120000000000009", status: "ACTIVE" } }] };
  });
  await run(executorEnv);
  meta.restore();
  const row = await DB.prepare(`select state, error from actions where code = 'NIVEL1'`).first<{ state: string; error: string }>();
  assert.equal(row?.state, "failed");
  assert.match(row?.error ?? "", /es una campaña \(«Rocódromos»\), no un anuncio/);
  assert.ok(meta.calls.every((c) => c.method !== "POST"));
});

test("un id que no es de la cuenta configurada no se toca", async () => {
  const { DB, executorEnv } = await setup();
  const action = { type: "set_budget", adSetId: "120000000000077", name: "x", dailyBudgetEur: 5 };
  await DB.prepare(`insert into actions (code, type, title, lines, payload, state) values ('AJENO1', 'set_budget', 't', '[]', ?, 'confirmed')`)
    .bind(JSON.stringify(action))
    .run();
  const meta = stubFetch((c: Call) => {
    if (c.method === "POST") throw new Error("escribió en algo ajeno");
    const known = accountObjects(c, {});
    if (known) return known;
    throw new Error(`llamada inesperada: ${c.method} ${c.url}`);
  });
  await run(executorEnv);
  meta.restore();
  const row = await DB.prepare(`select state, error from actions where code = 'AJENO1'`).first<{ state: string; error: string }>();
  assert.equal(row?.state, "failed");
  assert.match(row?.error ?? "", /no es ninguna campaña, conjunto ni anuncio de esta cuenta/);
});

test("el tope de la cuenta vale en todos los niveles: un anuncio, y una campaña con presupuesto de campaña", async () => {
  const { DB, executorEnv } = await setup();
  // Ya gastan 35 €: una campaña con presupuesto de campaña (20) y un conjunto (15).
  const on = [
    { id: "11", status: "ACTIVE", campaign: { id: "120000000000005", status: "ACTIVE", daily_budget: "2000" } },
    { id: "12", status: "ACTIVE", campaign: { id: "120000000000005", status: "ACTIVE", daily_budget: "2000" } },
    { id: "13", status: "ACTIVE", daily_budget: "1500", campaign: { id: "120000000000006", status: "ACTIVE" } },
  ];
  await DB.prepare(`insert into actions (code, type, title, lines, payload, state) values ('ANUNC1', 'set_status', 't', '[]', ?, 'confirmed')`)
    .bind(JSON.stringify({ type: "set_status", level: "ad", id: "120000000000020", name: "x", status: "ACTIVE" }))
    .run();
  const meta = stubFetch((c: Call) => {
    if (c.method === "POST") throw new Error("encendió pasando el tope");
    const known = accountObjects(c, { ads: [{ id: "120000000000020", name: "Pies de gato", status: "PAUSED", adset: { id: "13", daily_budget: "1500" } }] });
    if (known) return known;
    return { data: on };
  });
  await run(executorEnv);
  meta.restore();
  const row = await DB.prepare(`select state, error from actions where code = 'ANUNC1'`).first<{ state: string; error: string }>();
  assert.equal(row?.state, "failed");
  // 20 de la campaña (una vez, aunque tenga dos conjuntos) + 15.
  assert.match(row?.error ?? "", /35\.00 € al día y el tope de la cuenta es 30/);
});

test("la tarjeta enseña el nombre y el presupuesto de Meta, no los del modelo, y no propone un nivel que no es", async () => {
  const { DB, panelEnv } = await setup();
  const { runTool } = await import("../src/panel/tools.ts");
  const meta = stubFetch((c: Call) => {
    if (c.method === "POST") throw new Error("el panel escribió en Meta");
    const known = accountObjects(c, {
      campaigns: [{ id: "120000000000001", name: "Rocódromos", status: "PAUSED", daily_budget: "2500" }],
      adsets: [{ id: "120000000000002", name: "Valencia 25-45", status: "ACTIVE", daily_budget: "800", campaign: { id: "120000000000001" } }],
    });
    if (known) return known;
    throw new Error(`llamada inesperada: ${c.method} ${c.url}`);
  });
  const proposed: string[] = [];
  const ok = await runTool(panelEnv, "proponer_presupuesto", { adSetId: "120000000000002", name: "Prueba barata", dailyBudgetEur: 10 }, proposed, 1);
  const bad = await runTool(panelEnv, "proponer_estado", { level: "ad", id: "120000000000001", name: "Anuncio viejo", status: "ACTIVE" }, proposed, 1);
  meta.restore();
  assert.ok((ok as { propuesta?: string }).propuesta, JSON.stringify(ok));
  const row = await DB.prepare(`select title, lines from actions where code = ?`).bind(proposed[0]).first<{ title: string; lines: string }>();
  assert.equal(row?.title, "Presupuesto de «Valencia 25-45»");
  assert.deepEqual(JSON.parse(row?.lines ?? "[]"), ["Ahora: 8 € al día.", "Pasa a 10 € al día."]);
  assert.match(JSON.stringify(bad), /es una campaña \(«Rocódromos»\), no un anuncio/);
  assert.equal(proposed.length, 1);
});
