/**
 * La frontera, comprobada en vez de prometida: el Worker con dirección en
 * internet no puede escribir en Meta, y el que puede no tiene dirección.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const WRITER = join("src", "executor", "writer.ts");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

function imports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/from\s+["'](\.[^"']+)["']/g)].map((m) => {
    const parts = file.replaceAll("\\", "/").split("/").slice(0, -1);
    for (const step of (m[1] ?? "").split("/")) {
      if (step === ".") continue;
      if (step === "..") parts.pop();
      else parts.push(step);
    }
    return join(...parts);
  });
}

test("sólo el writer del ejecutor puede hacer POST a Meta", () => {
  for (const f of files("src")) {
    if (f === WRITER) continue;
    const src = readFileSync(f, "utf8");
    const graph = src.includes("graph.facebook.com") || /\bGRAPH\b/.test(src);
    assert.ok(!(graph && /method:\s*["']POST["']/.test(src)), `${f} nombra la Graph API y hace POST`);
  }
});

test("el panel no llega al ejecutor por ningún import", () => {
  const seen = new Set<string>();
  const queue = [join("src", "panel", "index.ts")];
  while (queue.length) {
    const f = queue.pop() ?? "";
    if (seen.has(f)) continue;
    seen.add(f);
    assert.ok(!f.includes(join("src", "executor")), `el panel importa ${f}`);
    queue.push(...imports(f));
  }
  assert.ok(seen.size >= 7, `sólo siguió ${seen.size} archivos: el recorrido está roto`);
});

test("el ejecutor no tiene fetch ni dirección", () => {
  const src = readFileSync(join("src", "executor", "index.ts"), "utf8");
  assert.ok(!/^\s*async fetch\(/m.test(src));
  const conf = readFileSync("wrangler.executor.jsonc", "utf8");
  assert.match(conf, /"workers_dev":\s*false/);
  assert.doesNotMatch(conf, /"routes?"\s*:/);
});
