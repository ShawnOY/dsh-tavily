# Search provider switch — design

Status: approved — design C, superseding the loader-based design A
Date: 2026-09-23
Package: `@0x427567/dsh-tavily`

## Revision note

The first approved design (A) switched backends by toggling the shipped `web-search-deepseek`
loader row and making this provider's `available()` follow that row's state, with the seam
left unpinned. It was built, tested and installed, and it worked.

Reading the sibling plugins then showed a simpler mechanism that never touches the loader:
pin the seam, and run the DeepSeek backend *inside* this provider. `dsh-tavily` 0.3.1 and
`dsh-tavily-provider` 0.5.1 both do exactly that, and both import `DeepSeekSearchProvider`
from `@deepseek-ai/dsh-web-search-deepseek` to do it.

This revision adopts that mechanism (design C) while keeping the one property A was chosen
for — a single search card. The loader helpers, the availability rule, the serialized toggle
chain and the transition window all disappear with it.

A later fix dropped the credential half of `available()` (see "index.js — `available()`"
below): with a well-formed `apiKeyEnv` that test was vacuously true, and keeping it made a
malformed `apiKeyEnv` report the whole provider unusable instead of a coded search error.
`Config` now rejects a ref outside the credentials grammar at load time.

## Problem

`web_search` is a model-facing tool (`@deepseek-ai/dsh-tool-web`) that calls
`ctx.web.search()`. The seam (`@deepseek-ai/dsh-web`) owns provider selection and resolves it
from one config field, `searchProvider`.

The bundle already disables the shipped DeepSeek search provider (`web-search-deepseek`,
inserted by `dsh-base`), so a deployment ends up with one search provider and one Plugins
card. That decision is baked into a patch layer and read at boot: changing your mind means
editing a patch file and restarting the harness. There is no way to pick the backend from the
UI.

## Goal

One select in this plugin's settings card chooses which backend serves `web_search`. The
choice takes effect on the next search, needs no restart, and persists across restarts.

## Non-goals

- **Automatic fallback.** Tavily failing does not silently switch to DeepSeek. Manual choice
  is the requirement; the keyless→key fallback *inside* Tavily is unrelated and untouched.
- **Making the seam's `searchProvider` runtime-settable.** `dsh-web` reads it in its
  constructor and is not settings-backed. Reloading that row would tear down the seam and
  every plugin that injects it. Rejected — and with design C it is no longer needed, because
  the pin never has to change.
- **A card for the DeepSeek endpoint and model.** With the shipped row switched off, its
  settings namespace is not served, so those values stay on the shipped defaults, overridable
  through `DEEPSEEK_SEARCH_BASE_URL`. Exposing them in this card is a follow-up, not this
  change.
- **Keeping the shipped "Web search" card on the page.** Design C keeps it off; that is the
  point of choosing C over the sibling plugins' arrangement, which leaves it on.

## Verified constraints

Read out of the installed harness (`@deepseek-ai/dsh` 0.1.5-rc.2) and out of the sibling
packages' published tarballs, not assumed:

| Fact | Where |
|---|---|
| Provider selection runs per call, not at boot | `dsh-web/lib/index.js` — `resolveProvider()` is called inside `async search()` |
| `searchProvider` is read once, in the constructor | `dsh-web/lib/index.js` — `this.searchProviderId = config.searchProvider ?? process.env.DSH_WEB_SEARCH_PROVIDER` |
| `dsh-web` installs no settings section | no `installSection` anywhere in `dsh-web/lib/index.js` |
| `searchProviders` is private | `dsh-web/lib/types/index.d.ts` — `private searchProviders;`, so one provider cannot reach a sibling |
| A patch's `name:` is an assertion, not an override | `cordis-plugin-include/lib/index.js` — `applyEntryPatches` destructures `name` out of the overrides and skips the patch on a mismatch, so a row cannot be retargeted at another module |
| The shipped card renders only while its namespace is served | `dsh-client-ui-settings-plugins/lib/client.js` — the tab renders `namespaces.map(...)`; the card is registered unconditionally but dispatched per served namespace |
| The shipped DeepSeek provider is constructible from outside | `dsh-web-search-deepseek/lib/index.js` exports `DeepSeekSearchProvider`, whose constructor takes a `resolveOptions` thunk, plus `DEEPSEEK_DEFAULT_API_VERSION`, `DEEPSEEK_DEFAULT_BASE_URL`, `DEEPSEEK_DEFAULT_MAX_TOKENS`, `DEEPSEEK_DEFAULT_MAX_USES`, `DEEPSEEK_DEFAULT_MODEL` |
| Its `search()` posts to `${baseURL}/messages` | `dsh-web-search-deepseek/lib/index.js` |
| Sibling plugins pin the seam and route internally | `dsh-tavily` 0.3.1 and `dsh-tavily-provider` 0.5.1 `cordis.patch.yml`; both import `DeepSeekSearchProvider` |
| A loader entry can be enabled and disabled at runtime | `cordis-plugin-loader/lib/index.js` — recorded because design A relied on it and design C deliberately does not |

## Design

### Shape

Three rows, none of them toggled at runtime:

- the `web` row is pinned to `tavily`, so the seam always resolves this package;
- this package's provider is registered and reports `available() === true` under the same
  conditions it always did — a resolvable credential and a parseable base URL;
- the `web-search-deepseek` row stays disabled, which is what keeps the page to one search
  card.

The switch is then purely a routing decision inside `search()`: the selected backend answers,
and the seam's pin never moves. The provider id `tavily` is a registry key, not a claim about
which backend answers — exactly as it is in the sibling plugins.

### Configuration

A new field on the existing `dsh-tavily` settings namespace:

| Field | Values | Default |
|---|---|---|
| `provider` | `tavily`, `deepseek-official` | `tavily` |

The values are the seam's own provider ids, so `settings.yaml` stays self-describing.
`tavily` keeps today's behaviour, so an existing deployment sees no change until someone picks
the other option.

### Components

**`index.js` — `Config`** carries `provider`, in the style of the existing fields.

**`index.js` — `deepSeekBackend(ctx)`** (new): build the shipped `DeepSeekSearchProvider` once
per plugin instance, with a `resolveOptions` thunk that reads the harness credential service
for `DEEPSEEK_API_KEY` and falls back to the environment, and takes the endpoint, model, API
version and token/use bounds from the shipped defaults, with
`process.env.DEEPSEEK_SEARCH_BASE_URL` overriding the endpoint.

**`index.js` — `search()`** routes at its entry: when the snapshot's `provider` is
`deepseek-official`, it delegates to that backend and returns its result untouched; otherwise
it runs the existing Tavily path. The seam still applies `maxResults` to whatever comes back.

**`index.js` — `available()`** is unchanged from before design A: a resolvable credential and
a parseable base URL. *Superseded: the credential half was dropped later — see the revision
note — so it is now only the parseable base URL.* It must not depend on `provider`, because
the seam is pinned to this provider and would otherwise fail with
`WEB_PROVIDER_CONFIGURED_UNAVAILABLE` whenever the other backend is selected.

**`client.js` — the card** keeps the `provider` select added for design A, unchanged.

### Error handling

| Condition | Behaviour |
|---|---|
| `deepseek-official` selected with no `DEEPSEEK_API_KEY` | The shipped provider's own `WEB_PROVIDER_CREDENTIAL_MISSING`, naming the ref |
| The DeepSeek endpoint rejects or is unreachable | The shipped provider's own error, naming the endpoint — not a Tavily error |
| `deepseek-official` selected but the import failed | A load-time failure, because the peer dependency is declared; the plugin does not half-mount |
| Tavily fails while `tavily` is selected | Unchanged: the keyless→key fallback and its notice |

There is no loader path left, so there is no row-not-found degradation and no
zero-usable-provider window.

## Testing

`test/provider.test.mjs`, with the stubbed `fetch` the suite already uses, extended to record
the request URL:

- the default selection posts to the Tavily `/search` endpoint;
- `provider: 'deepseek-official'` posts to the DeepSeek `/messages` endpoint instead;
- a DeepSeek failure surfaces as a DeepSeek error, not a Tavily one;
- the config schema accepts both ids and rejects anything else;
- the shipped patch pins `searchProvider: tavily`, restates `fetchProvider: http`, and keeps
  `web-search-deepseek` disabled.

`test/client.test.mjs` is unchanged: the select, its two option values and its three
dictionaries were already asserted for design A.

Acceptance: `npm test` green; in a live harness both backends answer `web_search`, and
**Settings → Plugins → Plugin configuration** shows one search card in both selections.

## Risks and accepted edges

- **Peer coupling.** This package now depends on `@deepseek-ai/dsh-web-search-deepseek`'s
  exported class and its options shape. A future harness that changes either breaks this
  plugin at load. The sibling plugins accept the same coupling, and the declared peer range
  turns a mismatch into an install failure rather than a runtime surprise.
- **No DeepSeek configuration card.** Endpoint, model and key ref stay on the shipped
  defaults plus `DEEPSEEK_SEARCH_BASE_URL` and the credential store.
- **A third search provider.** With the pin back, an extra provider cannot make the seam
  ambiguous. That is a gain over design A.
- **Tavily-only fields.** `mode`, `keylessCooldownMinutes` and the fallback notices do not
  apply while the built-in backend is selected. The card keeps showing them.

## Rollout

Version `0.2.0`, unreleased, unchanged from design A — the feature ships once. The README
gains a "Switching providers" section and a "How the switch is wired" section describing
routing rather than row toggling.
