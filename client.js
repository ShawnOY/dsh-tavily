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
	id: 'dsh-tavily-keyless',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		const react = require('react');
		const { jsx, jsxs } = require('react/jsx-runtime');

		/** Must match the namespace the Node half registers. */
		const NAMESPACE = 'web-search-tavily-keyless';
		const MODES = ['keyless-first', 'key-first', 'keyless-only', 'key-only'];

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
		 * @param scope - the bound `web-search-tavily-keyless` settings scope.
		 * @returns the React component the slot renders.
		 */
		function createCard(scope) {
			return function TavilyKeylessCard(props) {
				const { t } = props;
				const copy = (key, fallback) => (t ? t(key) : fallback);
				const [snapshot, setSnapshot] = react.useState(() => scope.getSnapshot());
				const [edits, setEdits] = react.useState({});
				const [open, setOpen] = react.useState(false);
				const [saving, setSaving] = react.useState(false);
				const [failed, setFailed] = react.useState(false);

				react.useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), []);

				const title = jsx('span', { className: 'tk_name', children: copy('title', 'Tavily web search (keyless first)') });
				if (snapshot.status !== 'ready') {
					return jsx('li', {
						className: 'tk_card',
						children: jsx('div', {
							className: 'tk_head',
							children: jsxs('span', {
								className: 'tk_text',
								children: [title, jsx('span', { className: 'tk_desc', children: copy('unavailable', 'This deployment does not serve this configuration.') })]
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
								children: [title, jsx('span', { className: 'tk_desc', children: copy('description', 'Search through Tavily. Works with no API key; the key is used only once the keyless tier refuses.') })]
							})
						}),
						open
							? jsxs('div', {
									className: 'tk_body',
									children: [
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
												jsx('p', { className: 'tk_hint', children: copy('modeHint', 'keyless-first tries Tavily keyless and falls back to your key when that tier refuses.') })
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
												jsx('p', { className: 'tk_hint', children: copy('cooldownHint', 'How long a refused keyless tier is skipped. 0 disables the cooldown.') })
											]
										}),
										jsxs('div', {
											className: 'tk_footer',
											children: [
												dirty ? jsx('span', { className: 'tk_pending', children: copy('unsaved', 'Unsaved') }) : null,
												failed ? jsx('span', { className: 'tk_failed', children: copy('saveFailed', 'Save failed') }) : null,
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
			description: 'Search through Tavily. Works with no API key; the key is used only once the keyless tier refuses.',
			mode: 'Credential mode',
			'mode.keyless-first': 'Keyless first, then the key',
			'mode.key-first': 'Key first',
			'mode.keyless-only': 'Keyless only',
			'mode.key-only': 'Key only',
			modeHint: 'keyless-first tries Tavily keyless and falls back to your key when that tier refuses.',
			cooldown: 'Keyless cooldown (minutes)',
			cooldownHint: 'How long a refused keyless tier is skipped. 0 disables the cooldown.',
			unsaved: 'Unsaved',
			saveFailed: 'Save failed',
			save: 'Save',
			saving: 'Saving…',
			discard: 'Discard',
			unavailable: 'This deployment does not serve this configuration.'
		};
		/**
		 * Simplified Chinese. This is the harness's own `zh`, so the card matches the
		 * shell around it rather than being the odd one out.
		 */
		const zh = {
			title: 'Tavily 网页搜索（keyless 优先）',
			description: '通过 Tavily 搜索。没有 API key 也能用；只有在 keyless 被拒时才会动用你的 key。',
			mode: '凭证模式',
			'mode.keyless-first': 'keyless 优先，被拒后改用 key',
			'mode.key-first': 'key 优先',
			'mode.keyless-only': '只用 keyless',
			'mode.key-only': '只用 key',
			modeHint: 'keyless 优先会先走 Tavily 免 key 层，被拒时才退回你的 key。',
			cooldown: 'keyless 冷却（分钟）',
			cooldownHint: 'keyless 被拒后跳过多久。设 0 等于关闭冷却。',
			unsaved: '尚未保存',
			saveFailed: '保存失败',
			save: '保存',
			saving: '保存中…',
			discard: '放弃修改',
			unavailable: '这个部署没有提供此设置。'
		};
		/** Traditional Chinese, offered as its own language pack rather than folded into `zh`. */
		const zhHant = {
			title: 'Tavily 網頁搜尋（keyless 優先）',
			description: '透過 Tavily 搜尋。沒有 API key 也能用；只有在 keyless 被拒時才會動用你的 key。',
			mode: '憑證模式',
			'mode.keyless-first': 'keyless 優先，被拒後改用 key',
			'mode.key-first': 'key 優先',
			'mode.keyless-only': '只用 keyless',
			'mode.key-only': '只用 key',
			modeHint: 'keyless 優先會先走 Tavily 免 key 層，被拒時才退回你的 key。',
			cooldown: 'keyless 冷卻（分鐘）',
			cooldownHint: 'keyless 被拒後跳過多久。設 0 等於關閉冷卻。',
			unsaved: '尚未儲存',
			saveFailed: '儲存失敗',
			save: '儲存',
			saving: '儲存中…',
			discard: '放棄修改',
			unavailable: '這個部署沒有提供此設定。'
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

		/** Client-side services this card needs before it can register. */
		const inject = ['slots', 'locale', 'settingsScope'];

		function apply(ctx) {
			ctx.effect(() => injectCss(), 'tavily-keyless card css');
			ctx.effect(() => ctx.locale.register(NAMESPACE, { en, zh, 'zh-Hant': zhHant }), 'tavily-keyless locale');
			ctx.effect(() => ctx.locale.addLanguage(TRADITIONAL_PACK), 'tavily-keyless language pack');
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
