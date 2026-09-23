# Search Provider Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a deployment pick, from the plugin's settings card and without a restart, whether `web_search` is answered by this package's Tavily backend or by the DeepSeek search provider that `dsh-base` ships.

**Architecture:** The seam (`ctx.web`) resolves its provider on every call, so no pin is needed if exactly one provider is *usable* at any instant. This package's provider stays registered and reports `available() === false` unless it is selected **and** the shipped `web-search-deepseek` row is currently disabled; a settings change toggles that row through the loader. The spec is `docs/superpowers/specs/2026-09-23-search-provider-switch-design.md`.

**Tech Stack:** Plain ESM, Node `^22.19 || >=24`, no build step. Host half is `index.js` (Cordis plugin over `ctx.web` and `ctx.settings`), browser half is the prebuilt bundle `client.js`, tests are dependency-free scripts under `test/`.

## Global Constraints

- No new dependency. The DeepSeek backend is **not** re-hosted: `@deepseek-ai/dsh-web-search-deepseek` must not be imported or added to `package.json`.
- `package.json` keeps `peerDependencies` at `@deepseek-ai/dsh-credentials` and `@deepseek-ai/dsh-web`, both `^0.1.5-rc.2`, and `engines.node` at `^22.19 || >=24`.
- The registered provider id stays `tavily` (`TAVILY_PROVIDER_ID`); the settings namespace stays `dsh-tavily`; the loader row id is exactly `web-search-deepseek`.
- The new setting is `provider`, accepting exactly `tavily` and `deepseek-official`, defaulting to `tavily`.
- `client.js` is served as written — edit it by hand, never build it. It stays a `window.__ModuleLoader__.load` factory and its `dsh.client.platform` stays `web`.
- The three dictionaries (`en`, `zh`, `zh-Hant`) must always carry **identical key sets**; `test/client.test.mjs` section 3 enforces this.
- Copy vocabulary is fixed by the previous commit: 免金鑰/金鑰 and 拒絕 in Traditional, 免密钥/密钥 and 拒绝 in Simplified, "keyless"/"key"/"refusal" in English. Do not introduce 免密鑰 or 被拒.
- Tests run offline. Live Tavily calls stay behind `TAVILY_LIVE_TEST=1`.
- Commits are Conventional Commits: English imperative subject, prose body explaining why.
- Target version for this work: `0.2.0`.

---

### Task 1: Add the `provider` field to the config schema

**Files:**
- Modify: `index.js:40` (constants), `index.js:130-140` (`Config`), `index.js:194-215` (`resolveOptions`)
- Test: `test/provider.test.mjs:197-209` (section 10)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Config.provider: 'tavily' | 'deepseek-official'`, default `'tavily'`; `resolveOptions()` returns `options.provider` as a string.

- [ ] **Step 1: Write the failing test**

In `test/provider.test.mjs`, inside section 10 (`console.log('10. Config schema');`), after the existing `an unknown mode is rejected` check, add:

```js
check('provider defaults to tavily', defaults.provider === 'tavily', `(got ${defaults.provider})`);
check('the shipped provider id is accepted', new mod.Config({ provider: 'deepseek-official' }).provider === 'deepseek-official');
check('an unknown provider is rejected', (() => {
	try {
		new mod.Config({ provider: 'nonsense' });
		return false;
	} catch {
		return true;
	}
})());
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/provider.test.mjs`
Expected: FAIL on `provider defaults to tavily` — `(got undefined)`. The other two also fail: the accepted-id check throws, the rejected-id check returns `false`.

- [ ] **Step 3: Add the constants**

In `index.js`, directly after the `TAVILY_PROVIDER_ID` declaration (line 40), add:

```js
/** Provider id of the search backend the shipped `dsh-base` bundle registers. */
const BUILTIN_PROVIDER_ID = 'deepseek-official';
/** Backends the `provider` field accepts; each value is a seam provider id. */
const PROVIDER_VALUES = [TAVILY_PROVIDER_ID, BUILTIN_PROVIDER_ID];
```

- [ ] **Step 4: Add the schema field**

In `index.js`, in the `Config` object, insert between the `includeAnswer` and `mode` lines:

```js
	provider: z.union(PROVIDER_VALUES).default(TAVILY_PROVIDER_ID),
```

- [ ] **Step 5: Project it into the options**

In `index.js`, in the object `resolveOptions` returns, insert between the `includeAnswer` and `mode` lines:

```js
		provider: config.provider ?? TAVILY_PROVIDER_ID,
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node test/provider.test.mjs`
Expected: PASS on all three new checks; the total goes from 57 to 60 passed, 0 failed.

- [ ] **Step 7: Commit**

```bash
git add index.js test/provider.test.mjs
git commit -m "feat: add a provider field to the search config"
```

---

### Task 2: Make availability follow the selection, and toggle the shipped row

**Files:**
- Modify: `index.js:40-41` (constants), `index.js:348-351` (`available()`), `index.js:497-518` (`apply`)
- Test: `test/provider.test.mjs:50-77` (the `provider()` stub and `reset()`), and a new section 13 inserted before the live block

**Interfaces:**
- Consumes: `options.provider` from Task 1; `BUILTIN_PROVIDER_ID` from Task 1.
- Produces:
  - `loaderOf(ctx): object | undefined`
  - `findBuiltinRow(loader): { id: string, disabled: boolean } | undefined`
  - `builtinRowEnabled(ctx): boolean`
  - `async syncBuiltinRow(ctx, provider): void` — never rejects.
  - `TavilySearchProvider.available()` is `false` when `provider !== 'tavily'`, and `false` when the shipped row is enabled.

> **Warning:** between this task and Task 3 the shipped patch still pins `searchProvider: tavily`. A deployment whose setting is `deepseek-official` therefore fails searches with `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` until Task 3 lands. The default (`tavily`) is unaffected. Do not hand-edit the setting in between.

- [ ] **Step 1: Write the failing test**

In `test/provider.test.mjs`, add the loader stub and the settle helper directly after the `reset` declaration (line 77):

```js
/** Let a fire-and-forget row sync settle before asserting on it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A stub loader holding the shipped row, whose `disabled` flag the plugin flips.
 * `failUpdate` models a row the plugin can see but cannot toggle.
 */
function stubLoader({ rows = [{ id: 'web-search-deepseek', disabled: true }], failUpdate = false } = {}) {
	const state = rows.map((row) => ({ ...row }));
	return {
		state,
		entries: () => state,
		update: async (id, options) => {
			if (failUpdate) throw new Error('loader refused the update');
			const row = state.find((candidate) => candidate.id === id);
			if (row === undefined) throw new Error(`no row ${id}`);
			Object.assign(row, options);
		}
	};
}
```

Change the `provider()` signature and its `get` to accept a loader, defaulting to a loader whose row is already disabled (the steady state, so existing sections stay quiet):

```js
function provider({ key, config = {}, locale, loader = stubLoader() } = {}) {
```

and inside the `get` switch, before the final `return undefined;`:

```js
			if (name === 'loader' && loader !== null) return loader;
```

Then add section 13 immediately before `console.log('13. live Tavily calls — skipped ...')` / `console.log('13. live Tavily calls');`, and renumber those two live lines from `13.` to `15.` — section 14 is added by Task 3, so the intermediate commit shows a gap in the numbering, which is cosmetic.

```js
console.log('13. provider selection');
reset();
const offLoader = stubLoader({ rows: [{ id: 'web-search-deepseek', disabled: false }] });
const offProvider = provider({ key: 'tvly-k', loader: offLoader });
await settle();
check('selecting Tavily disables the shipped row', offLoader.state[0].disabled === true, `(got ${offLoader.state[0].disabled})`);
check('and Tavily stays available', offProvider.available() === true);

reset();
const onLoader = stubLoader();
const onProvider = provider({ key: 'tvly-k', config: { provider: 'deepseek-official' }, loader: onLoader });
await settle();
check('selecting the shipped provider enables its row', onLoader.state[0].disabled === false, `(got ${onLoader.state[0].disabled})`);
check('and Tavily reports itself unavailable', onProvider.available() === false);

reset();
const stuck = provider({ key: 'tvly-k', loader: stubLoader({ rows: [{ id: 'web-search-deepseek', disabled: false }], failUpdate: true }) });
await settle();
check('a row that cannot be disabled keeps Tavily unavailable', stuck.available() === false);
check('and the failure is logged', logs.some((line) => line.includes('could not')), `(logs=${JSON.stringify(logs)})`);

reset();
const orphan = provider({ key: 'tvly-k', config: { provider: 'deepseek-official' }, loader: stubLoader({ rows: [] }) });
await settle();
check('a missing shipped row leaves the shipped selection with nothing usable', orphan.available() === false);
check('and the missing row is logged', logs.some((line) => line.includes('web-search-deepseek')), `(logs=${JSON.stringify(logs)})`);

reset();
provider({ key: 'tvly-k', loader: null });
await settle();
check('a composition with no loader is reported', logs.some((line) => line.includes('no loader')), `(logs=${JSON.stringify(logs)})`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/provider.test.mjs`
Expected: FAIL on `selecting Tavily disables the shipped row` (the row stays `false`), `selecting the shipped provider enables its row`, and every availability check that depends on the row. The no-loader check fails because nothing logs.

- [ ] **Step 3: Add the row id constant**

In `index.js`, directly after the `PROVIDER_VALUES` declaration, add:

```js
/** Loader row id of the shipped DeepSeek search provider this bundle switches off. */
const BUILTIN_ROW_ID = 'web-search-deepseek';
```

- [ ] **Step 4: Add the loader helpers**

In `index.js`, directly above `/** The Tavily-backed search provider. */` (line 332), add:

```js
/** The loader service, or `undefined` when this composition has none. */
function loaderOf(ctx) {
	try {
		return ctx.get?.('loader');
	} catch {
		return undefined;
	}
}

/** The shipped row's entry in a loader's entry list, or `undefined`. */
function findBuiltinRow(loader) {
	try {
		for (const entry of loader.entries()) if (entry.id === BUILTIN_ROW_ID) return entry;
	} catch {
		// A loader that cannot list entries is treated as having no such row.
	}
	return undefined;
}

/**
 * Whether the shipped row is currently loaded. Read live on every `available()`
 * call rather than cached, because the row is toggled at runtime and the seam's
 * "exactly one usable provider" rule depends on this answer tracking the loader
 * rather than the setting.
 *
 * @param ctx - plugin context whose optional loader service owns the row.
 * @returns `true` only when the row is present and enabled.
 */
function builtinRowEnabled(ctx) {
	const loader = loaderOf(ctx);
	if (loader === undefined) return false;
	const entry = findBuiltinRow(loader);
	return entry !== undefined && !entry.disabled;
}

/**
 * Put the shipped row into the state the selected backend needs: enabled only
 * while the shipped provider is the selection.
 *
 * A missing loader or a missing row is reported and skipped rather than thrown,
 * so a profile without the shipped provider still runs this one. A toggle that
 * fails is loud in the log for the same reason — it is the one thing that can
 * leave the seam with no usable provider.
 *
 * @param ctx - plugin context whose optional loader service owns the row.
 * @param provider - the selected backend id.
 * @returns a promise that never rejects.
 */
async function syncBuiltinRow(ctx, provider) {
	const loader = loaderOf(ctx);
	if (loader === undefined) {
		ctx.logger?.warn?.(`Tavily search: no loader service, so the "${BUILTIN_ROW_ID}" row was left as composed.`);
		return;
	}
	const entry = findBuiltinRow(loader);
	if (entry === undefined) {
		ctx.logger?.warn?.(`Tavily search: loader row "${BUILTIN_ROW_ID}" is not composed, so backend switching cannot work.`);
		return;
	}
	const disabled = provider !== BUILTIN_PROVIDER_ID;
	if (entry.disabled === disabled) return;
	try {
		await loader.update(BUILTIN_ROW_ID, { disabled });
	} catch (error) {
		ctx.logger?.warn?.(`Tavily search: could not ${disabled ? 'disable' : 'enable'} the "${BUILTIN_ROW_ID}" row: ${String(error)}`);
	}
}
```

- [ ] **Step 5: Gate `available()`**

Replace the body of `available()` in `index.js` (lines 348-351) with:

```js
	available() {
		const options = this.resolveOptions();
		if (options.provider !== TAVILY_PROVIDER_ID) return false;
		if (builtinRowEnabled(options.ctx)) return false;
		return (options.apiKey !== undefined || options.resolveApiKey !== undefined) && URL.canParse(options.baseURL);
	}
```

- [ ] **Step 6: Wire the sync into `apply()`**

Replace the `onChange: () => {}` line and the closing of `apply` in `index.js` (lines 507-518) with:

```js
function apply(ctx, config) {
	let current = () => config;
	ctx.inject(['settings'], (settingsCtx) => {
		settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, Config, config, {
			setSource: (source) => {
				current = source;
			},
			// Also fires at attach, so boot applies the persisted choice.
			onChange: () => {
				void syncBuiltinRow(ctx, current().provider ?? TAVILY_PROVIDER_ID);
			}
		});
	});
	ctx.web.registerSearchProvider(new TavilySearchProvider(() => resolveOptions(ctx, current())));
	// Covers a composition with no settings service, where `onChange` never fires.
	void syncBuiltinRow(ctx, current().provider ?? TAVILY_PROVIDER_ID);
}
```

`current()` is read after the `inject` callback, so when a settings service is present `current` already points at the live settings source and the live value wins over the composition entry.

- [ ] **Step 7: Run the test to verify it passes**

Run: `node test/provider.test.mjs`
Expected: PASS on every new check, and every pre-existing section still passes (section 2's `logs.length === 1` holds because the default stub loader's row is already disabled, so the sync returns early without logging). Total: 60 + 9 = 69 passed, 0 failed.

- [ ] **Step 8: Commit**

```bash
git add index.js test/provider.test.mjs
git commit -m "feat: switch search backends through the loader"
```

---

### Task 3: Drop the seam pin so the switch takes effect

**Files:**
- Modify: `cordis.patch.yml`
- Test: `test/provider.test.mjs` — new section 14, inserted after section 13 and before the live block

**Interfaces:**
- Consumes: the availability rule from Task 2.
- Produces: a composed `web` row with no `searchProvider`, which is what lets `resolveProvider` follow availability.

- [ ] **Step 1: Write the failing test**

Add `import { readFile } from 'node:fs/promises';` to the import block at the top of `test/provider.test.mjs`, directly above the `const mod = await import(...)` line.

Then add section 14 after section 13:

```js
console.log('14. the shipped patch leaves the seam unpinned');
const patchText = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
const patchRows = patchText
	.split('\n')
	.filter((line) => !line.trimStart().startsWith('#'))
	.join('\n');
check('no provider is pinned', !patchRows.includes('searchProvider'), `(rows=${JSON.stringify(patchRows)})`);
check('the fetch provider is still restated', patchRows.includes('fetchProvider: http'));
check('the shipped row is disabled by default', /- id: web-search-deepseek\n\s+disabled: true/.test(patchRows));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/provider.test.mjs`
Expected: FAIL on `no provider is pinned` — the patch still carries `searchProvider: tavily`. The other two pass.

- [ ] **Step 3: Unpin the seam**

In `cordis.patch.yml`, replace the last block:

```yaml
- id: web
  config:
    searchProvider: tavily
    fetchProvider: http
```

with:

```yaml
- id: web
  config:
    fetchProvider: http
```

- [ ] **Step 4: Rewrite the patch comments**

In `cordis.patch.yml`, replace the two paragraphs that explain the pin — the one starting `# A patch replaces the targeted row's WHOLE \`config\`` through the paragraph ending `# provider is switched back on later.` — with:

```yaml
# A patch replaces the targeted row's WHOLE `config`, so the base `web` row is
# restated in full: `fetchProvider` keeps the http provider the base already
# selected. `searchProvider` is deliberately NOT set: the seam resolves its
# provider on every call, so leaving it unpinned is what lets the card's
# `provider` setting switch backends without a restart. This package's provider
# is usable only while the row below is off, and the shipped provider is usable
# only while it is on, so the seam always sees exactly one usable provider.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node test/provider.test.mjs`
Expected: PASS on all three section-14 checks. Total: 72 passed, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add cordis.patch.yml test/provider.test.mjs
git commit -m "feat!: let the seam follow the selected provider"
```

---

### Task 4: Add the provider select to the settings card

**Files:**
- Modify: `client.js:37-39` (constants), `client.js:169-188` (insert the field before the language field), `client.js:254-321` (all three dictionaries)
- Test: `test/client.test.mjs` — new section 7 after section 6

**Interfaces:**
- Consumes: the `provider` field name and its two values from Task 1.
- Produces: a `<select class="tk_select">` whose option values are exactly `tavily` and `deepseek-official`, plus the dictionary keys `provider`, `provider.tavily`, `provider.deepseek-official`, `providerHint` in all three languages.

- [ ] **Step 1: Write the failing test**

In `test/client.test.mjs`, after the section 6 checks (after the `en` renders English` line), add:

```js
console.log('7. the provider selector');
check('en names the field', dicts.en.provider === 'Search provider', `(got ${dicts.en.provider})`);
check('zh names the field', typeof dicts.zh.provider === 'string' && dicts.zh.provider.length > 0);
check('zh-Hant names the field', typeof dicts['zh-Hant'].provider === 'string' && dicts['zh-Hant'].provider.length > 0);
check(
	'every backend has copy in every language',
	['tavily', 'deepseek-official'].every((id) => ['en', 'zh', 'zh-Hant'].every((locale) => typeof dicts[locale]['provider.' + id] === 'string'))
);
// The card renders its body only while `open`, and the stub answers `true` for
// boolean state, so this is the one render that reaches the fields.
const realUseState = react.useState;
react.useState = (initial) => [typeof initial === 'boolean' ? true : typeof initial === 'function' ? initial() : initial, () => {}];
const rendered = Card({ t: (key) => `shell:${key}` });
react.useState = realUseState;
const selects = nodesWithClass(rendered, 'tk_select');
const providerSelect = selects.find((node) => (node.props.children ?? []).some((option) => option?.props?.value === 'deepseek-official'));
check('the card renders a provider select', providerSelect !== undefined, `(got ${selects.length} selects)`);
check(
	'with exactly the two seam provider ids',
	JSON.stringify((providerSelect?.props.children ?? []).map((option) => option.props.value)) === JSON.stringify(['tavily', 'deepseek-official'])
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/client.test.mjs`
Expected: FAIL on all four copy checks and both render checks; section 3 (`the three languages carry identical key sets`) still passes because no dictionary has the new keys yet.

- [ ] **Step 3: Add the option list**

In `client.js`, directly after `const MODES = [...]` (line 37), add:

```js
		const PROVIDERS = ['tavily', 'deepseek-official'];
```

- [ ] **Step 4: Render the field**

In `client.js`, inside the `open ?` body, insert this block immediately before the language field (the `jsxs('div', { className: 'tk_field'` whose label is `copy('language', 'Language')`):

```js
										jsxs('div', {
											className: 'tk_field',
											children: [
												jsx('label', { className: 'tk_label', children: copy('provider', 'Search provider') }),
												jsx('select', {
													className: 'tk_select',
													value: typeof value.provider === 'string' ? value.provider : PROVIDERS[0],
													disabled: saving,
													onChange: (event) => change('provider', event.target.value),
													children: PROVIDERS.map((provider) => jsx('option', { value: provider, children: copy('provider.' + provider, provider) }, provider))
												}),
												jsx('p', { className: 'tk_hint', children: copy('providerHint', 'Which backend answers web_search. Choosing the built-in one brings back its own Web search card.') })
											]
										}),
```

- [ ] **Step 5: Add the copy to all three dictionaries**

In `client.js`, add these four lines to the `en` dictionary, after `description`:

```js
			provider: 'Search provider',
			'provider.tavily': 'Tavily (this plugin)',
			'provider.deepseek-official': 'DSH built-in (DeepSeek)',
			providerHint: 'Which backend answers web_search. Choosing the built-in one brings back its own Web search card.',
```

to the `zh` dictionary, after `description`:

```js
			provider: '搜索服务',
			'provider.tavily': 'Tavily（本插件）',
			'provider.deepseek-official': 'DSH 内置（DeepSeek）',
			providerHint: '由哪个后端处理 web_search。选择内置服务时，它自己的「网页搜索」卡片会重新出现。',
```

and to the `zhHant` dictionary, after `description`:

```js
			provider: '搜尋服務',
			'provider.tavily': 'Tavily（本外掛）',
			'provider.deepseek-official': 'DSH 內建（DeepSeek）',
			providerHint: '由哪個後端處理 web_search。選擇內建服務時，它自己的「網頁搜尋」卡片會重新出現。',
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node test/client.test.mjs`
Expected: PASS on all six new checks, and section 3 still passes because all three dictionaries gained the same four keys. Total: 32 + 6 = 38 passed, 0 failed.

- [ ] **Step 7: Run both suites**

Run: `npm test`
Expected: `69 passed, 0 failed` then `38 passed, 0 failed`.

- [ ] **Step 8: Commit**

```bash
git add client.js test/client.test.mjs
git commit -m "feat: add the provider select to the settings card"
```

---

### Task 5: Document the switch, cut 0.2.0, and reinstall

**Files:**
- Modify: `README.md` (Configuration table, the runtime-editable paragraph, the pin section, Caveats), `package.json:3` (version)

**Interfaces:**
- Consumes: everything above.
- Produces: the packaged `0x427567-dsh-tavily-0.2.0.tgz` installed into `~/.dsh/profiles/web`.

- [ ] **Step 1: Add the setting to the Configuration table**

In `README.md`, in the configuration table, insert this row directly above the `mode` row:

```markdown
| `provider` | `tavily` | Which backend answers `web_search`: `tavily` or `deepseek-official` — see [Switching providers](#switching-providers). |
```

- [ ] **Step 2: Update the runtime-editable paragraph**

In `README.md`, replace the sentence beginning `` `mode`, `keylessCooldownMinutes` and `language` are also editable at runtime`` with:

```markdown
`provider`, `mode`, `keylessCooldownMinutes` and `language` are also editable at runtime from
**Settings → Plugins → Plugin configuration**. This package ships a browser half that contributes the card for its
`dsh-tavily` namespace — registering a namespace on the Host is not enough on its
own, because that page renders only the namespaces a card claims. A change there takes effect on
the next search, and the profile patch remains the base value a reset returns to. The other keys
are file-only.
```

- [ ] **Step 3: Add the Switching providers section**

In `README.md`, insert this section directly before `## Why the shipped DeepSeek provider is switched off`:

```markdown
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
```

- [ ] **Step 4: Rewrite the pin section around the invariant**

In `README.md`, replace the whole section from `## Why the shipped DeepSeek provider is switched off` through the paragraph ending `` but you must restate the whole config to do so.`` with:

```markdown
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
```

- [ ] **Step 5: Rewrite the first caveat**

In `README.md`, replace the caveat beginning `- **Installing this plugin switches off the shipped DeepSeek search provider.**` with:

```markdown
- **The shipped DeepSeek search provider starts switched off.** The default selection is
  Tavily, so **Settings → Plugins** shows this plugin's card alone. Pick
  `deepseek-official` in the card and that provider's own card comes back next to this one.
```

- [ ] **Step 6: Cut the version**

In `package.json`, change `"version": "0.1.2"` to `"version": "0.2.0"`.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: `72 passed, 0 failed` then `38 passed, 0 failed`.

- [ ] **Step 8: Commit**

```bash
git add README.md package.json
git commit -m "docs: document the provider switch and cut 0.2.0"
```

- [ ] **Step 9: Pack the release**

Run:
```bash
npm pack --cache ./.pack-cache --no-audit --no-fund
rm -rf .pack-cache
tar -tzf 0x427567-dsh-tavily-0.2.0.tgz
```
Expected: `package/LICENSE`, `package/README.md`, `package/client.js`, `package/cordis.patch.yml`, `package/index.js`, `package/package.json` — and no `package/test/`.

- [ ] **Step 10: Install it into the profile**

Run:
```bash
dsh plugin --profile web add /Users/shirelyhuang/Documents/Project/dsh-tavily-keyless/0x427567-dsh-tavily-0.2.0.tgz
rm -f 0x427567-dsh-tavily-0.1.2.tgz
grep '"version"' ~/.dsh/profiles/web/node_modules/@0x427567/dsh-tavily/package.json
```
Expected: `"version": "0.2.0"`.

This writes outside the session workspace (pnpm's store and `~/.dsh/profiles/web`), so it needs the wider sandbox mode. Do **not** restart the harness: `dsh web` is the server hosting the conversation. Ask the user to restart.

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| Goal — a select in the card, next search, no restart, persists | Tasks 1, 2, 4 |
| Non-goal — no re-hosted DeepSeek backend | Global Constraints; no task imports it |
| Non-goal — the shipped card returns when selected | Tasks 2, 3 |
| Configuration — `provider`, values, default | Task 1 |
| Patch — row disabled by default, pin dropped, `fetchProvider` restated | Task 3 |
| Components — `Config`, `available()`, `syncBuiltinRow`, `onChange`, card | Tasks 1, 2, 4 |
| Switching sequence | Task 2 Step 6 (attach-time sync plus later changes) |
| Error handling table | Task 2 Step 4, Task 2 Step 1 (four of five rows asserted) |
| Testing | Tasks 1, 2, 3, 4 |
| Rollout — 0.2.0, README | Task 5 |

The one spec row without a dedicated assertion is "a user's own patch re-enables the row". It
is the same code path as the shipped-row-enabled case, which Task 2 Step 1 does assert, so it
is covered by construction rather than by a separate test.

**Placeholder scan:** no TBD, no "handle edge cases", no "similar to Task N" — every code and
copy block is written out.

**Type consistency:** `BUILTIN_PROVIDER_ID` (Task 1) is the same identifier used in
`syncBuiltinRow` (Task 2); `BUILTIN_ROW_ID` is introduced once, in Task 2, and used by both
`findBuiltinRow` and `syncBuiltinRow`; `options.provider` is produced in Task 1 and consumed
in Task 2; the card's `provider` field name and the two option values match `PROVIDER_VALUES`
in Task 1 and the dictionary keys in Task 4. Test counts quoted per task: Task 1 ends at 60,
Task 2 at 69, Task 3 at 72; the client suite ends at 38.
