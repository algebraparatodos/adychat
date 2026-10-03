// Copy to ../sync.local.mjs (gitignored) and fill it in. See SYNC.md.
//
// Rules run in order over every synced file. `files` limits a rule to some
// paths. `min` makes it required: if it matches fewer times, upstream
// changed that code and the sync stops instead of losing the change in
// silence. Strings are replaced literally, every occurrence. RegExps need
// the g flag and may use $1.

const TESTS = /^test\//;

export default {
  // The private panel, relative to this folder. It must be a git
  // repository: only its last commit is read.
  upstream: "../my-private-panel",

  rules: [
    // A hardcoded value becomes configuration. Required: if upstream
    // rewrites this line, the sync stops and asks for a new rule.
    {
      name: "country from configuration",
      files: /^src\/shared\/actions\.ts$/,
      from: 'if (c !== "XX")',
      to: "if (c !== country)",
      min: 1,
    },

    // Fixtures become a fictional business.
    { name: "test: brand", files: TESTS, from: "Acme Surf Shop", to: "Example Climbing Shop" },

    // Names in comments, everywhere.
    { name: "owner", from: /\bAlice\b/g, to: "el dueño" },
  ],
};
