# Search Provider Routing Implementation Plan (design C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace design A's loader-based backend switch with design C — the seam pinned to this package, and the backend chosen by routing inside `search()` — so the switch needs no loader access, no availability rule and no transition window, while still showing one search card.

**Architecture:** The seam's `searchProvider` is pinned to `tavily` again and never moves. The shipped `web-search-deepseek` row stays disabled, which is what keeps the page to one search card. This package's provider is registered and available as it was before design A; when the settings select `deepseek-official`, its `search()` delegates to a `DeepSeekSearchProvider` this package constructs from the shipped package's exports. Spec: `docs/superpowers/specs/2026-09-23-search-provider-switch-design.md` (design C).

**Tech Stack:** Plain ESM, Node `^22.19 || >=24`, no build step. Host half is `index.js` (Cordis plugin over `ctx.web` and `ctx.settings`), browser half is the prebuilt bundle `client.js`, tests are dependency-free scripts under `test/`.

## Global Constraints

- One new peer dependency, `@deepseek-ai/dsh-web-search-deepseek`, at the same range as the others: `^0.1.5-rc.2`. No other dependency changes.
- `package.json` keeps `engines.node` at `^22.19 || >=24`, and the other peer ranges at `^0.1.5-rc.2`.
- The registered provider id stays `tavily` (`TAVILY_PROVIDER_ID`) and the settings namespace stays `dsh-tavily`.
- The setting is `provider`, accepting exactly `tavily` and `deepseek-official`, defaulting to `tavily`.
- `client.js` is **not touched by this plan**. Its select, its two option values and its three dictionaries were already built and asserted.
- The three dictionaries must keep identical key sets; `test/client.test.mjs` section 3 enforces this.
- Tests run offline. Live Tavily calls stay behind `TAVILY_LIVE_TEST=1`.
- Commits are Conventional Commits: English imperative subject, prose body explaining why.
- Version stays `0.2.0` — the feature ships once.

---

### Task R1: Route to the shipped DeepSeek backend

**Files:**
- Modify: `index.js` (imports, constants, `resolveOptions`, new helpers, the provider class, `apply`)
- Modify: `package.json` (peer dependency)
- Modify: `test/provider.test.mjs` (fetch stub, the `provider()` helper, section 13)

**Interfaces:**
- Consumes: `options.provider` and `BUILTIN_PROVIDER_ID` from the earlier work.
- Produces:
  - `credentialResolver(ctx, ref): () => Promise<string | undefined>`
  - `deepSeekBackend(ctx): DeepSeekSearchProvider`
  - `TavilySearchProvider` constructor takes `(resolveOptions, shippedBackend)`
  - `available()` is a plain credential/baseURL check again
  - `search()` delegates to `shippedBackend` when `provider === 'deepseek-official'`
- Removes: `loaderOf`, `findBuiltinRow`, `builtinRowEnabled`, `syncBuiltinRow`, `BUILTIN_ROW_ID`, the `toggles` chain in `apply`, and the `loader` option in the test stub.

- [ ] **Step 1: Record the request URL in the test fetch stub**

In `test/provider.test.mjs`, replace the stub's push line:

```js
	seen.push({ headers: init.headers, body: JSON.parse(init.body) });
```

with:

```js
	seen.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
```

- [ ] **Step 2: Drop the loader scaffolding from the test**

In `test/provider.test.mjs`:

1. Delete the `settle` helper and the whole `stubLoader` function.
2. Revert the `provider()` signature to `function provider({ key, config = {}, locale } = {}) {`.
3. Delete the line `if (name === 'loader' && loader !== null) return loader;` from its `get`.

- [ ] **Step 3: Write the failing test**

Replace the whole of section 13 (from `console.log('13. provider selection');` through the `the last setting wins when two toggles overlap` check) with:

```js
console.log('13. provider routing');
reset();
queue = [() => new Response(okBody(), { status: 200 })];
await provider({ key: 'tvly-k' }).search({ query: 'q' });
check('the default selection posts to the Tavily endpoint', seen[0].url === 'https://api.tavily.com/search', `(got ${seen[0].url})`);

reset();
const deepSeekBody = JSON.stringify({
	content: [{ type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://ds.example/a', title: 'DSA' }] }]
});
queue = [() => new Response(deepSeekBody, { status: 200 })];
// Caught rather than awaited bare: before routing exists the Tavily path gets
// this body and throws, which would abort the rest of the file instead of
// failing these checks.
let routed;
try {
	routed = await provider({ key: 'ds-k', config: { provider: 'deepseek-official' } }).search({ query: 'q' });
} catch (error) {
	routed = { sources: [], error };
}
check('selecting the shipped provider posts to the Messages endpoint', seen[0].url === 'https://api.deepseek.com/anthropic/v1/messages', `(got ${seen[0].url})`);
check('and its sources come back mapped', routed.sources.length === 1 && routed.sources[0].url === 'https://ds.example/a', `(got ${JSON.stringify(routed.sources)})`);
check('and no second request is made', seen.length === 1, `(got ${seen.length})`);

reset();
queue = [() => new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 500 })];
let routedError;
try {
	await provider({ key: 'ds-k', config: { provider: 'deepseek-official' } }).search({ query: 'q' });
} catch (error) {
	routedError = error;
}
check('a shipped-backend failure surfaces as its own error', String(routedError?.message ?? '').includes('DeepSeek API error'), `(got ${String(routedError?.message)})`);
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `node test/provider.test.mjs`
Expected: FAIL on `selecting the shipped provider posts to the Messages endpoint`, `and its sources come back mapped` and `a shipped-backend failure surfaces as its own error` — with no routing, all three go through the Tavily path. `the default selection posts to the Tavily endpoint` and `and no second request is made` pass. Total: 65 passed, 3 failed.

- [ ] **Step 5: Declare the peer dependency**

In `package.json`, add to `peerDependencies`, keeping the object alphabetical:

```json
    "@deepseek-ai/dsh-web-search-deepseek": "^0.1.5-rc.2",
```

- [ ] **Step 6: Import the shipped provider**

In `index.js`, directly after the existing `import { WebError } from '@deepseek-ai/dsh-web';` line, add:

```js
import {
	DeepSeekSearchProvider,
	DEEPSEEK_DEFAULT_API_VERSION,
	DEEPSEEK_DEFAULT_BASE_URL,
	DEEPSEEK_DEFAULT_MAX_TOKENS,
	DEEPSEEK_DEFAULT_MAX_USES,
	DEEPSEEK_DEFAULT_MODEL
} from '@deepseek-ai/dsh-web-search-deepseek';
```

- [ ] **Step 7: Swap the row constant for the shipped backend's refs**

In `index.js`, delete the `BUILTIN_ROW_ID` declaration and its doc comment, and in its place add:

```js
/** Credential ref the shipped DeepSeek search provider reads by default. */
const BUILTIN_API_KEY_ENV = 'DEEPSEEK_API_KEY';
/** Environment override for the shipped provider's endpoint. */
const BUILTIN_BASE_URL_ENV = 'DEEPSEEK_SEARCH_BASE_URL';
```

- [ ] **Step 8: Extract the credential resolver**

In `index.js`, directly above `/** Project one resolved config section into the options one search uses. */`, add:

```js
/**
 * Resolve one credential ref the way the harness does: the credentials service
 * first, then the environment that launched the harness.
 *
 * @param ctx - plugin context whose optional credentials service owns the store.
 * @param ref - the normalized credential reference to resolve.
 * @returns a thunk resolving the stored value, or `undefined` when nothing is.
 */
function credentialResolver(ctx, ref) {
	return async () => {
		const credentials = ctx.get('credentials');
		if (credentials !== undefined) return (await credentials.resolve(ref))?.value;
		const ambient = process.env[ref];
		return ambient !== undefined && ambient.length > 0 ? ambient : undefined;
	};
}
```

Then in `resolveOptions`, replace the inline `resolveApiKey` closure with:

```js
		resolveApiKey: credentialResolver(ctx, apiKeyEnv),
```

- [ ] **Step 9: Build the shipped backend**

In `index.js`, directly above `/** The Tavily-backed search provider. */`, add:

```js
/**
 * The shipped DeepSeek search provider, driven from this package's credentials
 * and the shipped defaults.
 *
 * Built once per plugin instance and reused: the seam is pinned to this package,
 * so swapping the backend is a routing decision inside `search()`, not a
 * re-registration. Its endpoint and model stay on the shipped defaults — the
 * card that used to edit them belongs to a row this bundle switches off — with
 * `DEEPSEEK_SEARCH_BASE_URL` as the one override.
 *
 * @param ctx - plugin context whose credentials service resolves the key.
 * @returns the provider to delegate to when the shipped backend is selected.
 */
function deepSeekBackend(ctx) {
	const ref = credentialRef(BUILTIN_API_KEY_ENV);
	return new DeepSeekSearchProvider(() => ({
		resolveApiKey: credentialResolver(ctx, ref),
		apiKeyEnv: ref,
		baseURL: process.env[BUILTIN_BASE_URL_ENV] ?? DEEPSEEK_DEFAULT_BASE_URL,
		model: DEEPSEEK_DEFAULT_MODEL,
		apiVersion: DEEPSEEK_DEFAULT_API_VERSION,
		maxTokens: DEEPSEEK_DEFAULT_MAX_TOKENS,
		maxUses: DEEPSEEK_DEFAULT_MAX_USES
	}));
}
```

- [ ] **Step 10: Delete the loader helpers**

In `index.js`, delete `loaderOf`, `findBuiltinRow`, `builtinRowEnabled` and `syncBuiltinRow` — the four functions between `describeRefusal` and the provider class, including their doc comments.

- [ ] **Step 11: Revert `available()` and carry the backend**

In `index.js`, in the class body, add the field and constructor parameter:

```js
	/** The shipped backend to delegate to when the settings select it. */
	shippedBackend;
```

```js
	 * @param shippedBackend_ - the shipped DeepSeek provider, used when the
	 * settings select it instead of Tavily.
	 */
	constructor(resolveOptions_, shippedBackend_) {
		this.resolveOptions = resolveOptions_;
		this.shippedBackend = shippedBackend_;
	}
```

and replace the body of `available()` with:

```js
	available() {
		const options = this.resolveOptions();
		return (options.apiKey !== undefined || options.resolveApiKey !== undefined) && URL.canParse(options.baseURL);
	}
```

- [ ] **Step 12: Route at the entry of `search()`**

In `index.js`, at the top of `async search(request, signal)`, directly after `const options = this.resolveOptions();`, insert:

```js
		// The seam is pinned to this package, so which backend answers is a
		// routing decision here rather than a different registration.
		if (options.provider === BUILTIN_PROVIDER_ID) return this.shippedBackend.search(request, signal);
```

- [ ] **Step 13: Simplify `apply()`**

Replace the body of `apply` in `index.js` with:

```js
function apply(ctx, config) {
	let current = () => config;
	ctx.inject(['settings'], (settingsCtx) => {
		settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, Config, config, {
			setSource: (source) => {
				current = source;
			},
			onChange: () => {}
		});
	});
	ctx.web.registerSearchProvider(new TavilySearchProvider(() => resolveOptions(ctx, current()), deepSeekBackend(ctx)));
}
```

- [ ] **Step 14: Run the test to verify it passes**

Run: `node test/provider.test.mjs`
Expected: PASS on all five section-13 checks, and every other section still passes. Total: 68 passed, 0 failed.

- [ ] **Step 15: Run both suites**

Run: `npm test`
Expected: `68 passed, 0 failed` then `38 passed, 0 failed`.

- [ ] **Step 16: Commit**

```bash
git add index.js package.json test/provider.test.mjs
git commit -m "refactor!: route the search backend inside the provider"
```

---

### Task R2: Pin the seam again

**Files:**
- Modify: `cordis.patch.yml`
- Modify: `test/provider.test.mjs` (section 14)

**Interfaces:**
- Consumes: the routing from Task R1, which works unpinned because the shipped row is disabled.
- Produces: a composed `web` row pinned to `tavily`, so a third search provider can no longer make the seam ambiguous.

- [ ] **Step 1: Write the failing test**

In `test/provider.test.mjs`, in section 14, replace the `no provider is pinned` check with:

```js
check('the seam is pinned to this provider', patchRows.includes('searchProvider: tavily'), `(rows=${JSON.stringify(patchRows)})`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/provider.test.mjs`
Expected: FAIL on `the seam is pinned to this provider` — the patch carries no pin. Total: 67 passed, 1 failed.

- [ ] **Step 3: Pin the seam**

In `cordis.patch.yml`, replace the last block:

```yaml
- id: web
  config:
    fetchProvider: http
```

with:

```yaml
- id: web
  config:
    searchProvider: tavily
    fetchProvider: http
```

- [ ] **Step 4: Rewrite the patch comments**

In `cordis.patch.yml`, replace the paragraph that begins `# A patch replaces the targeted row's WHOLE \`config\`` and ends `# only while it is on, so the seam always sees exactly one usable provider.` with:

```yaml
# A patch replaces the targeted row's WHOLE `config`, so the base `web` row is
# restated in full: `fetchProvider` keeps the http provider the base already
# selected. `searchProvider: tavily` pins the seam to this package, which is what
# lets the card's `provider` setting switch backends: the pin never moves, and
# this provider decides which backend answers each search. Pinning also keeps a
# third search provider from making the seam ambiguous.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node test/provider.test.mjs`
Expected: PASS on all three section-14 checks. Total: 68 passed, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add cordis.patch.yml test/provider.test.mjs
git commit -m "feat: pin the seam to this provider again"
```

---

### Task R3: Document routing, not row toggling

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: prose that matches design C.

- [ ] **Step 1: Rewrite the Switching providers section**

In `README.md`, replace the whole section from `## Switching providers` through the paragraph ending `It never silently answers from the backend you did not pick.` with:

```markdown
## Switching providers

**Settings → Plugins → Plugin configuration → Tavily web search** carries a **Search
provider** select:

| Value | Backend | Cards on the page |
| --- | --- | --- |
| `tavily` *(default)* | This plugin, keyless-first | This one |
| `deepseek-official` | The DeepSeek search provider `dsh-base` ships, run inside this plugin | This one |

The choice applies to the next `web_search` — no restart — and it is stored in the settings
document, so it survives one. The profile patch remains the value a reset returns to.

Both selections answer through this plugin, so the page keeps one search card either way. The
seam is pinned to this provider and never re-resolves, which also means a third search
provider installed alongside cannot make it ambiguous.

The one thing the built-in selection does not carry over is its settings card. The shipped
provider's endpoint and model stay on their defaults, with `DEEPSEEK_SEARCH_BASE_URL` as the
override, and its key is read from `DEEPSEEK_API_KEY` in the credential store or the
environment.
```

- [ ] **Step 2: Rewrite the wiring section**

In `README.md`, replace the whole section from `## How the switch is wired` through the paragraph ending `wins over a row's composed \`disabled\` on the next change.` with:

```markdown
## How the switch is wired

`web_search` is not a search engine of its own: it is a model-facing tool that calls
`ctx.web.search()`, and the seam resolves one registered provider. Three rows decide which:

- the `web` row pins `searchProvider: tavily`, so the seam always resolves this package;
- this package's provider is registered and available as it always was — a resolvable
  credential and a parseable base URL — and its `search()` routes on the `provider` setting;
- the `web-search-deepseek` row stays disabled, which is what keeps the Plugins page to one
  search card.

Picking `deepseek-official` therefore does not move the pin or touch the loader. This package
imports `DeepSeekSearchProvider` from `@deepseek-ai/dsh-web-search-deepseek` — a declared peer
dependency — and delegates to it, so that backend's behaviour, errors and endpoint handling
are the shipped ones. What it costs is that the shipped provider's own configuration card is
gone, and with it the ability to edit that endpoint and model from the UI.

The patch also restates `fetchProvider: http`, because a patch replaces the targeted row's
**whole** `config` and dropping it would leave the web fetch provider unset.

Your own `cordis.patch.yml` is applied after every bundle layer, so you can still override any
of these rows — but you must restate the whole config to do so.
```

- [ ] **Step 3: Update the first caveat**

In `README.md`, replace the caveat beginning `- **The shipped DeepSeek search provider starts switched off.**` with:

```markdown
- **The shipped DeepSeek search provider starts switched off, and its settings card stays
  off.** The default selection is Tavily, so **Settings → Plugins** shows this plugin's card
  alone; picking `deepseek-official` runs that backend without bringing its card back. Its
  endpoint and model are not editable from the UI.
```

- [ ] **Step 4: Update the install paragraph**

In `README.md`, replace the paragraph beginning `Either form installs the same package.` with:

```markdown
Either form installs the same package. It declares `dsh.bundle.patch`, so `dsh plugin add`
registers it in the profile's `dsh.profile.bundles` and its shipped patch mounts the
provider, pins the web seam's search to it, and switches off the DeepSeek search provider the
base bundle ships. `web_search` is therefore Tavily-backed, and
**Settings → Plugins → Plugin configuration** shows this plugin's card alone. Its **Search
provider** select switches to the shipped DeepSeek backend without a restart. Nothing else to
configure.
```

- [ ] **Step 5: Put the pin back in the manual install snippet**

In `README.md`, replace the manual-install YAML block with:

```yaml
- insert:
    - id: web-search-tavily
      name: ./plugins/tavily-search/index.js
      config:
        apiKeyEnv: TAVILY_API_KEY

# The shipped DeepSeek provider starts off, so the default selection is this
# one; the card switches between them inside this plugin. Pinning the seam is
# what keeps a third search provider from making it ambiguous.
- id: web-search-deepseek
  disabled: true

- id: web
  config:
    searchProvider: tavily
    fetchProvider: http
```

- [ ] **Step 6: Update the configuration table row**

In `README.md`, replace the `provider` table row with:

```markdown
| `provider` | `tavily` | Which backend answers `web_search`: `tavily` or `deepseek-official` — see [Switching providers](#switching-providers). |
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: `68 passed, 0 failed` then `38 passed, 0 failed`.

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "docs: describe the switch as routing, not row toggling"
```

---

### Task R4: Repack and reinstall

**Files:** none — this task produces `0x427567-dsh-tavily-0.2.0.tgz` and installs it.

- [ ] **Step 1: Pack**

Run:
```bash
npm pack --cache ./.pack-cache --no-audit --no-fund
rm -rf .pack-cache
tar -tzf 0x427567-dsh-tavily-0.2.0.tgz
```
Expected: `package/LICENSE`, `package/README.md`, `package/client.js`, `package/cordis.patch.yml`, `package/index.js`, `package/package.json` — and no `package/test/`.

- [ ] **Step 2: Install**

Run:
```bash
dsh plugin --profile web add /Users/shirelyhuang/Documents/Project/dsh-tavily-keyless/0x427567-dsh-tavily-0.2.0.tgz
grep '"version"' ~/.dsh/profiles/web/node_modules/@0x427567/dsh-tavily/package.json
```
Expected: `"version": "0.2.0"`.

This writes outside the session workspace (pnpm's store and `~/.dsh/profiles/web`), so it needs
the wider sandbox mode. Do **not** restart the harness: `dsh web` is the server hosting the
conversation. Ask the user to restart.

---

## Self-Review

**Spec coverage**

| Spec section (design C) | Task |
|---|---|
| Goal — a select in the card, next search, no restart, persists | Already built; R1 keeps the setting wired |
| Non-goal — no automatic fallback | No task adds one |
| Non-goal — no runtime `searchProvider` change | R2 keeps the pin static; R1 never touches the loader |
| Non-goal — no card for the DeepSeek endpoint/model | R1 takes the shipped defaults plus `DEEPSEEK_SEARCH_BASE_URL`; R3 documents it |
| Non-goal — the shipped card stays off | R1 deletes the row-toggle code; R2 keeps the row disabled |
| Shape — three rows, none toggled | R1, R2 |
| Configuration — `provider`, values, default | Already built |
| Components — `deepSeekBackend`, `search()` routing, `available()` reverted | R1 |
| Error handling | R1 Step 3 (the failure check), and the shipped provider's own errors by construction |
| Testing — routing, failure, schema, patch | R1, R2; the schema checks already exist |
| Risks — peer coupling | R1 Step 5 declares it |
| Rollout — 0.2.0, README | R3, R4 |

**Placeholder scan:** no TBD, no "handle edge cases", no "similar to Task N" — every code,
YAML and Markdown block is written out.

**Type consistency:** `credentialResolver(ctx, ref)` is introduced once in R1 Step 8 and used
in R1 Step 9; `deepSeekBackend(ctx)` is introduced in R1 Step 9 and used in R1 Step 13;
`shippedBackend` is declared in R1 Step 11 and read in R1 Step 12; `BUILTIN_API_KEY_ENV` and
`BUILTIN_BASE_URL_ENV` replace `BUILTIN_ROW_ID` in R1 Step 7 and are used in R1 Step 9;
`BUILTIN_PROVIDER_ID` is unchanged from the earlier work and is read in R1 Step 12.

**Test counts:** the provider suite goes 73 → 68 in R1 (ten section-13 checks out, five in) and
stays 68 through R2. The client suite stays 38 throughout.
