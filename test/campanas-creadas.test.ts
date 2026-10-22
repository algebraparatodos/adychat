/**
 * «Campañas creadas» (03/10/2026): campañas → conjuntos → anuncios
 * tal como están en Meta, con la vista previa de cada anuncio ya creado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MetaReader, adCopy, structure } from "../src/panel/meta-read.ts";
import { adPreview } from "../src/panel/preview.ts";
import { stubFetch, type Call } from "./fakes.ts";

const FRAME = "https://business.facebook.com/ads/api/preview_iframe.php?d=x&amp;t=y";

test("el texto de un anuncio sale de la foto, del vídeo o de la foto por sitio", () => {
  assert.deepEqual(adCopy({ object_story_spec: { link_data: { name: "T", message: "M", link: "https://s/" } } }), { titular: "T", texto: "M", enlace: "https://s/" });
  assert.deepEqual(adCopy({ object_story_spec: { video_data: { title: "V", message: "Mv", call_to_action: { value: { link: "https://s/v" } } } } }), {
    titular: "V",
    texto: "Mv",
    enlace: "https://s/v",
  });
  assert.deepEqual(adCopy({ asset_feed_spec: { titles: [{ text: "A" }], bodies: [{ text: "Ma" }], link_urls: [{ website_url: "https://s/a" }] } }), {
    titular: "A",
    texto: "Ma",
    enlace: "https://s/a",
  });
  assert.deepEqual(adCopy({ source_instagram_media_id: "18000000000000001" }), { publicacion_de_instagram: true });
});

test("la pantalla trae campaña → conjunto → anuncio, con el tipo en castellano y la miniatura", async () => {
  const meta = stubFetch((c: Call) => {
    const p = new URL(c.url).pathname;
    if (p.endsWith("/campaigns")) return { data: [{ id: "1201", name: "Rocódromos", status: "PAUSED", effective_status: "PAUSED", created_time: "2026-10-03T10:00:00+0000", objective: "OUTCOME_ENGAGEMENT" }] };
    if (p.endsWith("/adsets")) {
      return { data: [{ id: "1202", name: "Conjunto", status: "ACTIVE", effective_status: "CAMPAIGN_PAUSED", campaign_id: "1201", daily_budget: "500", destination_type: "INSTAGRAM_DIRECT", optimization_goal: "CONVERSATIONS", targeting: { geo_locations: { countries: ["ES"] }, age_min: 18, age_max: 45, publisher_platforms: ["instagram"] } }] };
    }
    if (p.endsWith("/ads")) {
      return { data: [{ id: "1203", name: "Anuncio", status: "ACTIVE", effective_status: "CAMPAIGN_PAUSED", adset_id: "1202", creative: { thumbnail_url: "https://thumb/1.jpg", object_story_spec: { video_data: { title: "Escríbenos", message: "Te contamos." } } } }] };
    }
    throw new Error(`llamada inesperada: ${c.url}`);
  });
  const reader = new MetaReader("read-token", "act_1");
  const screen = (await structure(reader, true)) as { conjuntos: { objetivo_es: string; presupuesto_diario_eur: number; anuncios: Record<string, unknown>[] }[] }[];
  const forModel = (await structure(reader)) as typeof screen;
  meta.restore();
  const set = screen[0]!.conjuntos[0]!;
  assert.equal(set.objetivo_es, "Interacción (mensajes por Instagram Direct)");
  assert.equal(set.presupuesto_diario_eur, 5);
  assert.equal(set.anuncios[0]!["titular"], "Escríbenos");
  assert.equal(set.anuncios[0]!["texto"], "Te contamos.");
  assert.equal(set.anuncios[0]!["miniatura"], "https://thumb/1.jpg");
  // Al modelo no le llegan ni la miniatura ni el nombre en castellano.
  assert.equal(forModel[0]!.conjuntos[0]!.anuncios[0]!["miniatura"], undefined);
  assert.equal((forModel[0]!.conjuntos[0] as Record<string, unknown>)["objetivo_es"], undefined);
  assert.ok(meta.calls.every((c) => c.method === "GET"));
});

test("vista previa de un anuncio ya creado: Meta la dibuja del anuncio mismo, sólo leyendo, con su texto al lado", async () => {
  const long = "Nacido en la roca, donde cada regleta cuenta. 100 % carbonato de pies de gato, grano fino y bolsa de kraft con cierre zip para que no se te escape ni un gramo.";
  const meta = stubFetch((c: Call) => {
    const u = new URL(c.url);
    if (u.pathname.endsWith("/1203/previews")) {
      assert.equal(u.searchParams.get("ad_format"), "INSTAGRAM_STANDARD");
      return { data: [{ body: `<iframe src="${FRAME}" width="320" height="525" scrolling="yes"></iframe>` }] };
    }
    if (u.pathname.endsWith("/1203")) {
      return { creative: { call_to_action_type: "SHOP_NOW", object_story_spec: { link_data: { name: "Pies de gato", message: long, link: "https://example.com/?utm_source=meta" } } } };
    }
    throw new Error(`llamada inesperada: ${c.url}`);
  });
  const r = await adPreview(new MetaReader("read-token", "act_1"), "1203", "feed");
  meta.restore();
  assert.ok(meta.calls.every((c) => c.method === "GET"), "sólo lee");
  assert.equal("src" in r && r.src, FRAME.replace("&amp;", "&"));
  assert.ok("height" in r && r.height > 640, "sin medidas de la foto y con texto largo: el más alto, con sitio para el texto");
  assert.equal(r.copy?.headline, "Pies de gato");
  assert.equal(r.copy?.text, long);
  assert.ok(r.copy?.cut);
  assert.deepEqual([r.copy?.button, r.copy?.goesTo], ["Comprar", "example.com/"]);
});
