/**
 * Browser half: the card this plugin contributes to Settings → Plugins →
 * Plugin configuration.
 *
 * Registering a settings namespace on the Host is not enough to appear in that
 * page. The tab renders the intersection of two ledgers — the namespaces the
 * Host serves and the cards registered into `settings.plugin.item` — so a
 * namespace no card claims renders nothing. This file is that claim.
 *
 * It is a prebuilt browser bundle in the shape the client module system serves:
 * a `__ModuleLoader__.load` factory that receives the host's `require` and
 * exports `apply` plus the client-side `inject` list. There is no build step;
 * the file is served as written.
 *
 * Edits go through `ctx.settingsScope.bind({ namespace })`, the same service the
 * shipped cards use, so a save lands in the settings document with the same
 * revision/recovery semantics as any built-in preference.
 *
 * The card is trilingual: `zh` (Simplified, the harness's own Chinese), `zh-Hant`
 * (Traditional) and `en`. The two Chinese packs are separate catalog entries
 * rather than one, because the harness treats bare `zh` as Simplified and a
 * reader of either script should be able to say so in Settings → General →
 * Language. The Host half reads that same preference back to localize the
 * notices it writes into a transcript, so the two halves stay in one language.
 */
window.__ModuleLoader__.load({
	id: '@0x427567/dsh-tavily',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		const react = require('react');
		const { jsx, jsxs } = require('react/jsx-runtime');

		/** Must match the namespace the Node half registers. */
		const NAMESPACE = 'dsh-tavily';
		const MODES = ['keyless-first', 'key-first', 'keyless-only', 'key-only'];
		const PROVIDERS = ['tavily', 'deepseek-official'];
		/** `language` value that defers to the harness-wide preference. */
		const LANGUAGE_AUTO = 'auto';

		const CSS = [
			'.tk_card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3)}',
			'.tk_head{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}',
			'.tk_head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
			'.tk_text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
			'.tk_name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}',
			'.tk_desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
			'.tk_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}',
			'.tk_field{display:flex;flex-direction:column;gap:6px;padding:12px 0}',
			'.tk_field+.tk_field{border-top:1px solid var(--dsw-alias-border-l2)}',
			'.tk_label{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}',
			'.tk_hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
			'.tk_input,.tk_select{height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}',
			'.tk_input:focus-visible,.tk_select:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}',
			'.tk_input:disabled,.tk_select:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
			'.tk_footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l2)}',
			'.tk_pending{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
			'.tk_failed{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error)}',
			'.tk_btn{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}',
			'.tk_btn:disabled{opacity:.4;cursor:default}',
			'.tk_discard{border-color:var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-primary)}',
			'.tk_save{margin-left:auto;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}'
		].join('');

		/** Install the card stylesheet once, and replace any stale copy on reload. */
		function injectCss() {
			if (typeof document === 'undefined') return () => {};
			const previous = document.querySelector('style[data-tavily-keyless-css]');
			if (previous !== null) previous.remove();
			const tag = document.createElement('style');
			tag.setAttribute('data-tavily-keyless-css', '1');
			tag.textContent = CSS;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}

		/**
		 * Build the card component bound to one settings scope.
		 * @param scope - the bound `dsh-tavily` settings scope.
		 * @returns the React component the slot renders.
		 */
		function createCard(scope) {
			return function TavilyKeylessCard(props) {
				const { t } = props;
				const [snapshot, setSnapshot] = react.useState(() => scope.getSnapshot());
				const [edits, setEdits] = react.useState({});
				const [open, setOpen] = react.useState(false);
				const [saving, setSaving] = react.useState(false);
				const [failed, setFailed] = react.useState(false);

				react.useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), []);

				// `auto` follows the harness-wide language through the shell's `t`; any
				// other value renders this card — and the notices the Host writes — from
				// the pack the reader picked, independently of the rest of the UI.
				const chosen = snapshot.value !== undefined && typeof snapshot.value.language === 'string' ? snapshot.value.language : LANGUAGE_AUTO;
				const dict = chosen === LANGUAGE_AUTO ? undefined : DICTS[chosen];
				const copy =
					dict === undefined ? (key, fallback) => (t ? t(key) : fallback) : (key, fallback) => (typeof dict[key] === 'string' ? dict[key] : fallback);

				const title = jsx('span', { className: 'tk_name', children: copy('title', 'Tavily web search (keyless first)') });
				if (snapshot.status !== 'ready') {
					return jsx('li', {
						className: 'tk_card',
						children: jsx('div', {
							className: 'tk_head',
							children: jsxs('span', {
								className: 'tk_text',
								children: [title, jsx('span', { className: 'tk_desc', children: copy('unavailable', 'This deployment does not expose these settings.') })]
							})
						})
					});
				}

				// Only the user's own changes are held locally; everything else is read
				// from the scope, so a save or an external edit re-syncs for free.
				const value = { ...snapshot.value, ...edits };
				const base = snapshot.base !== undefined && snapshot.base !== null ? snapshot.base : {};
				const dirty = Object.keys(edits).length > 0;
				const blocked = !dirty || saving;

				const change = (field, next) => {
					setFailed(false);
					setEdits((previous) => {
						const merged = { ...previous };
						if (next === snapshot.value[field]) delete merged[field];
						else merged[field] = next;
						return merged;
					});
				};

				const save = async () => {
					setSaving(true);
					setFailed(false);
					try {
						for (const field of Object.keys(edits)) {
							// Matching the composition entry means "no override", which is an
							// unset — that keeps a reset returning to the profile's value.
							if (edits[field] === base[field]) await scope.unset(field);
							else await scope.set(field, edits[field]);
						}
						setEdits({});
					} catch (_writeFailed) {
						setFailed(true);
					} finally {
						setSaving(false);
					}
				};

				return jsxs('li', {
					className: 'tk_card',
					children: [
						jsx('button', {
							type: 'button',
							className: 'tk_head',
							'aria-expanded': open,
							onClick: () => setOpen(!open),
							children: jsxs('span', {
								className: 'tk_text',
								children: [title, jsx('span', { className: 'tk_desc', children: copy('description', 'Search the web through Tavily. Works with no API key — your key is used only when the keyless tier refuses.') })]
							})
						}),
						open
							? jsxs('div', {
									className: 'tk_body',
									children: [
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
										jsxs('div', {
											className: 'tk_field',
											children: [
												jsx('label', { className: 'tk_label', children: copy('language', 'Language') }),
												jsx('select', {
													className: 'tk_select',
													value: chosen,
													disabled: saving,
													onChange: (event) => change('language', event.target.value),
													children: LANGUAGE_OPTIONS.map((option) =>
														jsx(
															'option',
															{ value: option.value, children: option.native === undefined ? copy('language.auto', 'Follow the harness language') : option.native },
															option.value
														)
													)
												}),
												jsx('p', { className: 'tk_hint', children: copy('languageHint', 'Applies to this card and to the notices this plugin adds to the conversation.') })
											]
										}),
										jsxs('div', {
											className: 'tk_field',
											children: [
												jsx('label', { className: 'tk_label', children: copy('mode', 'Credential mode') }),
												jsx('select', {
													className: 'tk_select',
													value: value.mode,
													disabled: saving,
													onChange: (event) => change('mode', event.target.value),
													children: MODES.map((mode) => jsx('option', { value: mode, children: copy('mode.' + mode, mode) }, mode))
												}),
												jsx('p', { className: 'tk_hint', children: copy('modeHint', 'Keyless first tries Tavily without a key, then falls back to yours. The “only” modes never switch.') })
											]
										}),
										jsxs('div', {
											className: 'tk_field',
											children: [
												jsx('label', { className: 'tk_label', children: copy('cooldown', 'Keyless cooldown (minutes)') }),
												jsx('input', {
													className: 'tk_input',
													type: 'number',
													min: 0,
													step: 1,
													value: value.keylessCooldownMinutes === undefined ? '' : String(value.keylessCooldownMinutes),
													disabled: saving,
													onChange: (event) => {
														const parsed = Number(event.target.value);
														change('keylessCooldownMinutes', Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
													}
												}),
												jsx('p', { className: 'tk_hint', children: copy('cooldownHint', 'How long to skip the keyless tier after it refuses a request. 0 turns the cooldown off.') })
											]
										}),
										jsxs('div', {
											className: 'tk_footer',
											children: [
												dirty ? jsx('span', { className: 'tk_pending', children: copy('unsaved', 'Unsaved') }) : null,
												failed ? jsx('span', { className: 'tk_failed', children: copy('saveFailed', 'Save failed; your edits are kept.') }) : null,
												jsx('button', {
													type: 'button',
													className: 'tk_btn tk_discard',
													disabled: blocked,
													onClick: () => {
														setEdits({});
														setFailed(false);
													},
													children: copy('discard', 'Discard')
												}),
												jsx('button', {
													type: 'button',
													className: 'tk_btn tk_save',
													disabled: blocked,
													onClick: save,
													children: saving ? copy('saving', 'Saving…') : copy('save', 'Save')
												})
											]
										})
									]
								})
							: null
					]
				});
			};
		}

		const en = {
			title: 'Tavily web search (keyless first)',
			description: 'Search the web through Tavily. Works with no API key — your key is used only when the keyless tier refuses.',
			provider: 'Search provider',
			'provider.tavily': 'Tavily (this plugin)',
			'provider.deepseek-official': 'DSH built-in (DeepSeek)',
			providerHint: 'Which backend answers web_search. Choosing the built-in one brings back its own Web search card.',
			mode: 'Credential mode',
			'mode.keyless-first': 'Keyless first, key as fallback',
			'mode.key-first': 'Key first',
			'mode.keyless-only': 'Keyless only',
			'mode.key-only': 'Key only',
			modeHint: 'Keyless first tries Tavily without a key, then falls back to yours. The “only” modes never switch.',
			cooldown: 'Keyless cooldown (minutes)',
			cooldownHint: 'How long to skip the keyless tier after it refuses a request. 0 turns the cooldown off.',
			language: 'Language',
			'language.auto': 'Follow the harness language',
			languageHint: 'Applies to this card and to the notices this plugin adds to the conversation.',
			unsaved: 'Unsaved',
			saveFailed: 'Save failed; your edits are kept.',
			save: 'Save',
			saving: 'Saving…',
			discard: 'Discard',
			unavailable: 'This deployment does not expose these settings.'
		};
		/**
		 * Simplified Chinese. This is the harness's own `zh`, so the card matches the
		 * shell around it rather than being the odd one out.
		 */
		const zh = {
			title: 'Tavily 网页搜索（免密钥优先）',
			description: '通过 Tavily 搜索网页。没有密钥也能用；只有在免密钥服务拒绝请求时，才会改用你的密钥。',
			provider: '搜索服务',
			'provider.tavily': 'Tavily（本插件）',
			'provider.deepseek-official': 'DSH 内置（DeepSeek）',
			providerHint: '由哪个后端处理 web_search。选择内置服务时，它自己的「网页搜索」卡片会重新出现。',
			mode: '凭证模式',
			'mode.keyless-first': '免密钥优先，被拒时改用密钥',
			'mode.key-first': '优先使用密钥',
			'mode.keyless-only': '仅使用免密钥',
			'mode.key-only': '仅使用密钥',
			modeHint: '「免密钥优先」会先尝试 Tavily 的免密钥服务，被拒时才改用你的密钥；「仅使用」模式不会切换。',
			cooldown: '免密钥冷却时间（分钟）',
			cooldownHint: '免密钥服务被拒后要跳过多久。设为 0 表示不冷却。',
			language: '语言',
			'language.auto': '与 Harness 界面语言一致',
			languageHint: '适用于这张卡片，以及本插件在对话中显示的提示。',
			unsaved: '尚未保存',
			saveFailed: '保存失败，已保留你的修改。',
			save: '保存',
			saving: '保存中…',
			discard: '放弃修改',
			unavailable: '这个部署没有开放这些设置。'
		};
		/** Traditional Chinese, offered as its own language pack rather than folded into `zh`. */
		const zhHant = {
			title: 'Tavily 網頁搜尋（免金鑰優先）',
			description: '透過 Tavily 搜尋網頁。沒有金鑰也能用；只有在免金鑰服務拒絕請求時，才會改用你的金鑰。',
			provider: '搜尋服務',
			'provider.tavily': 'Tavily（本外掛）',
			'provider.deepseek-official': 'DSH 內建（DeepSeek）',
			providerHint: '由哪個後端處理 web_search。選擇內建服務時，它自己的「網頁搜尋」卡片會重新出現。',
			mode: '憑證模式',
			'mode.keyless-first': '免金鑰優先，被拒時改用金鑰',
			'mode.key-first': '優先使用金鑰',
			'mode.keyless-only': '僅使用免金鑰',
			'mode.key-only': '僅使用金鑰',
			modeHint: '「免金鑰優先」會先嘗試 Tavily 的免金鑰服務，被拒時才改用你的金鑰；「僅使用」模式不會切換。',
			cooldown: '免金鑰冷卻時間（分鐘）',
			cooldownHint: '免金鑰服務被拒後要跳過多久。設為 0 表示不冷卻。',
			language: '語言',
			'language.auto': '與 Harness 介面語言一致',
			languageHint: '適用於這張卡片，以及本外掛在對話中顯示的提示。',
			unsaved: '尚未儲存',
			saveFailed: '儲存失敗，已保留你的修改。',
			save: '儲存',
			saving: '儲存中…',
			discard: '放棄修改',
			unavailable: '這個部署沒有開放這些設定。'
		};

		/**
		 * The language pack this card adds to the harness catalog. `zh` and `en` are
		 * built in; this is ours.
		 *
		 * It is a pack rather than a variant of `zh` because the harness reads bare
		 * `zh` as Simplified. Registering the script tag — and deliberately not a
		 * region tag like `zh-TW` — keeps the default where it belongs: a browser
		 * reporting `zh-TW` or `zh-HK` still matches the `zh` primary subtag and
		 * opens in Simplified, and a Traditional reader opts in by picking 繁體中文.
		 */
		const TRADITIONAL_PACK = { id: 'zh-Hant', label: '繁體中文', fallback: 'zh' };

		/**
		 * The packs this card can render itself in, keyed by its own `language` field.
		 * `auto` is deliberately absent: it means "ask the shell", which is the `t`
		 * path rather than a table lookup.
		 */
		const DICTS = { en, zh, 'zh-Hant': zhHant };
		/**
		 * Options for the card's own language selector. Each language is named in
		 * itself, so a reader can find their own without reading the current one;
		 * `auto` borrows the active pack's wording instead.
		 */
		const LANGUAGE_OPTIONS = [
			{ value: LANGUAGE_AUTO },
			{ value: 'zh', native: '中文' },
			{ value: 'zh-Hant', native: '繁體中文' },
			{ value: 'en', native: 'English' }
		];

		/** Client-side services this card needs before it can register. */
		const inject = ['slots', 'locale', 'settingsScope'];

		function apply(ctx) {
			ctx.effect(() => injectCss(), 'dsh-tavily card css');
			ctx.effect(() => ctx.locale.register(NAMESPACE, { en, zh, 'zh-Hant': zhHant }), 'dsh-tavily locale');
			ctx.effect(() => ctx.locale.addLanguage(TRADITIONAL_PACK), 'dsh-tavily language pack');
			const scope = ctx.settingsScope.bind({ namespace: NAMESPACE });
			ctx.slots.inject('settings.plugin.item', () =>
				ctx.slots.register(
					{
						name: 'settings.plugin.item',
						key: NAMESPACE,
						locale: NAMESPACE
					},
					createCard(scope)
				)
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
