# Changelog

## 0.1.7

- Always report a context window. The host refuses to switch to a model it
  cannot size ("no context capacity for <route>; configure contextWindow on
  that adapter model"), and `/v1/models` usually omits `context_length` because
  it is the upstream's response passed through. The adapter now resolves one
  through config → upstream → measured table → `defaultContextWindow` (128000),
  and the panel labels where the figure came from.
- `deepseek-flash` / `deepseek-v4.1-flash` are pinned to 1,048,576 from the
  measurement on this gateway.

## 0.1.6

- Make the chat model picker see a fresh catalog. It rebuilds itself from
  `llm/adapters-updated`, and the plugin never published one, so a session
  opened before the first sync kept an empty provider until the page reloaded.
  Refreshing the catalog now swaps the adapter route set, which is the
  documented way to announce the change.
- Add a model allowlist: the panel's 模型 card lists every upstream model with
  checkboxes, stores the choice in `$DSH_HOME/sub2api-selection.json`, and
  `listModels` honours it, so the picker shows exactly what was chosen. All
  boxes ticked means no restriction; the `visibleModels` config still wins when
  an operator sets it.

## 0.1.5

- Published to npm as `dsh-sub2api`, which is what DSH Desktop's community
  market requires for one-click install. README now leads with the npm command
  and documents that the market entry is installable.

## 0.1.4

- Never create an ungrouped key. With more than one group on offer and no
  `allowed_groups` on the account, selection returned nothing, the key was
  created without a group, and the gateway rejected it with a permission error
  — the catalog could never load. Selection now prefers a group whose platform
  matches this plugin's protocol (openai), then a non-exclusive one.
- Stop rendering `[object Object]`. The gateway reports key and permission
  faults in OpenAI's `{error:{message,type}}` shape, which has no top-level
  `message`; casting `body.error` to a string produced that placeholder. Error
  bodies are now unwrapped properly, `describe()` refuses to stringify an
  object, and the panel renders text only.
- The report heading now says 开通未完成 only when a blocking step failed.

## 0.1.3

- Drop the manual-reconciliation copy. The recharge hint no longer promises a
  human review step, and the order-status wording says "正在确认到账" instead of
  "正在核账". The equivalent wording on pay.pscly.cc's checkout page and status
  payload was changed to match.

## 0.1.2

- Treat a zero-balance account as a state, not a failure. sub2api answers
  `/v1/models` with `403 INSUFFICIENT_BALANCE` until the account is credited, so
  a freshly registered user always saw an empty picker with no explanation. The
  catalog now records the reason, the panel shows it with a 去充值 shortcut, and
  a settled recharge refreshes the catalog immediately.
- Redesigned the settings panel: labelled fields with a focus ring, a
  show/hide password control, a full-width primary action, alert blocks for
  both expected and failed states, and a models list with context/vision badges.

## 0.1.1

- Support DSH `0.2.1` alongside `0.2.2`, so the plugin installs on every DSH
  Desktop channel (stable ships 0.2.1-rc.3, beta/next ship 0.2.2-rc.3).
  Pinned `@dsh-ai-providers/openai-compatible@0.7.0`, whose peer range covers
  both; the LLM surface used here is identical across the two.
- Documented DSH Desktop installation, channel compatibility, the restart
  requirement and the market's npm-only automatic-install boundary.

## 0.1.0

- First release: provider route `sub2api`, zero-friction signup, automatic
  provisioning of a key named `dsh`, upstream model sync, balance, redeem codes
  and the two-path recharge hand-off.
