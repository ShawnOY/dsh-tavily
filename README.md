# dsh-tavily-keyless

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
  than happening behind your back.
- **Explicit modes.** `keyless-first` (default), `key-first`, `keyless-only`, `key-only`.
- **No build step.** Plain ESM. A git install runs no install script, so it needs no
  `allowBuilds` permission.

## Install

### As a bundle (recommended)

```bash
# from a git remote
dsh plugin --profile web add github:<you>/<repo>

# from a local checkout
dsh plugin --profile web add /path/to/dsh-tavily-keyless
```

The package declares `dsh.bundle.patch`, so `dsh plugin add` registers it in the
profile's `dsh.profile.bundles` and its shipped patch mounts the provider and points the
web seam's search at it. Nothing else to configure.

Restart the harness afterwards: the base `hmr` row is disabled, so a newly added module
is not hot-reloaded.

### Manually, by relative path

If you would rather not install a package, copy this directory to
`<profile>/plugins/tavily-search/` and add to `<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: web-search-tavily
      name: ./plugins/tavily-search/index.js
      config:
        apiKeyEnv: TAVILY_API_KEY

- id: web
  config:
    searchProvider: tavily
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
| `mode` | `keyless-first` | Credential strategy — see below. |
| `keylessCooldownMinutes` | `10` | How long a refused keyless tier is skipped. `0` disables the cooldown. |

`mode` and `keylessCooldownMinutes` are also editable at runtime from **Settings → Plugins →
Plugin configuration**. This package ships a browser half that contributes the card for its
`web-search-tavily-keyless` namespace — registering a namespace on the Host is not enough on its
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
⚠️ Tavily keyless 額度已用盡，這次改用 API key；接下來約 10 分鐘內直接使用 API key。
```

and, while the cooldown is active:

```
⚠️ Tavily keyless 冷卻中（約剩 7 分鐘），這次使用 API key。
```

Both also emit a `warn` to the harness log. The notices are Traditional Chinese because
they are aimed at the operator; a happy path is silent.

## Why `searchProvider` must be pinned

The shipped patch sets `searchProvider: tavily`, and that is required rather than
cosmetic. Both registered providers report `available() === true`, because each can only
prove a credential *resolver* exists — not that a key is set. An unpinned seam therefore
fails every search with `WEB_PROVIDER_AMBIGUOUS`.

The patch also restates `fetchProvider: http`, because a patch replaces the targeted
row's **whole** `config` and dropping it would leave the web fetch provider unset.

Your own `cordis.patch.yml` is applied after every bundle layer, so you can still
override either row — but you must restate the whole config to do so.

## Caveats

- **Keyless has no account and no contract.** You accept no terms and hold the least
  leverage over what happens to your data. It is the right default for trying a tool and
  the wrong channel for anything sensitive — see
  [Tavily on keyless](https://www.tavily.com/blog/What-keyless-search-really-means-for-your-data).
  Set `mode: key-first` if you would rather always use your own account.
- **The card covers `mode` and the cooldown only.** The remaining keys are set in the profile
  patch or the settings document, and there is no "test this key" button.
- **Notices are Traditional Chinese.** Change the strings in `annotate()` for another
  language.

## Development

```bash
node test/provider.test.mjs                          # offline assertions
TAVILY_LIVE_TEST=1 node test/provider.test.mjs       # + a live keyless call
TAVILY_LIVE_TEST=1 TAVILY_API_KEY=tvly-... node test/provider.test.mjs
```

The offline assertions stub `fetch`; the live ones are opt-in. The plugin imports its
`@deepseek-ai/*` peers as bare specifiers, so run the tests where those resolve — for
example inside the profile that has the plugin installed.

`client.js` is the browser half. It is a prebuilt bundle in the shape the client module system
serves — a `window.__ModuleLoader__.load` factory receiving the host's `require` — so it is served
as written and needs no build step. Its `dsh.client.platform` is `web`, and it is registered in the
browser module graph as `dsh-tavily-keyless/client.js`.

## License

MIT — see [LICENSE](./LICENSE).
