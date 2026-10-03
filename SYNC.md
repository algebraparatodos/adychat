# Keeping Adychat in sync

Adychat is the generic core of a panel that runs, privately, for a real
business. That panel keeps moving. This file explains how its changes
reach this repository without its names, ids or business details coming
along.

## The model: regenerated, not edited

The code that comes from the private panel is **never edited by hand
here**. It is regenerated:

1. `tools/sync-from-panel.mjs` reads every file under `src/`, `test/`
   and `migrations/`, plus `schema.sql`, `tsconfig.json` and `tools/*.ts`,
   from the **last commit** of the private panel. Uncommitted work there
   is ignored on purpose.
2. Each file goes through an ordered list of rewrite rules. Some replace
   names in comments and fixtures. Others turn a hardcoded value into
   configuration (the country, the brand name, the time zone, the page
   title).
3. Everything is scanned (`tools/check-clean.mjs`) with the generic
   patterns and the private deny list.
4. Only if every required rule still matched **and** the scan is clean are
   the files written here. Then the whole repository is scanned again and
   the typecheck and the tests run.

If anything fails, nothing is written. The rewritten files are left in
`.sync-staging/` (gitignored) to look at.

An edit made by hand to a synced file would be overwritten by the next
sync. A change to that code goes either upstream or into a rule.

## What belongs to this repository

Never touched by the sync: `README.md`, `SYNC.md`, `LICENSE`,
`package.json`, `wrangler.jsonc`, `wrangler.executor.jsonc`,
`tools/*.mjs`, `examples/`, `.github/`, `.gitignore`, `.gitattributes`.

The sync warns, without failing, when upstream has a dependency version
or a Worker variable that this repository does not. Those are copied by
hand: the variable goes into both templates with a `REPLACE_ME`.

## The two private files

Both gitignored, both next to `package.json`. They cannot be published:
they name exactly what must not be.

- `sync.local.mjs`: where the private panel lives (`upstream`, a path
  relative to this folder) and the rules. Format in
  `examples/sync.example.mjs`.
- `deny.local.json`: the names and ids that must never appear. Format in
  `examples/deny.example.json`.

They exist only on the machine that runs the sync. Keep a copy somewhere
private: without them the next sync cannot be reproduced.

## Running it

```bash
npm run sync -- --dry-run   # what would change; writes nothing
npm run sync                # sync, scan, typecheck, test
git diff                    # review before committing
```

## When it stops

**`rule "..." matched 0 time(s), expected 1..any`**. Upstream changed the
code that rule rewrites. Look at the new upstream code, update the rule's
`from` (and `to`, if the change matters), run again. This is the
important failure: without it, a parametrisation could disappear in
silence and the core would go back to assuming one business.

**`N finding(s) in the rewritten code`**. Something new upstream names
the business, an account or a person, or a new hardcoded value showed up
in `src/`. Add a rule that rewrites it. If it is a real new identifier,
add it to `deny.local.json` too.

**`other files in the repository are not` clean**. The synced code is
fine but a file owned here (a README edit, a config) has something it
should not.

**Typecheck or tests fail**. Usually a rule changed a signature and a
caller upstream is new. Fix the rule set, not the generated file.

## The scan on its own

```bash
npm run check-clean
```

Without `deny.local.json` (in CI, for example) it checks only the generic
patterns and says so. Those patterns know the shape of what must not be
committed (`act_` followed by digits, long numeric ids, Cloudflare and D1
ids, email addresses outside `example.com`, `workers.dev` subdomains, API
tokens) and accept obviously synthetic test ids such as
`120000000000001`.
