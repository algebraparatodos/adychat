import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, describe, type Action } from "../src/shared/actions.ts";
import { hashPassword, verifyPassword } from "../src/panel/auth.ts";

const limits = { maxAdSetDailyEur: 20, maxAccountDailyEur: 30, country: "ES" };
const ad = {
  mediaKey: "img_abcd12345678.jpg",
  headline: "Pies de gato · 79 €",
  primaryText: "Hecho para escalar.",
  cta: "SHOP_NOW" as const,
  path: "/",
};
const audience = {
  ageMin: 18,
  ageMax: 45,
  cities: [{ key: "100001", name: "Valencia", radiusKm: 25 }],
};

test("una campaña bien hecha pasa y la tarjeta avisa de que nace apagada", () => {
  const a: Action = { type: "create_campaign", name: "Pies de gato VLC", dailyBudgetEur: 10, audience, ads: [ad] };
  assert.deepEqual(validate(a, limits), []);
  assert.match(describe(a).lines.join("\n"), /APAGADA/);
});

test("el presupuesto por encima del tope no pasa", () => {
  const a: Action = { type: "set_budget", adSetId: "123456789", name: "x", dailyBudgetEur: 25 };
  assert.match(validate(a, limits).join(), /no puede pasar de 20/);
});

test("un enlace a otro dominio no pasa", () => {
  const a: Action = { type: "add_ad", adSetId: "123456789", name: "x", ad: { ...ad, path: "//evil.com" } };
  assert.match(validate(a, limits).join(), /página de la web/);
});

test("sin zona no pasa", () => {
  const a: Action = { type: "set_audience", adSetId: "123456789", name: "x", audience: { ...audience, cities: [] } };
  assert.match(validate(a, limits).join(), /falta la zona/);
});

test("una acción inventada no pasa", () => {
  assert.deepEqual(validate({ type: "delete_everything" } as unknown as Action, limits), ["acción desconocida"]);
});

test("la contraseña se verifica y el hash no la contiene", async () => {
  const h = await hashPassword("una-clave-de-prueba");
  assert.ok(!h.includes("una-clave"));
  assert.equal(await verifyPassword("una-clave-de-prueba", h), true);
  assert.equal(await verifyPassword("otra", h), false);
  assert.equal(await verifyPassword("x", "basura"), false);
});
