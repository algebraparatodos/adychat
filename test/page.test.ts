/**
 * El JS de la página va dentro de una plantilla de TypeScript: un "\n" sin
 * doblar se convierte en un salto de línea real y rompe la página entera
 * sin que tsc lo note. Esto lo detecta.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGE } from "../src/panel/ui.ts";

test("el JavaScript de la página se puede leer entero", () => {
  const js = PAGE.split("<script>")[1]?.split("</script>")[0] ?? "";
  assert.ok(js.length > 1000);
  assert.doesNotThrow(() => new Function(js));
});

test("la página trae las cuatro secciones del menú", () => {
  for (const v of ["chat", "results", "leads", "knowledge"]) assert.match(PAGE, new RegExp(`data-view="${v}"`));
  assert.match(PAGE, />\s*Contactos<\/button>/);
  assert.match(PAGE, />\s*Crear campañas<\/button>/);
  assert.match(PAGE, />\s*Conocimiento<\/button>/);
});
