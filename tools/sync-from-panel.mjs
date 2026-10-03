#!/usr/bin/env node
/**
 * Brings the code up to date with the private panel it comes from.
 *
 * This repository is not edited by hand where the code comes from
 * upstream. It is REGENERATED: every file under src/, test/, migrations/,
 * plus schema.sql, tsconfig.json and tools/*.ts, is read from the
 * upstream's last commit and passed through an ordered list of rewrite
 * rules that turn one installation into the generic core (names out,
 * hardcoded values into configuration). Then everything is scanned for
 * anything that identifies a real installation, and only if the scan is
 * clean are the files written here.
 *
 * The rules and the upstream path live in sync.local.mjs, and the deny
 * list in deny.local.json. Both are gitignored, because both name exactly
 * what must not be published. See SYNC.md and examples/.
 *
 * Usage:
 *   node tools/sync-from-panel.mjs            sync, then typecheck and test
 *   node tools/sync-from-panel.mjs --dry-run  show what would change, write nothing
 *   node tools/sync-from-panel.mjs --no-check skip typecheck and tests
 *
 * Exit code 1 when a required rule no longer matches, when the scan finds
 * something, or when the typecheck or the tests fail.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, loadDeny, publishableFiles, readText, report, scanText } from "./check-clean.mjs";

/** What is taken from upstream. Everything else here belongs to this repository. */
const INCLUDE = [/^src\//, /^test\//, /^migrations\//, /^tools\/[^/]+\.ts$/, /^schema\.sql$/, /^tsconfig\.json$/];
/** Mirrored folders: a file here that upstream no longer has is deleted. */
const MIRRORED = [/^src\//, /^test\//, /^migrations\//];

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const noCheck = args.has("--no-check");

function fail(msg) {
  console.error(`sync: ${msg}`);
  process.exit(1);
}

const configFile = join(ROOT, "sync.local.mjs");
if (!existsSync(configFile)) fail("sync.local.mjs not found. Copy examples/sync.example.mjs and fill it in (see SYNC.md).");
const config = (await import(pathToFileURL(configFile).href)).default;
const deny = loadDeny();
if (!deny) fail("deny.local.json not found. Without it the scan cannot know the names that must not be published.");

const upstream = resolve(ROOT, config.upstream ?? "");
const git = (...a) => execFileSync("git", a, { cwd: upstream, maxBuffer: 64 * 1024 * 1024 });
let head;
try {
  head = git("rev-parse", "HEAD").toString().trim();
} catch {
  fail(`${upstream} is not a git repository.`);
}
if (git("status", "--porcelain").toString().trim()) {
  console.warn("sync: upstream has uncommitted changes. Only its last commit is synced.");
}

// 1. Read and rewrite.
const rules = (config.rules ?? []).map((r, i) => {
  if (r.from instanceof RegExp && !r.from.flags.includes("g")) fail(`rule ${i} (${r.name ?? "unnamed"}): a RegExp rule needs the g flag.`);
  return { ...r, name: r.name ?? `rule ${i}`, count: 0 };
});

function rewrite(path, text) {
  let out = text;
  for (const r of rules) {
    if (r.files && !r.files.test(path)) continue;
    if (typeof r.from === "string") {
      const parts = out.split(r.from);
      r.count += parts.length - 1;
      // split/join, not replaceAll: a "$" in the replacement stays a "$".
      out = parts.join(r.to);
    } else {
      out = out.replace(r.from, (...m) => {
        r.count++;
        return typeof r.to === "function" ? r.to(...m) : r.to.replace(/\$(\d)/g, (_, n) => m[Number(n)] ?? "");
      });
    }
  }
  return out;
}

const listed = git("ls-tree", "-r", "--name-only", "-z", "HEAD").toString("utf8").split("\0").filter(Boolean);
const wanted = listed.filter((p) => INCLUDE.some((re) => re.test(p)));
const outputs = new Map();
for (const p of wanted) {
  const buf = git("show", `HEAD:${p}`);
  if (buf.includes(0)) {
    outputs.set(p, buf);
    continue;
  }
  outputs.set(p, rewrite(p, buf.toString("utf8").replace(/\r\n/g, "\n")));
}

// 2. Rules that stopped matching mean upstream changed that code: the
//    parametrisation they carried would be silently lost.
const broken = rules.filter((r) => (r.min !== undefined && r.count < r.min) || (r.max !== undefined && r.count > r.max));
for (const r of broken) {
  console.error(`sync: rule "${r.name}" matched ${r.count} time(s), expected ${r.min ?? 0}..${r.max ?? "any"}.`);
}

// 3. Scan what would be written.
const findings = [];
for (const [p, content] of outputs) {
  if (typeof content === "string") findings.push(...scanText(p, content, deny));
}

// 4. Things a rule cannot carry: dependencies and Worker variables.
const upPkg = JSON.parse(git("show", "HEAD:package.json").toString("utf8"));
const ownPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
for (const field of ["dependencies", "devDependencies"]) {
  for (const [name, version] of Object.entries(upPkg[field] ?? {})) {
    if (ownPkg[field]?.[name] !== version) console.warn(`sync: upstream ${field} has ${name}@${version}, package.json has ${ownPkg[field]?.[name] ?? "nothing"}.`);
  }
}
const varsOf = (text) => new Set([...text.matchAll(/^\s*"([A-Z][A-Z0-9_]+)"\s*:/gm)].map((m) => m[1]));
for (const [up, own] of [["wrangler.jsonc", "wrangler.jsonc"], ["wrangler.executor.jsonc", "wrangler.executor.jsonc"]]) {
  if (!listed.includes(up) || !existsSync(join(ROOT, own))) continue;
  const have = varsOf(readFileSync(join(ROOT, own), "utf8"));
  for (const v of varsOf(git("show", `HEAD:${up}`).toString("utf8"))) {
    if (!have.has(v)) console.warn(`sync: upstream ${up} has a variable ${v} that ${own} does not. Add it with a placeholder.`);
  }
}

// 5. What changes here.
const stale = publishableFiles(ROOT).filter((p) => MIRRORED.some((re) => re.test(p)) && !outputs.has(p));
const changed = [];
for (const [p, content] of outputs) {
  const file = join(ROOT, p);
  const before = existsSync(file) ? readFileSync(file) : null;
  const now = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  if (!before) changed.push(`new      ${p}`);
  else if (!before.equals(now)) changed.push(`changed  ${p}`);
}
for (const p of stale) changed.push(`deleted  ${p}`);
console.log(`sync: upstream ${head.slice(0, 7)}, ${outputs.size} files, ${changed.length} change(s).`);
for (const c of changed) console.log(`  ${c}`);

if (broken.length > 0 || findings.length > 0) {
  if (findings.length > 0) {
    console.error(`sync: ${findings.length} finding(s) in the rewritten code. Add or fix a rule in sync.local.mjs:`);
    report(findings);
  }
  // Leave the result where it can be inspected, without touching the repository.
  const staging = join(ROOT, ".sync-staging");
  rmSync(staging, { recursive: true, force: true });
  for (const [p, content] of outputs) {
    mkdirSync(dirname(join(staging, p)), { recursive: true });
    writeFileSync(join(staging, p), content);
  }
  fail("nothing was written. The rewritten files are in .sync-staging/ to look at.");
}
if (dryRun) {
  console.log("sync: dry run, nothing written.");
  process.exit(0);
}

// 6. Write.
for (const [p, content] of outputs) {
  mkdirSync(dirname(join(ROOT, p)), { recursive: true });
  writeFileSync(join(ROOT, p), content);
}
for (const p of stale) rmSync(join(ROOT, p));
rmSync(join(ROOT, ".sync-staging"), { recursive: true, force: true });
writeFileSync(join(ROOT, ".sync-state.local.json"), `${JSON.stringify({ upstreamCommit: head, at: new Date().toISOString() }, null, 2)}\n`);

// 7. The whole repository, not only what was synced: README, configs, tools.
const all = [];
for (const p of publishableFiles(ROOT)) {
  const text = readText(join(ROOT, p));
  if (text !== null) all.push(...scanText(p, text, deny));
}
if (all.length > 0) {
  console.error("sync: the synced code is clean, but other files in the repository are not:");
  report(all);
  process.exit(1);
}

if (!noCheck) {
  // Node directly, no shell: the same commands as `npm run typecheck` and `npm test`.
  const checks = [
    ["typecheck", [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "--noEmit"]],
    ["tests", ["--test", "--experimental-sqlite"]],
  ];
  for (const [label, argv] of checks) {
    console.log(`sync: ${label}`);
    const r = spawnSync(process.execPath, argv, { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0) fail(`${label} failed.`);
  }
}
console.log("sync: done. Review with git diff before committing.");
