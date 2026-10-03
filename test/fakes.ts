/**
 * Una D1 y un KV de mentira para probar los Workers en Node, y un fetch
 * que hace de Meta y de OpenAI. Nada de esto llega a internet.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function fakeD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("schema.sql", "utf8"));
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
      bind(...p: unknown[]) {
        params = p;
        return stmt;
      },
      async first<T>() {
        return (db.prepare(sql).get(...(params as never[])) ?? null) as T | null;
      },
      async all<T>() {
        return { results: db.prepare(sql).all(...(params as never[])) as T[] };
      },
      async run() {
        const r = db.prepare(sql).run(...(params as never[]));
        return { meta: { changes: Number(r.changes) } };
      },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

export function fakeKV(): KVNamespace {
  const store = new Map<string, { value: Uint8Array; metadata: unknown }>();
  return {
    async put(key: string, value: ArrayBuffer, opts?: { metadata?: unknown }) {
      store.set(key, { value: new Uint8Array(value), metadata: opts?.metadata ?? null });
    },
    async get(key: string) {
      return store.get(key)?.value.slice().buffer ?? null;
    },
    async delete(key: string) {
      store.delete(key);
    },
    async getWithMetadata(key: string) {
      const v = store.get(key);
      return { value: v ? v.value.slice().buffer : null, metadata: v?.metadata ?? null };
    },
  } as unknown as KVNamespace;
}

export type Call = { method: string; url: string; body: Record<string, string> };

/** Sustituye fetch; `handler` decide qué contesta cada llamada. */
export function stubFetch(handler: (c: Call) => unknown): { calls: Call[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body: Record<string, string> = {};
    if (init?.body instanceof URLSearchParams) for (const [k, v] of init.body) body[k] = v;
    else if (typeof init?.body === "string") body["json"] = init.body;
    const call = { method, url, body };
    calls.push(call);
    const out = handler(call);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

export const META_VARS = {
  META_ACCOUNT_ID: "act_1234567890",
  META_PAGE_ID: "111111111111",
  META_IG_USER_ID: "17841400000000000",
  META_IG_USERNAME: "exampleclimbingshop",
  META_PIXEL_ID: "999999999999",
  SITE_URL: "https://example.com",
  META_DSA_BENEFICIARY: "Example Climbing Shop",
  META_DSA_PAYOR: "Ana Ejemplo",
  BRAND_NAME: "Example Climbing Shop",
  COUNTRY: "ES",
  MAX_ADSET_DAILY_EUR: "20",
  MAX_ACCOUNT_DAILY_EUR: "30",
  LEADS_FROM: "Example Climbing Shop <ads@example.com>",
  LEADS_NOTIFY_TO: "owner@example.com",
};
