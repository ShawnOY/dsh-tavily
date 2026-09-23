# @0x427567/dsh-tavily

A [Tavily](https://tavily.com)-backed search provider for the DeepSeek Harness web
capability seam (`ctx.web`), shipped as a DSH **bundle** so `dsh plugin add` wires it
up without hand-editing a profile.

Tavily answers `/search` with the result list itself — title, URL, content and an
optional published date — so one search is one HTTP request: no auxiliary model turn,
and no scraping results out of provider prose.

## What makes this one different

Several Tavily providers for DSH exist. This one is built around a single idea:
**which credential tier served your search should never be a silent decision.**

- **Keyless first.** Tavily serves `/search` with no account at all, so this provider
  works with no key stored. Your key is reached for only once the keyless tier refuses.
- **A refusal is visible.** When the keyless tier refuses, that tier is cooled down and
  the switch to your key is reported *in the search result itself* — and logged — rather
  than happening behind your back. Both follow your harness language.
- **Explicit modes.** `keyless-first` (default), `key-first`, `keyless-only`, `key-only`.
- **No build step.** Plain ESM, published as written. Installing it runs no install
  script, so it needs no `allowBuilds` permission.

## Install

Requires Node `^22.19 || >=24`, and a harness that provides `@deepseek-ai/dsh-web` and
`@deepseek-ai/dsh-credentials` at `^0.1.5-rc.2` — both are declared as peer dependencies,
so an older harness fails the install rather than loading a plugin it cannot run.

### From npm (recommended)

```bash
dsh plugin --profile web add @0x427567/dsh-tavily
```

Prebuilt, so nothing is compiled on your machine. The package is scoped because
`dsh-tavily` and `dsh-web-tavily` are already taken on npm by other Tavily providers.

### From GitHub

```bash
dsh plugin --profile web add github:ShawnOY/dsh-tavily
```

Either form installs the same package. It declares `dsh.bundle.patch`, so `dsh plugin add`
registers it in the profile's `dsh.profile.bundles` and its shipped patch mounts the
provider, leaves the web seam's search unpinned, and switches off the DeepSeek search
provider the base bundle ships. `web_search` is therefore Tavily-backed, and
**Settings → Plugins → Plugin configuration** shows this plugin's card alone — until you
pick `deepseek-official` there, which brings the shipped provider and its card back. Nothing
else to configure.

Restart the harness afterwards: the base `hmr` row is disabled, so a newly added module
is not hot-reloaded.

### From a local checkout

Pack it, then install the tarball:

```bash
npm pack
dsh plugin --profile web add ./0x427567-dsh-tavily-<version>.tgz
```

Do **not** point `dsh plugin add` at the checkout directory. pnpm installs a directory
dependency as a symlink, and Node resolves a symlinked module to its real path — so a checkout
outside the harness home resolves this package's `@deepseek-ai/*` imports against the checkout's
own `node_modules`, not the harness's, and boot fails with
`Cannot find package '@deepseek-ai/schemastery'`. A tarball extracts the package inside the
profile, where the peers resolve correctly. `npm install` in a checkout is only for running the
test suite; it pulls its *own* copies of the host packages, which is fine for the stubbed tests
and wrong for loading into a harness.

### Manually, by relative path

If you would rather not install a package, copy this directory to
`<profile>/plugins/tavily-search/` and add to `<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: web-search-tavily
      name: ./plugins/tavily-search/index.js
      config:
        apiKeyEnv: TAVILY_API_KEY

# The shipped DeepSeek provider starts off, so the default selection is this
# one. The card switches between them — do NOT pin `searchProvider` on the web
# row below, or the switch cannot take effect.
- id: web-search-deepseek
  disabled: true

- id: web
  config:
    fetchProvider: http
```

## Credentials

Keyless needs none. To use the keyed tier, provide a key in any of these ways — first
match wins:

1. A literal `apiKey` in this plugin's config (avoid; it lands in a config file).
2. `TAVILY_API_KEY` (or your `apiKeyEnv`) in the harness's credential store,
   `~/.dsh/.credentials.yaml`:

   ```yaml
   version: 1
   refs:
     TAVILY_API_KEY: tvly-...
   ```

3. The same variable in the environment that launched the harness.

Keyless is free but rate-limited, and Tavily does not publish the keyless limit. Keys
have documented limits (100 RPM development, 1,000 RPM production). When the keyless tier
refuses, this provider falls back to your key and tells you.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `apiKey` | — | Literal key. Prefer the credential store. |
| `apiKeyEnv` | `TAVILY_API_KEY` | Credential ref resolved per search. |
| `baseURL` | `https://api.tavily.com` | API base; `/search` is appended. |
| `searchDepth` | `basic` | Tavily `search_depth`. `advanced` costs more. |
| `maxResults` | `5` | Result bound when the caller sets none. |
| `includeAnswer` | `false` | Ask Tavily for an LLM-written answer as well. |
| `provider` | `tavily` | Which backend answers `web_search`: `tavily` or `deepseek-official` — see [Switching providers](#switching-providers). |
| `mode` | `keyless-first` | Credential strategy — see below. |
| `keylessCooldownMinutes` | `10` | How long a refused keyless tier is skipped. `0` disables the cooldown. |
| `language` | `auto` | Copy language for this plugin alone. `auto` follows the harness preference — see [Language](#language). |

`provider`, `mode`, `keylessCooldownMinutes` and `language` are also editable at runtime from
**Settings → Plugins → Plugin configuration**. This package ships a browser half that contributes the card for its
`dsh-tavily` namespace — registering a namespace on the Host is not enough on its
own, because that page renders only the namespaces a card claims. A change there takes effect on
the next search, and the profile patch remains the base value a reset returns to. The other keys
are file-only.

## Modes

| `mode` | Behaviour |
| --- | --- |
| `keyless-first` *(default)* | Try keyless; on refusal, cool that tier down and retry with the key. |
| `key-first` | Use the key whenever one resolves; keyless only when none does. |
| `keyless-only` | Never send the key. |
| `key-only` | Require a key; never use the keyless tier. |

A refusal means HTTP `401`, `403` or `429`, **or** a `200` whose body carries prose
instead of a `results` array — Tavily answers a capped keyless call with instructions
rather than a machine-readable error. A `400` (a bad query) is *not* a refusal: retrying
with a key would not help, so the error surfaces.

## What you see when it falls back

The switch is announced in the search result, which the harness renders as the tool
output:

```
⚠️ Tavily keyless 额度已用尽，这次改用 API key；接下来约 10 分钟内直接使用 API key。
```

and, while the cooldown is active:

```
⚠️ Tavily keyless 冷却中（约剩 7 分钟），这次使用 API key。
```

Both also emit a `warn` to the harness log. A happy path is silent. The wording above is
the default (Simplified Chinese); see [Language](#language) for the other two.

### Language

The notice, the log warning, and this provider's own error messages follow the harness
language preference — **Settings → General → Language** — so they match the language the
settings card and the rest of the UI are already in. A language change applies to the
next search.

**The card's own `language` field overrides that for this plugin alone.** Leave it on
`auto` to follow the harness; pick a language to keep the rest of the UI where it is and
have only this card and this plugin's notices speak it. Both halves read the same field,
so the card and the transcript cannot disagree about which language they are in.

Three languages are served:

| Preference | Language | Where it comes from |
| --- | --- | --- |
| `zh` *(default)* | Simplified Chinese | The harness's own `zh`, so it matches the shell |
| `en` | English | The harness's own `en` |
| `zh-Hant` | Traditional Chinese | A language pack this package adds |

`zh` and `en` are built into the harness; `zh-Hant` arrives with this plugin's browser
half, which calls `ctx.locale.addLanguage` for it. It falls back to `zh`, so a key missing
from the pack resolves instead of rendering as a raw identifier.

The pack is registered under the **script** tag and deliberately not a region tag such as
`zh-TW`. That keeps the default where it belongs: a browser reporting `zh-TW` or `zh-HK`
matches the `zh` primary subtag and opens in Simplified, and a Traditional reader opts in
by picking 繁體中文 once. Registering `zh-TW` instead would exact-match those browsers and
pull them off the default.

Both halves resolve a given preference the same way — an exact id wins, then the primary
subtag — so an unshipped `zh-TW` or `zh-HK` lands on Simplified `zh` in the card *and* in
the notices rather than the two disagreeing.

The one case where they can part ways is a browser that has never picked a language and
reports `zh-Hant` itself. The client matches that exactly and opens in Traditional; the
Host sees no stored preference at all, so its notices use the default, Simplified.
Choosing a language in **Settings → General → Language** persists it and closes the gap.
Nothing else can: the browser's language list never leaves the client, and the client
deliberately does not write a browser-derived guess into the durable settings document.

## Switching providers

**Settings → Plugins → Plugin configuration → Tavily web search** carries a **Search
provider** select:

| Value | Backend | Cards on the page |
| --- | --- | --- |
| `tavily` *(default)* | This plugin, keyless-first | This one |
| `deepseek-official` | The DeepSeek search provider `dsh-base` ships | This one, and that one |

The choice applies to the next `web_search` — no restart — and it is stored in the settings
document, so it survives one. The profile patch remains the value a reset returns to.

The seam holds no pinned provider, so it resolves whichever provider is usable at call time.
That is what makes the switch work, and it is also why a third search provider installed
alongside these two would fail every search with `WEB_PROVIDER_AMBIGUOUS`: pin
`searchProvider` on the `web` row yourself in that case.

The switch is not atomic underneath. The setting commits before the shipped row is toggled,
so a search issued in that instant can fail with `WEB_PROVIDER_UNAVAILABLE` or
`WEB_PROVIDER_AMBIGUOUS`. It never silently answers from the backend you did not pick.

## How the switch is wired

`web_search` is not a search engine of its own: it is a model-facing tool that calls
`ctx.web.search()`, and the seam resolves one registered provider. Three rows decide which:

- the `web` row carries **no** `searchProvider`, so the seam picks whichever provider is
  usable at call time;
- this plugin's provider is always registered, but `available()` is false unless it is the
  selected backend **and** the shipped row is currently disabled;
- the `web-search-deepseek` row is enabled exactly while the shipped provider is selected,
  and the card toggles it at runtime through the loader.

"Two usable" is therefore impossible: this provider being usable requires the shipped row to
be off, and the shipped provider being usable requires it to be on. When a toggle fails —
because a future harness renamed the row, say — the failure is a `warn` in the harness log,
and a built-in selection then fails loudly with `WEB_PROVIDER_UNAVAILABLE` rather than
silently answering from the wrong backend.

The patch also restates `fetchProvider: http`, because a patch replaces the targeted row's
**whole** `config` and dropping it would leave the web fetch provider unset.

Your own `cordis.patch.yml` is applied after every bundle layer, so you can still override
any of these rows — but you must restate the whole config to do so, and the runtime setting
wins over a row's composed `disabled` on the next change.

## Caveats

- **The shipped DeepSeek search provider starts switched off.** The default selection is
  Tavily, so **Settings → Plugins** shows this plugin's card alone. Pick
  `deepseek-official` in the card and that provider's own card comes back next to this one.
- **Keyless has no account and no contract.** You accept no terms and hold the least
  leverage over what happens to your data. It is the right default for trying a tool and
  the wrong channel for anything sensitive — see
  [Tavily on keyless](https://www.tavily.com/blog/What-keyless-search-really-means-for-your-data).
  Set `mode: key-first` if you would rather always use your own account.
- **The card covers `mode` and the cooldown only.** The remaining keys are set in the profile
  patch or the settings document, and there is no "test this key" button.
- **Traditional Chinese is a language pack, not a build of `zh`.** The harness reads bare
  `zh` as Simplified, so 繁體 lives at `zh-Hant`. It shows up in the language list as an
  extra entry rather than as a variant of 中文, and a Traditional reader has to pick it
  once. No `zh-TW`/`zh-HK` entry is offered, so those browsers stay on the Simplified
  default unless someone chooses otherwise.

## Development

```bash
npm test                                             # both offline suites
node test/provider.test.mjs                          # the Host half only
node test/client.test.mjs                            # the browser half only
TAVILY_LIVE_TEST=1 node test/provider.test.mjs       # + a live keyless call
TAVILY_LIVE_TEST=1 TAVILY_API_KEY=tvly-... node test/provider.test.mjs
```

The offline assertions stub `fetch`; the live ones are opt-in. The plugin imports its
`@deepseek-ai/*` peers as bare specifiers, so run the tests where those resolve — for
example inside the profile that has the plugin installed.

`test/client.test.mjs` stands up the `__ModuleLoader__` contract with a stub `require` and
a stub context, so the browser half's wiring — the dictionaries it registers and the
language pack it adds — is checked without a browser. It does not render the card.

`client.js` is the browser half. It is a prebuilt bundle in the shape the client module system
serves — a `window.__ModuleLoader__.load` factory receiving the host's `require` — so it is served
as written and needs no build step. Its `dsh.client.platform` is `web`, and it is registered in the
browser module graph as `@0x427567/dsh-tavily/client.js`.

## License

MIT — see [LICENSE](./LICENSE).
