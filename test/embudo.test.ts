/**
 * El embudo (aprobado el 02/10/2026): públicos que se recuerdan
 * lo máximo que deja Meta, campañas de reconocimiento y tráfico, incluir y
 * excluir públicos, y la etapa caliente frenada hasta las 100 personas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/executor/index.ts";
import { apply, type Ctx } from "../src/executor/writer.ts";
import { runTool } from "../src/panel/tools.ts";
import { validate, type Action } from "../src/shared/actions.ts";
import { META_VARS, accountObjects, fakeD1, fakeKV, stubFetch, type Call } from "./fakes.ts";

const limits = { maxAdSetDailyEur: 20, maxAccountDailyEur: 30, country: "ES" };

function executorEnv() {
  const DB = fakeD1();
  return {
    DB,
    env: {
      ...META_VARS, DB, IMAGES: fakeKV(), META_TOKEN_WRITE: "write-token",
      MEDIA_URL_BASE: "https://panel.test/panel", MEDIA_SIGNING_KEY: "firma",
    },
  };
}

async function confirmed(DB: D1Database, code: string, action: Action): Promise<void> {
  await DB.prepare(`insert into actions (code, type, title, lines, payload, state) values (?, ?, 't', '[]', ?, 'confirmed')`)
    .bind(code, action.type, JSON.stringify(action))
    .run();
}

test("público de la web: pide 365 días y, si Meta no los acepta, se queda con 180", async () => {
  const { DB, env } = executorEnv();
  await confirmed(DB, "PUB001", { type: "create_audience", kind: "web_visitors" });
  const meta = stubFetch((c: Call) => {
    const u = new URL(c.url);
    if (c.method === "GET" && u.pathname.endsWith("/customaudiences")) return { data: [] };
    if (c.method === "POST" && u.pathname.endsWith("/customaudiences")) {
      const rule = JSON.parse(c.body["rule"] ?? "{}");
      const days = rule.inclusions.rules[0].retention_seconds / 86400;
      if (days > 180) return new Response(JSON.stringify({ error: { message: "retention too long" } }), { status: 400 });
      return { id: "238000000000001" };
    }
    if (u.pathname.endsWith("/238000000000001")) return { id: "238000000000001", description: "panel:web_visitors" };
    throw new Error(`llamada inesperada: ${c.method} ${c.url}`);
  });
  await run(env);
  meta.restore();
  const posts = meta.calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 2);
  const first = JSON.parse(posts[0]!.body["rule"] ?? "{}").inclusions.rules[0];
  assert.equal(first.retention_seconds, 365 * 86400);
  assert.deepEqual(first.event_sources, [{ id: "999999999999", type: "pixel" }]);
  assert.equal(first.filter.filters[0].value, "PageView");
  assert.equal(posts[1]!.body["prefill"], "true");
  assert.equal(posts[1]!.body["name"], "Example Climbing Shop · Visitantes de la web");
  const row = await DB.prepare(`select state, result from actions where code = 'PUB001'`).first<{ state: string; result: string }>();
  assert.equal(row?.state, "applied");
  assert.deepEqual(JSON.parse(row?.result ?? "{}"), { audienceId: "238000000000001", days: 180 });
});

test("público de Instagram: 730 días sobre la cuenta de Instagram; si ya existe no se duplica", async () => {
  const { DB, env } = executorEnv();
  await confirmed(DB, "PUB002", { type: "create_audience", kind: "ig_engaged" });
  const meta = stubFetch((c: Call) => {
    const u = new URL(c.url);
    if (c.method === "GET" && u.pathname.endsWith("/customaudiences")) return { data: [] };
    if (c.method === "POST") return { id: "238000000000002" };
    return { id: "238000000000002", description: "panel:ig_engaged" };
  });
  await run(env);
  meta.restore();
  const rule = JSON.parse(meta.calls.find((c) => c.method === "POST")!.body["rule"] ?? "{}").inclusions.rules[0];
  assert.equal(rule.retention_seconds, 730 * 86400);
  assert.deepEqual(rule.event_sources, [{ id: "17841400000000000", type: "ig_business" }]);
  assert.equal(rule.filter.filters[0].value, "ig_business_profile_all");

  await confirmed(DB, "PUB003", { type: "create_audience", kind: "ig_engaged" });
  const again = stubFetch((c: Call) => {
    if (c.method === "POST") throw new Error("lo duplicó");
    return { data: [{ id: "238000000000002", description: "panel:ig_engaged" }] };
  });
  await run(env);
  again.restore();
  const row = await DB.prepare(`select state from actions where code = 'PUB003'`).first<{ state: string }>();
  assert.equal(row?.state, "applied");
});

test("la etapa caliente no se enciende con un público de menos de 100 personas", async () => {
  const { DB, env } = executorEnv();
  await confirmed(DB, "ON0001", { type: "set_status", level: "campaign", id: "120000000000001", name: "Calientes", status: "ACTIVE" });
  const meta = stubFetch((c: Call) => {
    const u = new URL(c.url);
    if (c.method === "POST") throw new Error("la encendió");
    const known = accountObjects(c, { campaigns: [{ id: "120000000000001", name: "Calientes", status: "PAUSED" }] });
    if (known) return known;
    if (u.pathname.endsWith("/120000000000001/adsets")) {
      return { data: [{ targeting: { custom_audiences: [{ id: "238000000000001" }] } }] };
    }
    if (u.pathname.endsWith("/238000000000001")) {
      return { name: "Example Climbing Shop · Visitantes de la web", approximate_count_lower_bound: 40, operation_status: { code: 300 } };
    }
    throw new Error(`llamada inesperada: ${c.method} ${c.url}`);
  });
  await run(env);
  meta.restore();
  const row = await DB.prepare(`select state, error from actions where code = 'ON0001'`).first<{ state: string; error: string }>();
  assert.equal(row?.state, "failed");
  assert.match(row?.error ?? "", /no llegan a 100 personas.*Visitantes de la web.*unas 40/);
});

test("campaña de reconocimiento: alcance con la página, y los públicos incluidos y excluidos llegan a Meta", async () => {
  const action: Action = {
    type: "create_campaign",
    name: "Conocer la tienda",
    objective: "awareness",
    dailyBudgetEur: 5,
    audience: {
      ageMin: 18,
      ageMax: 50,
      countries: ["ES"],
      include: [{ id: "238000000000002", name: "Example Climbing Shop · Interacción en Instagram" }],
      exclude: [{ id: "238000000000003", name: "Example Climbing Shop · Compradores web" }],
    },
    ads: [{ mediaKey: "img_1.jpg", headline: "Pies de gato", primaryText: "Agarre seco.", cta: "LEARN_MORE", path: "/" }],
  };
  assert.deepEqual(validate(action, limits), []);
  const ctx: Ctx = {
    ...META_VARS,
    token: "write-token",
    media: async () => ({ kind: "image", name: "a.jpg", metaHash: "hash1", metaVideoId: null }),
    imageBase64: async () => null,
    videoUrl: async () => "",
    rememberHash: async () => {},
    rememberVideo: async () => {},
    rememberForm: async () => {},
    formOfCampaign: async () => null,
  };
  const meta = stubFetch((c: Call) => {
    const u = new URL(c.url);
    if (u.pathname.endsWith("/search")) return { data: { cities: {} } };
    if (u.pathname.endsWith("/campaigns")) return { id: "120000000000001" };
    if (u.pathname.endsWith("/adsets")) return { id: "120000000000002" };
    if (u.pathname.endsWith("/adcreatives")) return { id: "120000000000003" };
    if (u.pathname.endsWith("/ads")) return { id: "120000000000004" };
    if (u.pathname.endsWith("/120000000000002")) return { daily_budget: "500", campaign: { status: "PAUSED" } };
    throw new Error(`llamada inesperada: ${c.method} ${c.url}`);
  });
  const out = await apply(action, ctx);
  meta.restore();
  assert.equal(out.ok, true, String(out.error));
  const body = (p: string) => meta.calls.find((c) => c.method === "POST" && new URL(c.url).pathname.endsWith(p))?.body ?? {};
  assert.equal(body("/campaigns")["objective"], "OUTCOME_AWARENESS");
  assert.equal(body("/campaigns")["status"], "PAUSED");
  assert.equal(body("/adsets")["optimization_goal"], "REACH");
  assert.deepEqual(JSON.parse(body("/adsets")["promoted_object"] ?? "{}"), { page_id: "111111111111" });
  const t = JSON.parse(body("/adsets")["targeting"] ?? "{}");
  assert.deepEqual(t.custom_audiences, [{ id: "238000000000002" }]);
  assert.deepEqual(t.excluded_custom_audiences, [{ id: "238000000000003" }]);
  assert.deepEqual(t.publisher_platforms, ["instagram"]);
});

test("en el chat: la campaña fría excluye sola a visitantes y compradores, y un público no se crea dos veces", async () => {
  const DB = fakeD1();
  await DB.prepare(`insert into chats (id, title) values (1, 'x')`).run();
  await DB.prepare(`insert into ad_drafts (id, chat_id, label) values (1, 1, 'a')`).run();
  await DB.prepare(`insert into media (key, draft_id, kind, name, content_type, size, complete) values ('img_1.jpg', 1, 'image', 'a.jpg', 'image/jpeg', 10, 1)`).run();
  const env = { ...META_VARS, DB, META_TOKEN_READ: "read-token" };
  const list = [
    { id: "238000000000001", name: "Example Climbing Shop · Visitantes de la web", description: "panel:web_visitors" },
    { id: "238000000000003", name: "Example Climbing Shop · Compradores web", description: "panel:web_buyers" },
    { id: "238000000000002", name: "Example Climbing Shop · Interacción en Instagram", description: "panel:ig_engaged" },
  ];
  const meta = stubFetch((c: Call) => {
    if (c.method !== "GET") throw new Error("el chat escribió en Meta");
    if (c.url.includes("/customaudiences")) return { data: list };
    throw new Error(`llamada inesperada: ${c.url}`);
  });
  const proposed: string[] = [];
  const out = await runTool(env, "proponer_campana", {
    name: "Fría",
    objective: "traffic",
    dailyBudgetEur: 4,
    audience: { ageMin: 18, ageMax: 45, countries: ["ES"] },
    ads: [{ mediaKey: "img_1.jpg", headline: "Pies de gato", primaryText: "Agarre.", cta: "SHOP_NOW", path: "/" }],
  }, proposed, 1);
  const dup = await runTool(env, "proponer_crear_publico", { kind: "web_buyers" }, proposed, 1);
  meta.restore();
  assert.ok((out as { propuesta?: string }).propuesta, JSON.stringify(out));
  const row = await DB.prepare(`select payload from actions where code = ?`).bind(proposed[0]).first<{ payload: string }>();
  const ex = (JSON.parse(row?.payload ?? "{}") as Action & { audience: { exclude: { id: string }[] } }).audience.exclude.map((r) => r.id);
  assert.deepEqual(ex.sort(), ["238000000000001", "238000000000003"]);
  assert.match(JSON.stringify(dup), /ya existe/);
  assert.equal(proposed.length, 1);
});

test("un público no puede estar incluido y excluido a la vez", () => {
  const r = { id: "238000000000001", name: "Visitantes" };
  const a: Action = {
    type: "set_audience", adSetId: "120000000000002", name: "x",
    audience: { ageMin: 18, ageMax: 45, countries: ["ES"], include: [r], exclude: [r] },
  };
  assert.match(validate(a, limits).join(), /incluido y excluido/);
});
