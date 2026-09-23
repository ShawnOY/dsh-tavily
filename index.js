/**
 * Tavily-backed search provider for the DeepSeek Harness web capability seam
 * (`ctx.web`): registers the provider id `tavily`, which a composition selects
 * with `searchProvider: tavily` on the `@deepseek-ai/dsh-web` row.
 *
 * Tavily answers `/search` with the result list itself (title, url, content,
 * optional published date), so one search is one HTTP request: no auxiliary
 * model turn, and no scraping results out of provider prose.
 *
 * Credential use is governed by `mode`. The default `keyless-first` sends
 * `x-tavily-access-mode: keyless` and no `authorization` header, reaching for
 * the stored key only once the keyless tier refuses the call — at which point
 * that tier is cooled down and the fallback is reported in the result rather
 * than happening silently. `key-first` inverts that, `keyless-only` never sends
 * the key, and `key-only` requires one.
 *
 * `mode` and the cooldown are also registered as a settings section, so they can
 * be changed from Settings → Plugins without editing the profile.
 *
 * Everything this module writes into a transcript — the fallback notice, the
 * cooldown warning, and its own error messages — is localized through
 * {@link MESSAGES}, following the harness locale preference the browser half of
 * `@deepseek-ai/dsh-client-locale` stores in the settings document. Simplified
 * Chinese (`zh`) and English are the languages the harness itself ships;
 * Traditional Chinese (`zh-Hant`) is a pack this package adds. The Host cannot
 * see the browser's own languages, so an unset or unshipped preference falls back
 * to {@link DEFAULT_NOTICE_LOCALE}.
 *
 * @module @0x427567/dsh-tavily
 */
import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { WebError } from '@deepseek-ai/dsh-web';

/** Cordis plugin name used by loader diagnostics. */
const name = 'web-search-tavily';
/** The web seam this provider registers into. */
const inject = ['web'];
/** Stable id this provider registers under. */
const TAVILY_PROVIDER_ID = 'tavily';
/** Credential reference resolved per search. */
const DEFAULT_API_KEY_ENV = 'TAVILY_API_KEY';
/** Tavily's public API base; `/search` is appended. */
const DEFAULT_BASE_URL = 'https://api.tavily.com';
/** `basic` costs one credit per search; `advanced` costs more for richer snippets. */
const DEFAULT_SEARCH_DEPTH = 'basic';
/** Result bound applied when the caller sets none. */
const DEFAULT_MAX_RESULTS = 5;
/** Try the keyless tier first; fall back to the key when that tier refuses. */
const MODE_KEYLESS_FIRST = 'keyless-first';
/** Use the key whenever one resolves; keyless only when none does. */
const MODE_KEY_FIRST = 'key-first';
/** Never send the key. */
const MODE_KEYLESS_ONLY = 'keyless-only';
/** Require a key; never use the keyless tier. */
const MODE_KEY_ONLY = 'key-only';
/** Settings namespace this plugin registers its configuration under. */
const SETTINGS_NAMESPACE = 'dsh-tavily';
/** Minutes a refused keyless tier is skipped before it is tried again. */
const DEFAULT_KEYLESS_COOLDOWN_MINUTES = 10;
/** Attribution header sent on every request, matching the harness's own identity. */
const USER_AGENT = 'deepseek-harness/0.0.1';
/** Settings namespace owned by the harness locale plugin; read here, never written. */
const LOCALE_SETTINGS_NAMESPACE = 'locale';
/** Field in that namespace carrying the explicit language preference. */
const LOCALE_PREFERENCE_FIELD = 'preference';
/** Language the copy falls back to when no preference resolves. */
const DEFAULT_NOTICE_LOCALE = 'zh';
/** Languages this package writes its Host-side copy in. */
const NOTICE_LOCALES = ['zh', 'zh-Hant', 'en'];
/** `language` value that defers to the harness-wide preference. */
const LANGUAGE_AUTO = 'auto';
/** Values the per-plugin `language` field accepts. */
const LANGUAGE_VALUES = [LANGUAGE_AUTO, ...NOTICE_LOCALES];

/**
 * Host-side copy, keyed by language.
 *
 * The search notice and the cooldown warning are the strings a user reads in the
 * tool output; the diagnostics are translated too, so an error surfaced in the
 * same transcript does not switch languages halfway through a session.
 *
 * `zh` is Simplified — the harness's own Chinese — and `zh-Hant` is Traditional,
 * a separate pack rather than a variant of the same one. `en` is last because
 * every other chain ends there.
 *
 * Entries are functions where a value is interpolated, so a translation can put
 * the placeholder where its own grammar wants it instead of inheriting English
 * word order.
 */
const MESSAGES = {
	zh: {
		aborted: () => 'Tavily 搜索已取消。',
		requestFailed: (endpoint, error) => `Tavily 搜索请求 ${JSON.stringify(endpoint)} 失败：${String(error)}`,
		httpFailed: (status, detail, endpoint) => `Tavily 搜索失败（HTTP ${status}）${detail === undefined ? '' : `：${detail}`}（端点 ${JSON.stringify(endpoint)}）`,
		unprocessableBody: (error) => `Tavily 返回的响应内容无法解析：${String(error)}`,
		noResultSet: (detail) => `Tavily 没有返回结果集${detail}`,
		missingApiKey: (apiKeyEnv, mode) => `模式 "${mode}" 需要密钥，但凭据 "${apiKeyEnv}" 没有解析到值。请在 ~/.dsh/.credentials.yaml 的 refs 中提供，或在启动 Harness 的环境变量里设置，也可以在「Tavily 网页搜索」设置中直接填入 "apiKey"。`,
		credentialFailed: (error) => `Tavily 搜索凭据解析失败：${String(error)}`,
		cooldownLog: (reason, minutes) => `Tavily 免密钥服务拒绝了请求（${reason}）；接下来 ${minutes} 分钟改用密钥。`,
		refusalNotice: (minutes) => `⚠️ Tavily 免密钥额度已用尽，这次改用密钥；接下来约 ${minutes} 分钟内直接使用密钥。`,
		cooldownNotice: (minutes) => `⚠️ Tavily 免密钥服务冷却中（约剩 ${minutes} 分钟），这次使用密钥。`
	},
	'zh-Hant': {
		aborted: () => 'Tavily 搜尋已取消。',
		requestFailed: (endpoint, error) => `Tavily 搜尋請求 ${JSON.stringify(endpoint)} 失敗：${String(error)}`,
		httpFailed: (status, detail, endpoint) => `Tavily 搜尋失敗（HTTP ${status}）${detail === undefined ? '' : `：${detail}`}（端點 ${JSON.stringify(endpoint)}）`,
		unprocessableBody: (error) => `Tavily 回傳的內容無法解析：${String(error)}`,
		noResultSet: (detail) => `Tavily 沒有回傳結果集${detail}`,
		missingApiKey: (apiKeyEnv, mode) => `模式 "${mode}" 需要金鑰，但憑證 "${apiKeyEnv}" 沒有解析到值。請寫入 ~/.dsh/.credentials.yaml 的 refs、在啟動 Harness 的環境變數中提供，或在「Tavily 網頁搜尋」設定中直接填入 "apiKey"。`,
		credentialFailed: (error) => `Tavily 搜尋憑證解析失敗：${String(error)}`,
		cooldownLog: (reason, minutes) => `Tavily 免金鑰服務拒絕了請求（${reason}）；接下來 ${minutes} 分鐘改用金鑰。`,
		refusalNotice: (minutes) => `⚠️ Tavily 免金鑰額度已用盡，這次改用金鑰；接下來約 ${minutes} 分鐘內直接使用金鑰。`,
		cooldownNotice: (minutes) => `⚠️ Tavily 免金鑰服務冷卻中（約剩 ${minutes} 分鐘），這次使用金鑰。`
	},
	en: {
		aborted: () => 'Tavily search aborted.',
		requestFailed: (endpoint, error) => `Tavily search request to ${JSON.stringify(endpoint)} failed: ${String(error)}`,
		httpFailed: (status, detail, endpoint) => `Tavily search failed with HTTP ${status}${detail === undefined ? '' : `: ${detail}`} (endpoint ${JSON.stringify(endpoint)})`,
		unprocessableBody: (error) => `Tavily returned a response we could not parse: ${String(error)}`,
		noResultSet: (detail) => `Tavily returned no result set${detail}`,
		missingApiKey: (apiKeyEnv, mode) => `Mode "${mode}" needs an API key, but the credential "${apiKeyEnv}" resolved to nothing; add it to ~/.dsh/.credentials.yaml under refs, export it in the environment that launched the harness, or set a literal "apiKey" in the "Tavily web search" settings`,
		credentialFailed: (error) => `Tavily search credential resolution failed: ${String(error)}`,
		cooldownLog: (reason, minutes) => `Tavily keyless tier refused (${reason}); using the API key for the next ${minutes} minute(s).`,
		refusalNotice: (minutes) => `⚠️ Tavily's keyless quota is exhausted, so this search used the API key; the next ~${minutes} minute(s) go straight to the API key.`,
		cooldownNotice: (minutes) => `⚠️ Tavily keyless is cooling down (~${minutes} minute(s) left); this search used the API key.`
	}
};

const Config = z.object({
	apiKey: z.string().role('secret'),
	apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
	baseURL: z.string().default(DEFAULT_BASE_URL),
	searchDepth: z.string().default(DEFAULT_SEARCH_DEPTH),
	maxResults: z.number().step(1).min(1).default(DEFAULT_MAX_RESULTS),
	includeAnswer: z.boolean().default(false),
	mode: z.union([MODE_KEYLESS_FIRST, MODE_KEY_FIRST, MODE_KEYLESS_ONLY, MODE_KEY_ONLY]).default(MODE_KEYLESS_FIRST),
	keylessCooldownMinutes: z.number().step(1).min(0).default(DEFAULT_KEYLESS_COOLDOWN_MINUTES),
	language: z.union(LANGUAGE_VALUES).default(LANGUAGE_AUTO)
});

/**
 * Map a locale preference onto the copy table that serves it, mirroring the
 * client's own lookup: an exact id wins, and the primary subtag is the last
 * resort before {@link DEFAULT_NOTICE_LOCALE}.
 *
 * @param preference - the raw `locale.preference` value, if any.
 * @returns a key of {@link MESSAGES}.
 */
function resolveNoticeLocale(preference) {
	if (typeof preference !== 'string' || preference.length === 0) return DEFAULT_NOTICE_LOCALE;
	const tag = preference.toLowerCase();
	const exact = NOTICE_LOCALES.find((locale) => locale.toLowerCase() === tag);
	if (exact !== undefined) return exact;
	// `zh-Hant` and `zh` share the primary subtag `zh`, so an unshipped `zh-*`
	// tag — `zh-TW`, `zh-HK`, a bare `zh-CN` — reaches the Simplified table,
	// which is what the client does with the same tag.
	const primary = tag.split('-')[0];
	return NOTICE_LOCALES.find((locale) => locale.toLowerCase() === primary) ?? DEFAULT_NOTICE_LOCALE;
}

/**
 * The language this Host's copy is written in: the per-plugin `language` field
 * when it names one, otherwise the harness locale preference when it names a
 * language this package ships, otherwise {@link DEFAULT_NOTICE_LOCALE}.
 *
 * That preference is the only locale signal a Host plugin can read — the
 * browser's own languages never leave the client. It is read per search, so a
 * language switch in Settings applies to the next one. An unknown tag (say
 * `ja`, which the client does not ship either) falls back rather than failing.
 *
 * @param ctx - plugin context whose optional settings service owns the document.
 * @param choice - the per-plugin `language` value; `auto` defers to the harness.
 * @returns a key of {@link MESSAGES}.
 */
function activeLocale(ctx, choice) {
	// A per-plugin choice is deliberate, so it wins over the harness-wide one.
	if (typeof choice === 'string' && choice !== LANGUAGE_AUTO) return resolveNoticeLocale(choice);
	let preference;
	try {
		preference = ctx.get?.('settings')?.get?.(LOCALE_SETTINGS_NAMESPACE)?.[LOCALE_PREFERENCE_FIELD];
	} catch {
		return DEFAULT_NOTICE_LOCALE;
	}
	return resolveNoticeLocale(preference);
}

/** The copy table for one operation's snapshot. */
function messages(options) {
	return MESSAGES[options.locale] ?? MESSAGES[DEFAULT_NOTICE_LOCALE];
}

/** Project one resolved config section into the options one search uses. */
function resolveOptions(ctx, config) {
	const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
	const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0 ? config.apiKey : undefined;
	return {
		...(literalApiKey === undefined ? {} : { apiKey: literalApiKey }),
		resolveApiKey: async () => {
			const credentials = ctx.get('credentials');
			if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value;
			const ambient = process.env[apiKeyEnv];
			return ambient !== undefined && ambient.length > 0 ? ambient : undefined;
		},
		apiKeyEnv,
		baseURL: config.baseURL ?? DEFAULT_BASE_URL,
		searchDepth: config.searchDepth ?? DEFAULT_SEARCH_DEPTH,
		maxResults: config.maxResults ?? DEFAULT_MAX_RESULTS,
		includeAnswer: config.includeAnswer ?? false,
		mode: config.mode ?? MODE_KEYLESS_FIRST,
		keylessCooldownMinutes: config.keylessCooldownMinutes ?? DEFAULT_KEYLESS_COOLDOWN_MINUTES,
		locale: activeLocale(ctx, config.language),
		ctx
	};
}

/** Tavily's `published_date` is RFC-1123; the seam wants an ISO-8601 string. */
function toIsoTimestamp(value) {
	if (typeof value !== 'string' || value.length === 0) return undefined;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/** Map Tavily's response body onto the seam's search result. */
function mapTavilyResponse(payload, maxResults) {
	const items = Array.isArray(payload?.results) ? payload.results : [];
	const seen = new Set();
	const sources = [];
	for (const item of items) {
		const url = typeof item?.url === 'string' ? item.url : '';
		if (url.length === 0 || seen.has(url)) continue;
		seen.add(url);
		const title = typeof item.title === 'string' && item.title.length > 0 ? item.title : undefined;
		const snippet = typeof item.content === 'string' && item.content.length > 0 ? item.content : undefined;
		const publishedAt = toIsoTimestamp(item.published_date);
		sources.push({
			url,
			...(title === undefined ? {} : { title }),
			...(snippet === undefined ? {} : { snippet }),
			...(publishedAt === undefined ? {} : { publishedAt })
		});
	}
	const answer = typeof payload?.answer === 'string' && payload.answer.length > 0 ? payload.answer : undefined;
	return {
		...(answer === undefined ? {} : { content: answer }),
		sources: sources.slice(0, maxResults),
		truncated: sources.length > maxResults
	};
}

/** Build the seam's cancellation error. */
function searchAborted(options, cause) {
	return new WebError(messages(options).aborted(), 'WEB_ABORTED', cause === undefined ? undefined : { cause });
}

/** Whether a thrown value is a fetch cancellation. */
function isAbortError(error) {
	return error instanceof Error && error.name === 'AbortError';
}

/** Throw the seam's cancellation error when the caller already cancelled. */
function throwIfSearchAborted(signal, options) {
	if (signal?.aborted === true) throw searchAborted(options);
}

/**
 * Race a same-process asynchronous preflight against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become an unhandled.
 */
function abortable(operation, signal, options) {
	if (signal === undefined) return operation;
	if (signal.aborted) return Promise.reject(searchAborted(options));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			reject(searchAborted(options));
		};
		signal.addEventListener('abort', onAbort, { once: true });
		operation.then(
			(value) => {
				signal.removeEventListener('abort', onAbort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener('abort', onAbort);
				reject(error);
			}
		);
	});
}

/** The `/search` endpoint for one base URL. */
function endpointOf(baseURL) {
	return `${baseURL.replace(/\/+$/, '')}/search`;
}

/** Best-effort error-body text for an HTTP failure; never throws. */
async function readFailureDetail(response) {
	try {
		const text = (await response.text()).trim();
		return text.length === 0 ? undefined : text.slice(0, 500);
	} catch {
		return undefined;
	}
}

/** Whole minutes a cooldown spans, never rounding down to zero. */
function cooldownMinutes(ms) {
	return Math.max(1, Math.round(ms / 60000));
}

/** The seam's error for a mode that requires a key when none resolved. */
function missingApiKey(options) {
	return new WebError(messages(options).missingApiKey(options.apiKeyEnv ?? DEFAULT_API_KEY_ENV, options.mode), 'WEB_PROVIDER_CREDENTIAL_MISSING');
}

/** Best-effort prose from a payload with no result set; a keyless cap explains itself. */
function describeRefusal(payload) {
	for (const candidate of [payload?.detail, payload?.error, payload?.message, payload?.content]) {
		if (typeof candidate === 'string' && candidate.length > 0) return `: ${candidate.slice(0, 300)}`;
		if (candidate !== undefined && candidate !== null) {
			try {
				return `: ${JSON.stringify(candidate).slice(0, 300)}`;
			} catch {
				// Not serializable; try the next candidate.
			}
		}
	}
	return '';
}

/** The Tavily-backed search provider. */
class TavilySearchProvider {
	resolveOptions;
	id = TAVILY_PROVIDER_ID;
	/** Epoch ms until which a refused keyless tier is skipped. In-memory only. */
	keylessRefusedUntil = 0;

	/**
	 * @param resolveOptions_ - thunk returning the options for the NEXT search,
	 * snapshotted once at each operation's entry so one search never mixes two
	 * configuration sections.
	 */
	constructor(resolveOptions_) {
		this.resolveOptions = resolveOptions_;
	}

	available() {
		const options = this.resolveOptions();
		return (options.apiKey !== undefined || options.resolveApiKey !== undefined) && URL.canParse(options.baseURL);
	}

	/**
	 * Plan the credential modes this search tries, in order. An empty plan means
	 * the configured mode cannot run at all (a key-requiring mode with no key).
	 * @param options - the operation's snapshot.
	 * @param apiKey - the resolved key, or `undefined` when none resolved.
	 * @returns the ordered steps; each `reason` decides the notice it earns.
	 */
	plan(options, apiKey) {
		const hasKey = apiKey !== undefined;
		if (options.mode === MODE_KEY_ONLY) return hasKey ? [{ mode: 'key', reason: 'required' }] : [];
		if (options.mode === MODE_KEYLESS_ONLY) return [{ mode: 'keyless', reason: 'only' }];
		if (options.mode === MODE_KEY_FIRST) return hasKey ? [{ mode: 'key', reason: 'preferred' }] : [{ mode: 'keyless', reason: 'only' }];
		if (!hasKey) return [{ mode: 'keyless', reason: 'only' }];
		if (Date.now() < this.keylessRefusedUntil) return [{ mode: 'key', reason: 'cooldown' }];
		return [{ mode: 'keyless', reason: 'default' }, { mode: 'key', reason: 'refusal' }];
	}

	async search(request, signal) {
		const options = this.resolveOptions();
		const apiKey = await this.apiKey(options, signal);
		const plan = this.plan(options, apiKey);
		if (plan.length === 0) throw missingApiKey(options);
		let lastError;
		for (const step of plan) {
			const outcome = await this.attempt(options, request, signal, step.mode === 'key' ? apiKey : undefined);
			if (outcome.ok) return this.annotate(outcome.result, options, step);
			// A refused keyless tier is not fatal while a key is available: cool the
			// tier down and let the next step retry with the key.
			if (step.mode === 'keyless' && outcome.refused && plan.some((candidate) => candidate.mode === 'key')) {
				this.enterKeylessCooldown(options, outcome.error);
				lastError = outcome.error;
				continue;
			}
			throw outcome.error;
		}
		throw lastError;
	}

	/**
	 * Perform one request under one credential mode.
	 * @param options - the operation's snapshot.
	 * @param request - the seam's search request.
	 * @param signal - abort signal for the surrounding search.
	 * @param apiKey - the key to send, or `undefined` to send the keyless header.
	 * @returns the result, or a failure naming whether the tier refused the call.
	 */
	async attempt(options, request, signal, apiKey) {
		throwIfSearchAborted(signal, options);
		const endpoint = endpointOf(options.baseURL);
		const requested = Number.isInteger(request.maxResults) && request.maxResults > 0 ? request.maxResults : options.maxResults;
		let response;
		try {
			response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					...(apiKey === undefined ? { 'x-tavily-access-mode': 'keyless' } : { authorization: `Bearer ${apiKey}` }),
					'content-type': 'application/json',
					accept: 'application/json',
					'user-agent': USER_AGENT
				},
				body: JSON.stringify({
					query: request.query,
					search_depth: options.searchDepth,
					max_results: requested,
					include_answer: options.includeAnswer,
					include_published_date: true
				}),
				redirect: 'error',
				...(signal === undefined ? {} : { signal })
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(options, error);
			throw new WebError(messages(options).requestFailed(endpoint, error), 'WEB_PROVIDER_ERROR', { cause: error });
		}
		if (!response.ok) {
			const detail = await readFailureDetail(response);
			return {
				ok: false,
				refused: response.status === 401 || response.status === 403 || response.status === 429,
				error: new WebError(messages(options).httpFailed(response.status, detail, endpoint), 'WEB_PROVIDER_ERROR')
			};
		}
		let payload;
		try {
			payload = await response.json();
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(options, error);
			throw new WebError(messages(options).unprocessableBody(error), 'WEB_PROVIDER_ERROR', { cause: error });
		}
		// A capped keyless tier answers with prose instructions instead of a result
		// set, so a body without `results` is a refusal too — not "no hits".
		if (!Array.isArray(payload?.results)) {
			return { ok: false, refused: true, error: new WebError(messages(options).noResultSet(describeRefusal(payload)), 'WEB_PROVIDER_ERROR') };
		}
		return { ok: true, result: mapTavilyResponse(payload, requested) };
	}

	/** Start the keyless cooldown and tell the operator why. */
	enterKeylessCooldown(options, error) {
		const minutes = options.keylessCooldownMinutes;
		this.keylessRefusedUntil = Date.now() + minutes * 60000;
		options.ctx?.logger?.warn?.(messages(options).cooldownLog(String(error.message).slice(0, 300), minutes));
	}

	/**
	 * Attach a notice when this search could not use the configured default tier,
	 * so a fallback is visible in the tool output instead of silent. Only a fresh
	 * refusal or an active cooldown earns one.
	 * @param result - the seam's search result.
	 * @param options - the operation's snapshot.
	 * @param step - the plan step that produced the result.
	 * @returns the result, with the notice prepended to its content.
	 */
	annotate(result, options, step) {
		if (step.reason !== 'refusal' && step.reason !== 'cooldown') return result;
		const minutes = cooldownMinutes(Math.max(0, this.keylessRefusedUntil - Date.now()));
		const copy = messages(options);
		const notice = step.reason === 'refusal' ? copy.refusalNotice(minutes) : copy.cooldownNotice(minutes);
		const content = result.content === undefined || result.content.length === 0 ? notice : `${notice}\n\n${result.content}`;
		return { ...result, content };
	}

	/**
	 * Resolve one operation's credential without retaining it on the provider.
	 * @param options - the operation's snapshot, so the key and the endpoint it
	 * is sent to come from one configuration section.
	 * @param signal - abort signal for the surrounding search.
	 * @returns the resolved key, or `undefined` when the request should run keyless.
	 */
	async apiKey(options, signal) {
		throwIfSearchAborted(signal, options);
		if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey;
		let resolved;
		try {
			resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal, options);
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(options, error);
			throw new WebError(messages(options).credentialFailed(error), 'WEB_PROVIDER_ERROR', { cause: error });
		}
		if (resolved !== undefined && resolved.length > 0) return resolved;
		return undefined;
	}
}

/**
 * Register the Tavily search provider with `ctx.web` — and, where a settings
 * provider exists, its configuration section, so `mode` and the cooldown are
 * editable from Settings → Plugins rather than only from the profile patch.
 *
 * The section is installed through a scoped injection rather than a hard
 * dependency, so the provider still mounts in a composition without settings.
 * `current` starts as the composition entry and is swapped for the live settings
 * value, which is why every search resolves its options through it.
 */
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
	ctx.web.registerSearchProvider(new TavilySearchProvider(() => resolveOptions(ctx, current())));
}

export { Config, SETTINGS_NAMESPACE, TAVILY_PROVIDER_ID, TavilySearchProvider, apply, inject, name };
