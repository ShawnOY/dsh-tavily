/**
 * Provider tests for the Tavily search provider.
 *
 * The stubbed assertions run offline and always execute. The live Tavily calls
 * are opt-in, because they need network access:
 *
 *   node test/provider.test.mjs                          # offline only
 *   TAVILY_LIVE_TEST=1 node test/provider.test.mjs       # + a live keyless call
 *   TAVILY_LIVE_TEST=1 TAVILY_API_KEY=tvly-... node test/provider.test.mjs
 *
 * The plugin imports its `@deepseek-ai/*` peers as bare specifiers, so this
 * must run where they resolve — for example inside the profile that has the
 * plugin installed, whose node_modules sits on the resolution path.
 */
const mod = await import(new URL('../index.js', import.meta.url));

let pass = 0;
let fail = 0;
const check = (label, ok, extra = '') => {
	if (ok) {
		pass += 1;
		console.log(`  PASS  ${label}`);
	} else {
		fail += 1;
		console.log(`  FAIL  ${label} ${extra}`);
	}
};

const okBody = (count = 2) =>
	JSON.stringify({
		results: Array.from({ length: count }, (_, i) => ({ title: `T${i}`, url: `https://e${i}.com`, content: 'c' }))
	});
const refused429 = () => new Response(JSON.stringify({ detail: 'keyless budget exhausted' }), { status: 429 });

let seen = [];
let queue = [];
let logs = [];
const realFetch = globalThis.fetch;

globalThis.fetch = async (url, init) => {
	seen.push({ headers: init.headers, body: JSON.parse(init.body) });
	const next = queue.shift();
	if (next === undefined) throw new Error('unexpected extra fetch');
	return next();
};

/** Settings sections the stub provider captured, newest call last. */
let sections = [];

/** Build a provider wired to a stub context. */
function provider({ key, config = {} } = {}) {
	const registered = [];
	sections = [];
	const ctx = {
		web: { registerSearchProvider: (instance) => registered.push(instance) },
		get: (name) => (name === 'credentials' && key !== undefined ? { resolve: async () => ({ value: key }) } : undefined),
		logger: { warn: (message) => logs.push(String(message)) },
		inject: (names, callback) => {
			if (names.includes('settings')) {
				callback({ settings: { installSection: (...args) => sections.push(args) } });
			}
		}
	};
	mod.apply(ctx, { apiKeyEnv: 'TAVILY_API_KEY', ...config });
	return registered[0];
}
const reset = () => {
	seen = [];
	queue = [];
	logs = [];
};

// Keep the stub runs deterministic even when the developer exports the key.
const envKey = process.env.TAVILY_API_KEY;
delete process.env.TAVILY_API_KEY;

console.log('1. default keyless-first: a key exists but keyless is tried first');
reset();
queue = [() => new Response(okBody(), { status: 200 })];
let result = await provider({ key: 'tvly-k' }).search({ query: 'q' });
check('exactly one request', seen.length === 1, `(got ${seen.length})`);
check('used keyless, not the key', seen[0].headers['x-tavily-access-mode'] === 'keyless' && seen[0].headers.authorization === undefined);
check('no notice on the happy path', result.content === undefined, `(got ${JSON.stringify(result.content)})`);

console.log('2. keyless refused (429) -> retry with the key, and say so');
reset();
queue = [refused429, () => new Response(okBody(), { status: 200 })];
const cooling = provider({ key: 'tvly-k' });
result = await cooling.search({ query: 'q' });
check('two requests: keyless then key', seen.length === 2, `(got ${seen.length})`);
check('the retry carried the key', seen[1].headers.authorization === 'Bearer tvly-k');
check('the result still came back', result.sources.length === 2);
check('notice reports the exhausted budget', typeof result.content === 'string' && result.content.includes('額度已用盡'), `(got ${JSON.stringify(result.content)})`);
check('the operator was warned', logs.length === 1 && logs[0].includes('keyless tier refused'), `(logs=${JSON.stringify(logs)})`);

console.log('3. while cooling down: straight to the key, with a cooldown notice');
reset();
queue = [() => new Response(okBody(), { status: 200 })];
result = await cooling.search({ query: 'q' });
check('one request only (keyless skipped)', seen.length === 1, `(got ${seen.length})`);
check('used the key', seen[0].headers.authorization === 'Bearer tvly-k');
check('notice reports the cooldown', typeof result.content === 'string' && result.content.includes('冷卻中'), `(got ${JSON.stringify(result.content)})`);

console.log('4. keylessCooldownMinutes:0 disables the cooldown');
reset();
queue = [() => new Response(okBody(), { status: 200 })];
await provider({ key: 'tvly-k', config: { keylessCooldownMinutes: 0 } }).search({ query: 'q' });
check('keyless is tried again', seen[0].headers['x-tavily-access-mode'] === 'keyless');

console.log('5. a 200 carrying prose instead of a result set is a refusal too');
reset();
queue = [() => new Response(JSON.stringify({ detail: 'You have hit the keyless cap.' }), { status: 200 }), () => new Response(okBody(), { status: 200 })];
await provider({ key: 'tvly-k' }).search({ query: 'q' });
check('fell back to the key', seen.length === 2 && seen[1].headers.authorization === 'Bearer tvly-k');
check('the refusal prose reached the log', logs.some((line) => line.includes('keyless cap')));

console.log('6. a non-refusal error does not silently fall back');
reset();
queue = [() => new Response(JSON.stringify({ detail: 'bad query' }), { status: 400 })];
try {
	await provider({ key: 'tvly-k' }).search({ query: 'q' });
	check('400 surfaces as an error', false, '(no throw)');
} catch (error) {
	check('400 surfaces as an error', error.code === 'WEB_PROVIDER_ERROR' && seen.length === 1, `(code=${error.code}, requests=${seen.length})`);
}

console.log('7. the other modes');
reset();
queue = [() => new Response(okBody(), { status: 200 })];
await provider({ key: 'tvly-k', config: { mode: 'key-first' } }).search({ query: 'q' });
check('key-first uses the key immediately', seen[0].headers.authorization === 'Bearer tvly-k');
reset();
queue = [() => new Response(okBody(), { status: 200 })];
await provider({ key: 'tvly-k', config: { mode: 'keyless-only' } }).search({ query: 'q' });
check('keyless-only never sends the key', seen[0].headers['x-tavily-access-mode'] === 'keyless' && seen[0].headers.authorization === undefined);
reset();
try {
	await provider({ config: { mode: 'key-only' } }).search({ query: 'q' });
	check('key-only without a key throws', false, '(no throw)');
} catch (error) {
	check('key-only without a key throws', error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING', `(code=${error.code})`);
}

console.log('8. response mapping');
reset();
queue = [
	() =>
		new Response(
			JSON.stringify({
				results: [
					{ title: 'A', url: 'https://a.com', content: 'sa', published_date: 'Mon, 22 Sep 2026 10:00:00 GMT' },
					{ title: 'dup', url: 'https://a.com', content: 'dup' },
					{ title: 'no url', content: 'x' },
					{ title: 'B', url: 'https://b.com', content: 'sb', published_date: 'nope' }
				]
			}),
			{ status: 200 }
		)
];
result = await provider({ key: 'k' }).search({ query: 'q', maxResults: 5 });
check('duplicates and empty URLs dropped', result.sources.length === 2, `(got ${result.sources.length})`);
check('RFC-1123 date becomes ISO-8601', result.sources[0].publishedAt === '2026-09-22T10:00:00.000Z', `(got ${result.sources[0].publishedAt})`);
check('an unparseable date is omitted', result.sources[1].publishedAt === undefined);

console.log('9. settings section');
reset();
const settingsProvider = provider({ key: 'tvly-k', config: { mode: 'key-first' } });
check('exactly one section registered', sections.length === 1, `(got ${sections.length})`);
const [owner, namespace, schema, entry, hooks] = sections[0];
check('namespace is the plugin namespace', namespace === 'web-search-tavily-keyless', `(got ${namespace})`);
check('the exported namespace matches', mod.SETTINGS_NAMESPACE === namespace);
check('owner is the calling context', owner !== undefined);
check('entry is the composition config', entry.mode === 'key-first');
check('hooks expose setSource and onChange', typeof hooks.setSource === 'function' && typeof hooks.onChange === 'function');
hooks.setSource(() => ({ apiKeyEnv: 'TAVILY_API_KEY', mode: 'keyless-only' }));
reset();
queue = [() => new Response(okBody(), { status: 200 })];
await settingsProvider.search({ query: 'q' });
check('a settings change drives the next search', seen[0].headers['x-tavily-access-mode'] === 'keyless' && seen[0].headers.authorization === undefined);

console.log('10. Config schema');
const defaults = new mod.Config({ apiKeyEnv: 'TAVILY_API_KEY' });
check('mode defaults to keyless-first', defaults.mode === 'keyless-first', `(got ${defaults.mode})`);
check('cooldown defaults to 10 minutes', defaults.keylessCooldownMinutes === 10, `(got ${defaults.keylessCooldownMinutes})`);
check('every documented mode is accepted', ['keyless-first', 'key-first', 'keyless-only', 'key-only'].every((mode) => new mod.Config({ mode }).mode === mode));
check('an unknown mode is rejected', (() => {
	try {
		new mod.Config({ mode: 'nonsense' });
		return false;
	} catch {
		return true;
	}
})());

if (process.env.TAVILY_LIVE_TEST !== '1') {
	console.log('\n11. live Tavily calls — skipped (set TAVILY_LIVE_TEST=1 to enable)');
} else {
	console.log('11. live Tavily calls');
	globalThis.fetch = realFetch;
	const live = [['keyless (no credentials at all)', {}]];
	if (envKey !== undefined) live.push(['keyless-first with a key present', { key: envKey }]);
	for (const [label, options] of live) {
		try {
			const liveResult = await provider(options).search({ query: 'DeepSeek Harness github', maxResults: 3 });
			check(`${label} -> ${liveResult.sources.length} sources`, liveResult.sources.length > 0);
		} catch (error) {
			check(label, false, `-> ${error.code}: ${String(error.message).slice(0, 140)}`);
		}
	}
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
