/**
 * Todos los objetivos: lo que cada uno le manda a Meta, el
 * formulario de contactos, los contactos con su aviso y las publicaciones
 * de Instagram ya hechas. Las combinaciones de conjunto salen de la tabla
 * de objetivos de Meta y pasaron `validate_only` el 03/10/2026.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncLeads } from "../src/executor/leads.ts";
import { apply, type Ctx } from "../src/executor/writer.ts";
import { validate, type Action, type AdCopy, type Objective } from "../src/shared/actions.ts";
import { META_VARS, accountObjects, fakeD1, stubFetch, type Call } from "./fakes.ts";

const limits = { maxAdSetDailyEur: 20, maxAccountDailyEur: 30, country: "ES" };

function ctxWith(kind: "image" | "video" = "image") {
  const forms: [string, string, string | null][] = [];
  const ctx: Ctx = {
    ...META_VARS,
    token: "write-token",
    media: async () => ({ kind, name: "a", metaHash: kind === "image" ? "hash1" : null, metaVideoId: kind === "video" ? "777000000001" : null }),
    imageBase64: async () => null,
    videoUrl: async () => "",
    rememberHash: async () => {},
    rememberVideo: async () => {},
    rememberForm: async (f, n, c) => void forms.push([f, n, c]),
    formOfCampaign: async () => "555000000001",
    sleep: async () => {},
  };
  return { ctx, forms };
}

/** Un Meta de mentira que contesta a todo lo que crea una campaña. */
function fakeMeta() {
  return stubFetch((c: Call) => {
    const u = new URL(c.url);
    const p = u.pathname;
    if (p.endsWith("/search")) return { data: { cities: {} } };
    if (c.method === "GET" && p.endsWith("/111111111111")) return { access_token: "page-token" };
    if (p.endsWith("/leadgen_forms")) return { id: "555000000001" };
    if (p.endsWith("/campaigns")) return { id: "120000000000001" };
    if (p.endsWith("/adsets")) return { id: "120000000000002" };
    if (p.endsWith("/adcreatives")) return { id: "120000000000003" };
    if (p.endsWith("/ads")) return { id: "120000000000004" };
    if (p.endsWith("/777000000001")) return { status: { video_status: "ready" } };
    if (p.endsWith("/thumbnails")) return { data: [{ uri: "https://thumb", is_preferred: true }] };
    if (p.endsWith("/120000000000002")) return { daily_budget: "500", campaign: { status: "PAUSED" } };
    throw new Error(`llamada inesperada: ${c.method} ${c.url}`);
  });
}

function campaign(objective: Objective, ad: AdCopy): Extract<Action, { type: "create_campaign" }> {
  return { type: "create_campaign", name: "Prueba", objective, dailyBudgetEur: 5, audience: { ageMin: 18, ageMax: 50, countries: ["ES"] }, ads: [ad] };
}

const photo: AdCopy = { mediaKey: "img_1.jpg", headline: "Pies de gato", primaryText: "Agarre seco." };

async function run(action: Action, kind: "image" | "video" = "image") {
  const { ctx, forms } = ctxWith(kind);
  const meta = fakeMeta();
  const out = await apply(action, ctx);
  meta.restore();
  const posts = meta.calls.filter((c) => c.method === "POST");
  const body = (path: string) => posts.find((c) => new URL(c.url).pathname.endsWith(path))?.body ?? {};
  const json = (path: string, field: string) => JSON.parse(body(path)[field] ?? "null");
  return { out, posts, body, json, forms, calls: meta.calls };
}

test("cada objetivo pide a Meta su fila de la tabla de objetivos", async () => {
  const cases: [Objective, AdCopy, string, Record<string, unknown>][] = [
    ["profile_visits", photo, "OUTCOME_TRAFFIC", { optimization_goal: "PROFILE_VISIT", destination_type: "INSTAGRAM_PROFILE" }],
    ["engagement", { ...photo, cta: "LEARN_MORE", path: "/" }, "OUTCOME_ENGAGEMENT", { optimization_goal: "POST_ENGAGEMENT", destination_type: "ON_POST" }],
    ["messages", photo, "OUTCOME_ENGAGEMENT", { optimization_goal: "CONVERSATIONS", destination_type: "INSTAGRAM_DIRECT", promoted_object: { page_id: "111111111111" } }],
    ["leads_form", { ...photo, cta: "SIGN_UP" }, "OUTCOME_LEADS", { optimization_goal: "LEAD_GENERATION", destination_type: "ON_AD", promoted_object: { page_id: "111111111111" } }],
  ];
  for (const [objective, ad, campaignObjective, adSet] of cases) {
    const action = campaign(objective, ad);
    assert.deepEqual(validate(action, limits), [], objective);
    const r = await run(action);
    assert.equal(r.out.ok, true, `${objective}: ${r.out.error}`);
    assert.equal(r.body("/campaigns")["objective"], campaignObjective, objective);
    assert.equal(r.body("/campaigns")["status"], "PAUSED", objective);
    for (const [k, v] of Object.entries(adSet)) {
      const sent = r.body("/adsets")[k];
      assert.deepEqual(typeof v === "object" ? JSON.parse(sent ?? "null") : sent, v, `${objective}: ${k}`);
    }
    // Las reglas fijas valen en todos: sólo Instagram, Advantage apagado, DSA.
    const t = r.json("/adsets", "targeting");
    assert.deepEqual(t.publisher_platforms, ["instagram"], objective);
    assert.deepEqual(t.targeting_automation, { advantage_audience: 0 }, objective);
    assert.equal(r.body("/adsets")["dsa_payor"], "Ana Ejemplo", objective);
  }
});

test("vídeo entero: ThruPlay, y una foto no sirve", async () => {
  const action = campaign("video_views", { ...photo, cta: "SHOP_NOW", path: "/" });
  const r = await run(action, "video");
  assert.equal(r.out.ok, true, r.out.error ?? "");
  assert.equal(r.body("/adsets")["optimization_goal"], "THRUPLAY");
  assert.equal(r.body("/adsets")["destination_type"], "ON_VIDEO");
  assert.ok(r.json("/adcreatives", "object_story_spec").video_data);

  const withPhoto = await run(action, "image");
  assert.equal(withPhoto.out.ok, false);
  assert.match(withPhoto.out.error ?? "", /no es un vídeo/);
});

test("Direct: botón de mensaje, sin enlace a la web y sin píxel en el anuncio", async () => {
  const r = await run(campaign("messages", photo));
  const spec = r.json("/adcreatives", "object_story_spec");
  assert.deepEqual(spec.link_data.call_to_action, { type: "INSTAGRAM_MESSAGE", value: { app_destination: "INSTAGRAM_DIRECT" } });
  assert.equal(spec.link_data.link, undefined);
  assert.equal(spec.instagram_user_id, "17841400000000000");
  assert.equal(r.body("/ads")["conversion_domain"], undefined);
});

test("visitas al perfil: el botón Ver perfil lleva a @exampleclimbingshop", async () => {
  const r = await run(campaign("profile_visits", photo));
  const ld = r.json("/adcreatives", "object_story_spec").link_data;
  assert.equal(ld.link, "https://www.instagram.com/exampleclimbingshop");
  assert.deepEqual(ld.call_to_action, { type: "VIEW_INSTAGRAM_PROFILE", value: { link: "https://www.instagram.com/exampleclimbingshop" } });
});

test("formulario: se crea con el token de la página, queda apuntado, sólo móvil y el anuncio lo lleva", async () => {
  const r = await run(campaign("leads_form", { ...photo, cta: "SIGN_UP" }));
  assert.equal(r.out.ok, true, r.out.error ?? "");
  const form = r.posts.find((c) => new URL(c.url).pathname.endsWith("/leadgen_forms"))!;
  assert.equal(form.body["access_token"], "page-token");
  assert.deepEqual(JSON.parse(form.body["questions"] ?? "[]"), [{ type: "FULL_NAME" }, { type: "EMAIL" }, { type: "PHONE" }]);
  assert.equal(JSON.parse(form.body["privacy_policy"] ?? "{}").url, "https://example.com/privacidad/");
  assert.equal(form.body["locale"], "ES_ES");
  // El formulario se crea antes que la campaña y se le pone la campaña después.
  assert.deepEqual(r.forms, [
    ["555000000001", "Prueba", null],
    ["555000000001", "Prueba", "120000000000001"],
  ]);
  assert.deepEqual(r.json("/adsets", "targeting").device_platforms, ["mobile"]);
  const ld = r.json("/adcreatives", "object_story_spec").link_data;
  assert.equal(ld.link, "https://fb.me/");
  assert.deepEqual(ld.call_to_action, { type: "SIGN_UP", value: { link: "https://fb.me/", lead_gen_form_id: "555000000001" } });
});

test("una publicación ya hecha sale tal cual, con su id de Instagram", async () => {
  const action = campaign("engagement", { instagramMediaId: "18000000000000001" });
  assert.deepEqual(validate(action, limits), []);
  const r = await run(action);
  assert.equal(r.out.ok, true, r.out.error ?? "");
  const c = r.body("/adcreatives");
  assert.equal(c["source_instagram_media_id"], "18000000000000001");
  assert.equal(c["object_id"], "111111111111");
  assert.equal(c["instagram_user_id"], "17841400000000000");
  assert.equal(c["object_story_spec"], undefined);
  assert.equal(c["call_to_action"], undefined, "sin botón si no se pidió");
});

test("botón y enlace según el objetivo", () => {
  const errs = (o: Objective, ad: AdCopy) => validate(campaign(o, ad), limits);
  assert.ok(errs("sales", photo).some((e) => /botón no válido/.test(e)), "ventas sin botón");
  assert.ok(errs("sales", { ...photo, cta: "SIGN_UP", path: "/" }).some((e) => /botón no válido/.test(e)));
  assert.ok(errs("leads_form", { ...photo, cta: "SHOP_NOW" }).some((e) => /formulario/.test(e)));
  assert.ok(errs("leads_form", { instagramMediaId: "18000000000000001", cta: "SIGN_UP" }).some((e) => /publicación ya hecha/.test(e)));
  assert.ok(errs("messages", { ...photo, instagramMediaId: "18000000000000001" }).some((e) => /una de las dos/.test(e)));
  assert.deepEqual(errs("messages", photo), []);
  assert.deepEqual(errs("profile_visits", photo), []);
});

test("añadir un anuncio: el objetivo se lee del conjunto en Meta, no de la acción", async () => {
  const { ctx } = ctxWith();
  const meta = stubFetch((c: Call) => {
    const p = new URL(c.url).pathname;
    const known = accountObjects(c, { adsets: [{ id: "120000000000002", name: "Mensajes", status: "ACTIVE", daily_budget: "500" }] });
    if (known) return known;
    if (c.method === "GET" && p.endsWith("/adsets")) return { data: [] };
    if (c.method === "GET" && p.endsWith("/120000000000002")) {
      return { destination_type: "INSTAGRAM_DIRECT", optimization_goal: "CONVERSATIONS", campaign: { id: "120000000000001", name: "Mensajes", objective: "OUTCOME_ENGAGEMENT" } };
    }
    if (p.endsWith("/adcreatives")) return { id: "120000000000003" };
    if (p.endsWith("/ads")) return { id: "120000000000004" };
    throw new Error(`llamada inesperada: ${c.method} ${c.url}`);
  });
  // Dice «ventas», pero el conjunto es de mensajes: sale con el botón de Direct.
  const out = await apply({ type: "add_ad", adSetId: "120000000000002", name: "Mensajes", objective: "sales", ad: { ...photo, cta: "SHOP_NOW", path: "/" } }, ctx);
  meta.restore();
  assert.equal(out.ok, true, out.error ?? "");
  const spec = JSON.parse(meta.calls.find((c) => new URL(c.url).pathname.endsWith("/adcreatives"))!.body["object_story_spec"] ?? "{}");
  assert.equal(spec.link_data.call_to_action.type, "INSTAGRAM_MESSAGE");
});

test("contactos: se bajan una vez, se avisa al dueño por correo y, si el correo falla, se reintenta", async () => {
  const DB = fakeD1();
  await DB.prepare(`insert into lead_forms (form_id, campaign_name, campaign_id) values ('555000000001', 'Rocódromos', '120000000000001')`).run();
  const env = {
    DB, META_TOKEN_WRITE: "write-token", META_PAGE_ID: "111111111111", MEDIA_URL_BASE: "https://example.com/panel",
    RESEND_API_KEY: "re_x", LEADS_FROM: META_VARS.LEADS_FROM, LEADS_NOTIFY_TO: META_VARS.LEADS_NOTIFY_TO,
  };
  let resendOk = false;
  const lead = {
    id: "900000000000001",
    created_time: "2026-10-03T10:00:00+0000",
    field_data: [
      { name: "full_name", values: ["Ana Pérez"] },
      { name: "email", values: ["ana@example.com"] },
      { name: "phone_number", values: ["+34600000000"] },
    ],
  };
  const handler = (c: Call) => {
    const u = new URL(c.url);
    if (u.hostname === "api.resend.com") {
      return resendOk ? { id: "mail1" } : new Response("caído", { status: 500 });
    }
    if (u.pathname.endsWith("/111111111111")) return { access_token: "page-token" };
    if (u.pathname.endsWith("/555000000001/leads")) {
      assert.equal(u.searchParams.get("access_token"), "page-token");
      return { data: [lead] };
    }
    throw new Error(`llamada inesperada: ${c.method} ${c.url}`);
  };

  let meta = stubFetch(handler);
  assert.equal(await syncLeads(env), "1 contactos nuevos, 0 avisados");
  meta.restore();
  const row = await DB.prepare(`select full_name, email, phone, notified_at, notify_error from leads`).first<Record<string, string | null>>();
  assert.equal(row?.full_name, "Ana Pérez");
  assert.equal(row?.phone, "+34600000000");
  assert.equal(row?.notified_at, null);
  assert.match(row?.notify_error ?? "", /Resend 500/);

  resendOk = true;
  meta = stubFetch(handler);
  // Meta devuelve el mismo contacto: no se duplica, y el aviso sale ahora.
  assert.equal(await syncLeads(env), "0 contactos nuevos, 1 avisados");
  meta.restore();
  const mail = JSON.parse(meta.calls.find((c) => new URL(c.url).hostname === "api.resend.com")!.body["json"] ?? "{}");
  assert.deepEqual(mail.to, ["owner@example.com"]);
  assert.match(mail.subject, /^Nuevo contacto: Ana Pérez · Rocódromos · /);
  assert.match(mail.text, /Teléfono: \+34600000000/);
  assert.match(mail.text, /https:\/\/example\.com\/panel\//);
  assert.equal((await DB.prepare(`select count(*) as n from leads`).first<{ n: number }>())?.n, 1);
  const filter = new URL(meta.calls.find((c) => c.url.includes("/leads"))!.url).searchParams.get("filtering") ?? "";
  assert.equal(JSON.parse(filter)[0].value, Math.floor(Date.UTC(2026, 9, 3, 10) / 1000), "pide sólo los posteriores al último");
});

test("contactos sin permiso: el error queda apuntado y no se rompe nada", async () => {
  const DB = fakeD1();
  await DB.prepare(`insert into lead_forms (form_id, campaign_name) values ('555000000001', 'Rocódromos')`).run();
  const meta = stubFetch((c: Call) => {
    if (new URL(c.url).pathname.endsWith("/leads")) {
      return new Response(JSON.stringify({ error: { message: "(#200) Requires leads_retrieval permission" } }), { status: 403 });
    }
    return { access_token: "page-token" };
  });
  await syncLeads({
    DB, META_TOKEN_WRITE: "w", META_PAGE_ID: "111111111111", MEDIA_URL_BASE: "https://x/panel",
    LEADS_FROM: "a", LEADS_NOTIFY_TO: "b",
  });
  meta.restore();
  const f = await DB.prepare(`select last_error from lead_forms`).first<{ last_error: string }>();
  assert.match(f?.last_error ?? "", /leads_retrieval/);
});
