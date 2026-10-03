#!/usr/bin/env node
/**
 * Fails if anything that identifies a real installation is in the
 * repository: an ad account, a page, a pixel, a Cloudflare account, a
 * database, a mailbox, a token, a name.
 *
 * Two layers, on purpose:
 *
 * 1. Generic patterns, written here and public. They know the SHAPE of
 *    what must never be committed (act_ followed by digits, long numeric
 *    ids, 32-hex Cloudflare ids, D1 uuids, email addresses, workers.dev
 *    subdomains, API tokens) without knowing any real value.
 * 2. A private deny list, deny.local.json, gitignored. It holds the actual
 *    names and ids of the installation this code is synced from. It cannot
 *    live in the repository because it is exactly what must not be
 *    published. See examples/deny.example.json for the format.
 *
 * Usage:
 *   node tools/check-clean.mjs              scan the repository
 *   node tools/check-clean.mjs --require-deny   also fail without deny.local.json
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DENY_FILE = join(ROOT, "deny.local.json");

const SKIP_DIRS = new Set(["node_modules", ".git", ".wrangler", ".sync-staging", ".respaldos"]);
/** Local, gitignored files: they hold the real values on purpose and are never published. */
const LOCAL_FILE = /(^|\/)([^/]*\.local(\.[^/]+)?|\.dev\.vars|\.env|\.claves\.env|sync\.local\.mjs|deny\.local\.json)$/;

/**
 * Ids used in tests and examples look synthetic: a run of six identical
 * digits (120000000000001, 999999999999) or a plain ascending sequence
 * (1234567890). Real Meta ids do not.
 */
export function synthetic(digits) {
  return /(\d)\1{5,}/.test(digits) || "12345678901234567890".includes(digits);
}

const GENERIC = [
  { name: "Meta ad account id", re: /act_(\d{5,})/g, ok: (m) => synthetic(m[1]) },
  { name: "long numeric id (page, pixel, Instagram, app, business...)", re: /(?<![A-Za-z0-9+])(\d{10,})(?![A-Za-z0-9+])/g, ok: (m) => synthetic(m[1]) },
  { name: "32-hex id (Cloudflare account or KV namespace)", re: /(?<![0-9a-fA-F])[0-9a-f]{32}(?![0-9a-fA-F])/g },
  { name: "UUID (D1 database id)", re: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi },
  {
    name: "email address",
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
    ok: (m) => /@(?:[A-Za-z0-9-]+\.)*example\.(?:com|org|net)$/i.test(m[0]),
  },
  { name: "workers.dev subdomain", re: /[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/gi },
  { name: "phone number", re: /\+(\d{1,3} ?\d{8,})/g, ok: (m) => synthetic(m[1].replace(/ /g, "")) },
  { name: "OpenAI key", re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { name: "Meta access token", re: /\bEAA[A-Za-z0-9]{20,}/g },
  { name: "Resend key", re: /\bre_[A-Za-z0-9]{16,}/g },
  { name: "webhook secret", re: /\bwhsec_[A-Za-z0-9+/=]{16,}/g },
  { name: "account_id set in a config", re: /"account_id"\s*:\s*"(?!REPLACE_ME")[^"]+"/g },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * deny.local.json: { "everywhere": [...], "src": [...] }. Each entry is a
 * string (matched anywhere, ignoring case) or { "word": "..." } (only as a
 * whole word, for short names that are also pieces of ordinary words).
 * "src" entries apply only under src/: words that are fine in a test
 * fixture but mean the core is still talking about one business.
 */
export function loadDeny(file = DENY_FILE) {
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const compile = (list = []) =>
    list.map((e) => {
      const term = typeof e === "string" ? e : e.word;
      const word = typeof e !== "string";
      return {
        name: "private deny list",
        re: new RegExp(word ? `(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])` : escapeRe(term), "giu"),
      };
    });
  return { everywhere: compile(raw.everywhere), src: compile(raw.src) };
}

/** Every finding in one file: { path, line, rule, match }. */
export function scanText(path, text, deny) {
  const rules = [...GENERIC];
  if (deny) {
    rules.push(...deny.everywhere);
    if (path.startsWith("src/")) rules.push(...deny.src);
  }
  const findings = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const rule of rules) {
      for (const m of line.matchAll(rule.re)) {
        if (rule.ok?.(m)) continue;
        findings.push({ path, line: i + 1, rule: rule.name, match: m[0] });
      }
    }
  });
  return findings;
}

/** The files that would be published: tracked, or untracked and not ignored. */
export function publishableFiles(root = ROOT) {
  let list;
  try {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" });
    list = out.split("\0").filter(Boolean);
  } catch {
    list = walk(root, root);
  }
  return list.filter((p) => !LOCAL_FILE.test(p) && existsSync(join(root, p)));
}

function walk(root, dir) {
  return readdirSync(dir).flatMap((e) => {
    if (SKIP_DIRS.has(e)) return [];
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(root, p) : [relative(root, p).split(sep).join("/")];
  });
}

/** Text files only: a NUL byte means binary, and those are not scanned. */
export function readText(file) {
  const buf = readFileSync(file);
  if (buf.length > 5 * 1024 * 1024 || buf.includes(0)) return null;
  return buf.toString("utf8");
}

export function scanRepo(root = ROOT, deny = loadDeny()) {
  const findings = [];
  for (const p of publishableFiles(root)) {
    const text = readText(join(root, p));
    if (text !== null) findings.push(...scanText(p, text, deny));
  }
  return findings;
}

export function report(findings) {
  for (const f of findings) console.error(`  ${f.path}:${f.line}  ${f.rule}: ${f.match}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const deny = loadDeny();
  if (!deny) {
    const msg = "deny.local.json not found: only the generic patterns were checked.";
    if (process.argv.includes("--require-deny")) {
      console.error(`check-clean: ${msg}`);
      process.exit(1);
    }
    console.warn(`check-clean: ${msg}`);
  }
  const findings = scanRepo(ROOT, deny);
  if (findings.length > 0) {
    console.error(`check-clean: ${findings.length} finding(s). Nothing here may identify a real installation:`);
    report(findings);
    process.exit(1);
  }
  console.log(`check-clean: OK, ${publishableFiles().length} files scanned${deny ? " (generic patterns + private deny list)" : ""}.`);
}
