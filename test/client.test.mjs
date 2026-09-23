/**
 * Browser-half tests for the settings card.
 *
 * `client.js` is a prebuilt bundle rather than a module: it hands a factory to
 * `window.__ModuleLoader__.load` and expects the host's `require` for React.
 * This file stands up that contract with stubs, so the card's wiring — its
 * locale registration and the language pack it adds to the catalog — is checked
 * without a browser.
 *
 * These run offline and always execute:
 *
 *   node test/client.test.mjs
 */

let entry;
globalThis.window = {
	__ModuleLoader__: {
		load: (loaded) => {
			entry = loaded;
		}
	}
};
await import(new URL('../client.js', import.meta.url));

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

/** The React surface the card touches; nothing here renders. */
const react = {
	useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
	useEffect: () => {},
	useId: () => 'test-id',
	useRef: (value) => ({ current: value })
};
/** Build a shallow element tree, so a rendered card can be inspected. */
const jsxRuntime = {
	jsx: (type, props) => ({ type, props: props ?? {} }),
	jsxs: (type, props) => ({ type, props: props ?? {} })
};
const require = (name) => {
	if (name === 'react') return react;
	if (name === 'react/jsx-runtime') return jsxRuntime;
	throw new Error(`unexpected require(${JSON.stringify(name)})`);
};

console.log('1. the bundle loads in the shape the client module system serves');
check('the loader received an entry', entry !== undefined);
check('the entry carries an id', entry?.id === '@0x427567/dsh-tavily', `(got ${entry?.id})`);
check('the entry carries a factory', typeof entry?.factory === 'function');

const exports = entry.factory(require);
check('the factory exports apply', typeof exports.apply === 'function');
check('the factory exports inject', Array.isArray(exports.inject));
check('inject names the locale service', exports.inject.includes('locale'), `(got ${JSON.stringify(exports.inject)})`);

console.log('2. apply() registers dictionaries and language packs');
const dictionaries = [];
const languages = [];
const effects = [];
const slots = [];
let bound;
/** The snapshot the bound scope answers with; section 6 varies it. */
let snapshot = { status: 'ready', value: { language: 'auto' }, base: {}, user: {}, revision: 1 };
const ctx = {
	effect: (body, label) => {
		effects.push(label);
		return body();
	},
	locale: {
		register: (ns, dicts) => {
			dictionaries.push([ns, dicts]);
			return () => {};
		},
		addLanguage: (pack) => {
			languages.push(pack);
			return () => {};
		}
	},
	settingsScope: {
		bind: (options) => {
			bound = options;
			return {
				getSnapshot: () => snapshot,
				subscribe: () => () => {},
				set: async () => {},
				unset: async () => {}
			};
		}
	},
	slots: {
		inject: (_name, callback) => callback(),
		register: (options, component) => {
			slots.push([options, component]);
			return () => {};
		}
	}
};
exports.apply(ctx);

check('exactly one dictionary registration', dictionaries.length === 1, `(got ${dictionaries.length})`);
const [namespace, dicts] = dictionaries[0];
check('registered under the plugin namespace', namespace === 'dsh-tavily', `(got ${namespace})`);
check('the card claims the same namespace', slots[0]?.[0]?.key === namespace && slots[0]?.[0]?.locale === namespace);
check('the card registers into settings.plugin.item', slots[0]?.[0]?.name === 'settings.plugin.item', `(got ${slots[0]?.[0]?.name})`);
check('the settings scope is bound to that namespace', bound?.namespace === namespace);
check('every effect is labelled', effects.length === 3 && effects.every((label) => typeof label === 'string' && label.length > 0), `(got ${JSON.stringify(effects)})`);

console.log('3. the three languages carry identical key sets');
const enKeys = Object.keys(dicts.en).sort();
for (const locale of ['zh', 'zh-Hant']) {
	const keys = Object.keys(dicts[locale] ?? {}).sort();
	check(`${locale} is registered`, keys.length > 0, `(got ${keys.length} keys)`);
	check(`${locale} matches the en key set`, JSON.stringify(keys) === JSON.stringify(enKeys), `(got ${JSON.stringify(keys)})`);
}

console.log('4. zh is Simplified and zh-Hant is Traditional');
check('zh title is Simplified', dicts.zh.title.includes('网页搜索'), `(got ${dicts.zh.title})`);
check('zh save is Simplified', dicts.zh.save === '保存', `(got ${dicts.zh.save})`);
check('zh-Hant title is Traditional', dicts['zh-Hant'].title.includes('網頁搜尋'), `(got ${dicts['zh-Hant'].title})`);
check('zh-Hant save is Traditional', dicts['zh-Hant'].save === '儲存', `(got ${dicts['zh-Hant'].save})`);
check('the two Chinese packs actually differ', JSON.stringify(dicts.zh) !== JSON.stringify(dicts['zh-Hant']));

console.log('5. the language pack');
check('exactly one pack added', languages.length === 1, `(got ${languages.length})`);
check('it is the Traditional pack', languages[0]?.id === 'zh-Hant', `(got ${languages[0]?.id})`);
check('it falls back to the built-in zh', languages[0]?.fallback === 'zh', `(got ${languages[0]?.fallback})`);
check('it carries a non-empty label', typeof languages[0]?.label === 'string' && languages[0].label.trim().length > 0, `(got ${JSON.stringify(languages[0]?.label)})`);
// A region tag would exact-match a `zh-TW` browser and pull it off the Simplified
// default; the script tag deliberately leaves that browser on the `zh` primary
// subtag. This is a decision, so it gets a test.
check('no region tag is registered', !languages.some((pack) => /^zh-[A-Za-z]{2}$/u.test(pack.id)), `(got ${JSON.stringify(languages.map((pack) => pack.id))})`);
check('no dictionary is registered for a region tag', dicts['zh-TW'] === undefined);

console.log('6. the card renders in the language it is set to');
/** Every node in a rendered tree carrying one className. */
function nodesWithClass(node, className, out = []) {
	if (Array.isArray(node)) {
		for (const child of node) nodesWithClass(child, className, out);
		return out;
	}
	if (node === null || typeof node !== 'object') return out;
	if (node.props?.className === className) out.push(node);
	nodesWithClass(node.props?.children, className, out);
	return out;
}
/** Flatten a rendered node to its text. */
function textOf(node) {
	if (typeof node === 'string') return node;
	if (Array.isArray(node)) return node.map(textOf).join('');
	if (node !== null && typeof node === 'object') return textOf(node.props?.children);
	return '';
}
const Card = slots[0][1];
/** Render the card with `language` set and return its title text. */
const titleFor = (language) => {
	snapshot = { status: 'ready', value: { language }, base: {}, user: {}, revision: 1 };
	return textOf(nodesWithClass(Card({ t: (key) => `shell:${key}` }), 'tk_name')[0]);
};
check('`auto` defers to the shell', titleFor('auto') === 'shell:title', `(got ${titleFor('auto')})`);
check('an unset field behaves as `auto`', titleFor(undefined) === 'shell:title', `(got ${titleFor(undefined)})`);
check('`zh` renders Simplified', titleFor('zh') === 'Tavily 网页搜索（免密钥优先）', `(got ${titleFor('zh')})`);
check('`zh-Hant` renders Traditional', titleFor('zh-Hant') === 'Tavily 網頁搜尋（免金鑰優先）', `(got ${titleFor('zh-Hant')})`);
check('`en` renders English', titleFor('en') === 'Tavily web search (keyless first)', `(got ${titleFor('en')})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
