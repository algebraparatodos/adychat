# Adychat

Create and manage Meta Ads campaigns by chatting with an AI. No agency,
no Ads Manager. Spend caps the AI cannot override, and every campaign is
born paused.

```
Tú:         Quiero una campaña en Valencia para las zapatillas nuevas.
Asistente:  ¿Para quién son? ... Te dejo tres titulares para elegir ...
            ¿Cuánto quieres gastar al día?
Tú:         10 euros.

  +--------------------------------------------------------------------+
  | Crear la campaña «Zapatillas · Valencia»                           |
  | Ventas (busca compradores) · 10 € al día                           |
  | Zona: Valencia (+25 km)                                            |
  | Dónde sale: Instagram (feed, historias y reels)                    |
  | Se crea APAGADA. Para que empiece a gastar hay que encenderla      |
  | aparte.                                                            |
  |            [ Ver cómo queda ]   [ Confirmar ]   [ Cancelar ]       |
  +--------------------------------------------------------------------+
```

The owner describes what they want, answers a few questions and gets a
card. Nothing happens in Meta until they tap "Confirmar", and what gets
created is paused. The interface and the assistant speak Spanish (Spain).

Two Cloudflare Workers and a D1 database. No servers. The person using it
never opens Ads Manager.

## Why it exists

Advertising on Instagram is cheap to start and hard to do well. Ads
Manager asks for dozens of decisions before the first ad exists, most of
them in vocabulary a shop owner has never needed, and the usual way out
is an agency that costs more per month than the ads themselves.

The idea here is to put that knowledge in the conversation instead. The
assistant behaves like a patient guide: it asks one thing at a time,
explains in plain words why it suggests an audience or an objective,
writes two or three options for the copy, and never decides the budget.
The owner uploads the photos or videos for each ad and answers questions.
Everything else is proposed, explained, and only then applied.

That only works if handing the conversation to a language model is safe,
and with real money on the other side "safe" cannot mean "the prompt
says so". So the dangerous parts are not in the prompt at all.

## The part worth stealing

**Two Workers, and only one of them can spend money.**

```
  +- panel ----------------------------+   Meta: read-only access
  |  fetch: the chat, the cards,       |   OpenAI key
  |  the results, the previews         |
  |  reads the account, cannot write   |
  |  stores PROPOSALS in the database  |
  +-----------------+------------------+
                    |  shared D1 database
  +-----------------+------------------+
  |  executor                          |   Meta: can manage campaigns
  |  cron every minute, NO fetch       |
  |  no address on the internet        |
  |  applies only what was CONFIRMED,  |
  |  re-validated with ITS OWN caps    |
  +------------------------------------+
```

The model never writes to Meta. Its tools either read (with the
read-only access) or propose: a proposal is validated, stored, and shown
to the owner as a card. Only the owner's tap on "Confirm" marks it for
the executor.

The executor has no `fetch` handler and `workers_dev` is off, so there is
nothing to attack: it wakes up every minute, picks up confirmed actions,
validates each one again against the caps in **its own** configuration,
applies it, reads it back from Meta to check it took, and goes back to
sleep. Somebody who took over the panel completely and wrote a
"confirmed" action straight into the database still could not get past
those caps, because they are not in the database and not in the panel.

A caveat that cost a day to learn: Meta forces `ads_management` and
friends into every token of some apps, and they cannot be unticked. So
what keeps the panel's token read-only is **not its list of scopes but
the access of its system user** ("View performance" on the ad account).
Check it the only way that means anything, by asking Meta to create
something with it:

```
POST /act_<your account>/campaigns  ... execution_options=["validate_only"]
  -> "Permissions error"   (anything else: that token does not belong in the panel)
```

The boundary is enforced by a test, not by a comment:
`test/boundary.test.ts` fails if any file other than the executor's
writer can POST to the Graph API, if anything imported from the panel
reaches the executor, or if the executor grows a `fetch` handler or a
route.

## What the AI cannot do

These live in code that the model does not control.

- **Spend above the caps.** A daily cap per ad set and a daily cap for
  the whole account, counting everything that is turned on, computed from
  Meta at the moment of applying. They are Worker variables of the
  executor and only change by deploying. The account cap is checked on
  everything that can raise the spend, at any level, and counts campaign
  budgets; if something turned on has a lifetime budget, the cap cannot be
  checked and the action is rejected.
- **Act on something other than what the card says.** The id, the level
  and the name in a proposal come from the model, so none of them is
  trusted: the panel when proposing, and the executor again when applying,
  look the id up among the campaigns, ad sets and ads of the configured
  account (`src/shared/objects.ts`) and reject it if it is not there or is
  not the level the action claims. The card shows the name and budget Meta
  returns, not the model's.
- **Start spending by itself.** Every campaign is created `PAUSED` and the
  campaign is the only switch. Turning it on is its own proposal, with its
  own card.
- **Do anything outside a closed list.** Create a campaign, create an
  audience, turn on or pause, change a budget, change an audience, add an
  ad, change an ad's text. Anything else is rejected, in the panel and
  again in the executor (`src/shared/actions.ts`).
- **Leave the country.** The business sells in one country (`COUNTRY`).
  A city key does not say which country it belongs to, so cities are
  checked against Meta when proposing and again in the executor.
- **Leave Instagram.** Placements are fixed to Instagram feed, stories and
  reels in the executor. No Facebook, no Audience Network.
- **Let Meta improvise.** Advantage+ audience is off (in both fields that
  need it) and the automatic creative enhancements are opted out. The ad
  goes out as it was approved.
- **Run up the AI bill.** A daily and a monthly ceiling in euros for the
  model, checked before every call.
- **Apply a stale yes.** A proposal nobody confirmed expires after 24
  hours; a confirmed one the executor did not pick up within 30 minutes
  expires too.

## What it does

- **Creates campaigns** with any of eight objectives: sales (optimising
  for purchases on the pixel), awareness, website traffic, Instagram
  profile visits, engagement, video views, Instagram Direct messages and
  lead forms. Each ad uses its own uploaded photo or video, or an existing
  Instagram post.
- **Shows the ad before confirming.** "See how it looks" on every card
  asks Meta to render it in Feed, Stories and Reels (`generatepreviews`,
  read-only), with the text cut where Instagram cuts it. The creative in
  the preview comes from the same function the executor uses to create it,
  and `test/vista-previa.test.ts` fails if the two ever diverge. From the
  preview the owner can crop an uploaded photo by hand for each placement
  (for now only in ads that link to the website).
- **Builds a funnel.** Four custom audiences it knows how to create (web
  visitors, reached checkout, buyers, Instagram engagement), each kept for
  the longest window Meta allows. Buyers are excluded automatically
  everywhere, and visitors too in the cold stages. A warm stage will not
  turn on while its audience is under about 100 people.
- **Explains results when asked.** Ask how the ads are doing and it reads
  spend, clicks, purchases, cost per purchase and ROAS from Meta, says in
  plain words what is going well and what is not, and what it would
  change. Any change comes back as a card to confirm. It does not watch
  the account on its own.
- **Collects leads.** Lead form ads create their form on confirmation;
  the executor downloads new leads every five minutes, keeps them in the
  panel and emails each one to the owner.
- **Remembers the brand.** A "Conocimiento" page where the owner writes
  what they sell, prices, tone and words to avoid, read by the assistant
  on every turn. Fixed facts the installer sets go in `BUSINESS_FACTS`.
- **Keeps conversations apart.** Several conversations, each with its
  own history and its own uploaded material.
- **Locks the door.** Password plus mandatory two-step verification
  (TOTP) for the main user. The secret is encrypted in the database. The
  session records whether the code was given, and every route checks it,
  not just the login. Preview URLs are off in the template: with them,
  Cloudflare keeps old versions of the panel reachable on the same database.

## Setup

You need a Cloudflare account, a Meta business portfolio with an ad
account, a Facebook page, an Instagram professional account and a pixel,
a Meta app with **two system users** (one that can only view the ad
account, one that can manage campaigns), an OpenAI API key, and
optionally a Resend key to email leads.

```bash
npm install
cp wrangler.jsonc wrangler.local.jsonc
cp wrangler.executor.jsonc wrangler.executor.local.jsonc

npx wrangler d1 create adychat              # put the id in both local files
npx wrangler kv namespace create IMAGES     # same
# fill in every REPLACE_ME in both local files, then:
npm run db:remote

npm run hash        # type the password, then Ctrl+D (Ctrl+Z and Enter on Windows)
npx wrangler secret put PANEL_PASSWORD_HASH -c wrangler.local.jsonc
npx wrangler secret put TOTP_KEY            -c wrangler.local.jsonc
npx wrangler secret put META_TOKEN_READ     -c wrangler.local.jsonc   # check it first, see above
npx wrangler secret put OPENAI_API_KEY      -c wrangler.local.jsonc
npx wrangler secret put MEDIA_SIGNING_KEY   -c wrangler.local.jsonc

npx wrangler secret put META_TOKEN_WRITE    -c wrangler.executor.local.jsonc
npx wrangler secret put MEDIA_SIGNING_KEY   -c wrangler.executor.local.jsonc   # the same value
npx wrangler secret put RESEND_API_KEY      -c wrangler.executor.local.jsonc

npm run deploy && npm run deploy:executor
```

The `wrangler*.jsonc` files in the repository are templates full of
placeholders on purpose: the repository is public, and a D1 id or an ad
account id identifies somebody. Deploys read the `*.local.jsonc` copies,
which are gitignored. Until the Meta variables are filled in, the panel
says what is missing and the executor writes nothing.

### Configuration

| Variable | What it is |
|---|---|
| `META_ACCOUNT_ID`, `META_PAGE_ID`, `META_IG_USER_ID`, `META_IG_USERNAME`, `META_PIXEL_ID` | The advertiser's Meta assets |
| `SITE_URL` | The shop, without a trailing slash. Ads can only link to pages of this site |
| `META_DSA_BENEFICIARY`, `META_DSA_PAYOR` | Who advertises and who pays. In the EU Meta rejects ad sets without them |
| `BRAND_NAME` | Goes into the audiences it creates, the page title and the assistant's instructions |
| `COUNTRY` | The only country it sells in, as an ISO code |
| `TIME_ZONE` | For dates and reporting ranges. Defaults to `Europe/Madrid` |
| `BUSINESS_FACTS`, `COPY_HINTS` | What the assistant always knows about the business, and what the copy should talk about |
| `MAX_ADSET_DAILY_EUR`, `MAX_ACCOUNT_DAILY_EUR` | The caps. The executor's values are the ones that rule |
| `AI_DAILY_EUR`, `AI_MONTHLY_EUR` | Ceiling on the OpenAI spend |
| `PANEL_USER`, `BASE_PATH`, `PANEL_TITLE` | Login name, the path when served under a domain (`/panel`), optional title |
| `MEDIA_URL_BASE`, `LEADS_FROM`, `LEADS_NOTIFY_TO` | Executor only: where Meta downloads videos from, and who gets the lead emails |

If the owner loses the phone with the authenticator app, reset two-step
verification and they will be asked to set it up again on the next login:

```bash
npx wrangler d1 execute adychat -c wrangler.local.jsonc --remote --command "delete from two_factor"
```

## Tests

```bash
npm test             # node --test, no framework; Meta and OpenAI are faked
npm run typecheck
npm run check-clean  # nothing in the repository may identify a real installation
```

The suite runs the whole circuit with a fake D1, a fake KV and a fake
`fetch` playing Meta and OpenAI: log in, upload a photo, ask for a
campaign in plain words, get a card, confirm, and watch the executor
create it paused with the pixel, the DSA fields and Advantage+ off. It
also checks that the account cap stops a turn-on, that the executor stops
a budget above its cap even when it is already in the database, and that
the AI ceiling stops the chat.

## Notes on the Graph API

Things that cost an afternoon each.

- Advantage+ audience has to be turned off in **two** fields
  (`targeting_automation.advantage_audience` and
  `targeting_relaxation_types`). With only one, Meta turns the expansion
  on by itself when it creates the ad set.
- In the EU, an ad set without `dsa_beneficiary` and `dsa_payor` is
  rejected with "No advertiser indicated".
- `instagram_user_id` is required in the creative to run on Instagram.
  Without it the creative is created and the ad fails later.
- A city key does not say its country. Searching "Gavà" without a filter
  returns a Gava in Kyrgyzstan first. `adgeolocationmeta` tells you.
- `creative_features_spec` accepts only a few keys on write. Any other
  one fails the whole creative with a 400.
- Send text as a form with `charset=UTF-8`. Sent another way, a "·"
  once reached Meta broken, and it cannot be repaired afterwards.
- Meta answers `success` to changes it ignores. Nothing is done until it
  has been read back.
- Lead form ad sets on Instagram are mobile only.
- Reels with copyrighted music cannot be used as ads.
- A creative made by an app in development mode is rejected: the app has
  to be published first.
- An Instagram account that chose less personalised ads (an EU option in
  the Accounts Center) cannot be used to create ads until it switches back.
- The fixed words in Meta's previews ("Ad", "Shop now") follow the
  viewer's Facebook language. Asking for another locale does not change
  them.

## Where this code comes from

Adychat is the generic core of a panel that runs for a real business.
The code here is regenerated from that private installation by
`tools/sync-from-panel.mjs`, which rewrites names and hardcoded values
into configuration and refuses to write anything if a single identifier
survives. See [SYNC.md](SYNC.md).

## Licence

MIT.
