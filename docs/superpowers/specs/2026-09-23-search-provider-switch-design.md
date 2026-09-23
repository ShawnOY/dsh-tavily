# Search provider switch — design

Status: approved for implementation
Date: 2026-09-23
Package: `@0x427567/dsh-tavily`

## Problem

`web_search` is a model-facing tool (`@deepseek-ai/dsh-tool-web`) that calls
`ctx.web.search()`. The seam (`@deepseek-ai/dsh-web`) owns provider selection and resolves
it from one config field, `searchProvider`.

The bundle already disables the shipped DeepSeek search provider (`web-search-deepseek`,
inserted by `dsh-base`), so a deployment ends up with one search provider and one Plugins
card. That decision is baked into a patch layer and read at boot: changing your mind means
editing a patch file and restarting the harness. There is no way to pick the backend from
the UI.

## Goal

One select in this plugin's settings card chooses which backend serves `web_search`. The
choice takes effect on the next search, needs no restart, and persists across restarts.

## Non-goals

- **Automatic fallback.** Tavily failing does not silently switch to DeepSeek. Manual
  choice is the requirement; the keyless→key fallback *inside* Tavily is unrelated and
  untouched.
- **A single card at all times.** While the shipped provider is the active backend, its own
  "Web search" card is present. That is accepted, and it is the reason this design does not
  re-host the DeepSeek backend inside this package.
- **Making the seam's `searchProvider` runtime-settable.** `dsh-web` reads it in its
  constructor and is not settings-backed. Reloading that row would tear down the seam and
  every plugin that injects it. Rejected.

## Verified constraints

Read out of the installed harness (`@deepseek-ai/dsh` 0.1.5-rc.2), not assumed:

| Fact | Where |
|---|---|
| Provider selection runs per call, not at boot | `dsh-web/lib/index.js` — `resolveProvider()` is called inside `async search()` |
| `searchProvider` is read once, in the constructor | `dsh-web/lib/index.js` — `this.searchProviderId = config.searchProvider ?? process.env.DSH_WEB_SEARCH_PROVIDER` |
| `dsh-web` installs no settings section | no `installSection` anywhere in `dsh-web/lib/index.js` |
| `searchProviders` is private | `dsh-web/lib/types/index.d.ts` — `private searchProviders;`, so one provider cannot reach a sibling |
| A loader entry can be enabled and disabled at runtime | `cordis-plugin-loader/lib/index.js` — `Entry.update()` disposes the fiber when the candidate is disabled, and inits it when it is not |
| The loader service is injectable and lists entries | `dsh-host-plugin-inventory/lib/index.js` — `static inject = ["loader"]`, then `ctx.loader.entries()` |
| `onChange` fires at attach and on every change | `dsh-settings/lib/index.js` — `installSection()` calls `hooks.onChange()` at attach and from `scope.watch()` |
| The row write-back is harmless | `profile-boot` rewrites the root config file to the empty list on every boot, precisely because the loader's tree write-back bakes composed rows into it |

## Design

### The invariant

> At any instant the seam must see exactly one usable provider.

Two facts make this enforceable without a pin:

- this package's provider is always registered, but reports `available() === false` unless
  it is the selected backend **and** the shipped row is currently disabled;
- the shipped row is enabled exactly when the shipped provider is the selected backend.

"Two usable" is then impossible by construction: this provider being usable requires the
shipped row to be off, and the shipped provider being usable requires it to be on. "Zero
usable" is possible only during a transition or after a failed toggle, and it fails loudly
with `WEB_PROVIDER_UNAVAILABLE` rather than silently serving the wrong backend.

### Configuration

A new field on the existing `dsh-tavily` settings namespace:

| Field | Values | Default |
|---|---|---|
| `provider` | `tavily`, `deepseek-official` | `tavily` |

The values are the seam's own provider ids, so `settings.yaml` stays self-describing and the
mapping onto `resolveProvider` is direct. `tavily` keeps today's behaviour, so an existing
deployment sees no change until someone picks the other option.

The shipped patch keeps `disabled: true` on `web-search-deepseek` — that is the value for
the default. It drops `searchProvider: tavily` from the `web` row, because a pin cannot be
changed at runtime. `fetchProvider: http` is restated, because a patch replaces the row's
whole config.

### Components

**`index.js` — `Config`** gains `provider`, in the style of the existing fields.

**`index.js` — `TavilySearchProvider.available()`** gains two conditions: the selected
provider is `tavily`, and the shipped row is not enabled. The row state is read live on
every call, which is what makes the invariant hold during a transition rather than only in
steady state.

**`index.js` — `syncBuiltinRow(provider)`** (new): resolve the `web-search-deepseek` entry
through `ctx.get('loader')`, then
`loader.update(id, { disabled: provider !== 'deepseek-official' })`. A missing loader or a
missing row is a `warn` to the harness log and a no-op — never a throw, because this
package's own backend has to keep working on a profile that has no such row.

**`index.js` — the `installSection` `onChange` hook** (currently a no-op) calls
`syncBuiltinRow(current().provider)`. Because `onChange` also fires at attach, boot applies
the persisted choice with no extra code path.

**`client.js` — the card** gains a third `select` beside `language` and `mode`, using the
same `tk_select` markup, the same stage-then-save behaviour, and a key in each of the three
dictionaries (`en`, `zh`, `zh-Hant`). Its hint says that choosing the built-in brings back
that provider's own settings card.

### Switching sequence

1. The card writes `provider`.
2. Settings commits and fires `onChange`.
3. The host half calls `syncBuiltinRow`.
4. The next `web_search` resolves the one usable provider.

The transition is not atomic, because the settings commit and the row toggle are two steps.
Both orderings leave a window of a few milliseconds:

- **to `deepseek-official`** — this provider's `available()` is already false and the row is
  not yet enabled, so zero providers are usable;
- **to `tavily`** — this provider's `available()` is already true and the row is not yet
  disabled, so two are usable (`WEB_PROVIDER_AMBIGUOUS`).

Both windows need a search issued in the same instant as the switch, and both fail loudly.
This is accepted and recorded under Risks.

### Error handling

| Condition | Behaviour |
|---|---|
| `ctx.get('loader')` is undefined | `warn`; no toggle. The row-state condition reads as "not enabled", so the selected backend alone governs `available()` and Tavily keeps working |
| `web-search-deepseek` is not in the loader | `warn` naming the id; no toggle |
| `loader.update()` rejects | `warn` with the error, then swallowed, so one bad toggle cannot break the plugin |
| `deepseek-official` selected with no `DEEPSEEK_API_KEY` | Not intercepted. The shipped provider's `available()` proves only that a resolver exists, so the seam selects it and the provider reports its own error |
| A user's own patch re-enables the row | The patch is a default; the runtime setting wins at the next `onChange` |

## Testing

`test/provider.test.mjs`, with the stubbed host the suite already uses:

- `available()` is false when `provider` is `deepseek-official`;
- `available()` is false when the shipped row is enabled, even with `provider: tavily`;
- `syncBuiltinRow` issues `update('web-search-deepseek', { disabled: true })` for `tavily`
  and `{ disabled: false }` for `deepseek-official`;
- a missing loader and a missing row each warn without throwing.

`test/client.test.mjs`:

- all three dictionaries carry the `provider` keys, and their key sets still match;
- the option values are exactly `tavily` and `deepseek-official`.

Acceptance: `npm test` green; in a live harness both backends answer `web_search`, and the
shipped card appears and disappears with the selection.

## Risks and accepted edges

- **Row-id coupling.** If a future harness renames `web-search-deepseek`, the toggle stops
  working. It degrades loudly — a warn plus a failing search in built-in mode — never
  silently.
- **No pin.** With the pin gone, a third search provider added to the deployment would make
  the seam `WEB_PROVIDER_AMBIGUOUS` in both modes. That is the seam's designed behaviour,
  and the remedy is to pin one.
- **Transition window.** Described above: loud, sub-second, accepted.
- **Card refresh.** The shipped card's appearance is a host-side namespace change, so the
  Settings page may need reopening or a reload to redraw it. Search behaviour is unaffected.
- **Tavily-only fields.** `mode`, `keylessCooldownMinutes`, and the fallback notices do not
  apply while the built-in backend is selected. The card keeps showing them.

## Rollout

Version `0.2.0` — a new field and a changed patch, with no breaking change for anyone on the
default. The README gains a "Switching providers" section, and "Why the shipped DeepSeek
provider is switched off" is rewritten around the invariant.
