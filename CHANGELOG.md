# Changelog

## 0.2.9

- Mount the panel routes by **waiting for `webServer`**, not by sampling it once
  during `apply`. The service is registered by a plugin that loads after this
  one, so `ctx.get("webServer")` was undefined at that moment and every
  `/api/sub2api/*` route was silently skipped — the settings page then showed
  only "HTTP 404：响应不是 JSON". Found by installing the plugin into a real
  DSH profile and watching it 404.
- Same treatment for `llm` and `webServer` on hosts without `ctx.inject`.

## 0.2.8

- The panel no longer depends on the provider registration succeeding. A
  rejected route (a second install, an older host) used to abort `apply`, so the
  browser half rendered while every `/api/sub2api/*` route was missing — the
  settings page showed only "HTTP 404：响应不是 JSON". Registration now runs in a
  nested injection with its own try/catch, and `inject` is empty so the panel
  mounts even when the LLM seam is absent.
- Say what a 404 means: the panel now explains that the host half did not load,
  lists the usual causes, and offers a retry.
- Log what mounted: `[sub2api] 面板路由已注册：N 条（vX.Y.Z）`, or the reason it
  did not (missing `webServer`, rejected provider).
- Fall back to `ctx.get` when a host predates `ctx.inject`.

## 0.2.7

- Retry 5xx and 429, not just dropped connections. The openresty in front of the
  gateway answers 502 while the Go backend restarts; the same request a second
  later succeeds.
- Read the real failure class. The transport's error carries it in `failure`
  (`SERVER`, `TRANSPORT`, …) while `code` is the seam-level bucket
  (`unavailable`), so routing on `code` treated every provider fault as one kind
  — the 502 path was never taken.
- Report HTTP failures as sentences instead of raw HTML, and name the status.
- `retries` replaces `transportRetries` (the old key still works), default 2,
  with quadratic backoff. Retries stop at the first streamed chunk.

## 0.2.6

- Retry a dropped connection once before the first chunk. The transport reports
  these as `TRANSPORT` and the host's retry budget is shared with every other
  failure class, so one reset could exhaust it and surface as a terminal error.
  A retry is safe there: nothing was shown and nothing was billed.
- Name the path that actually failed. The transport reports the connection's
  base URL, so the message read "https://host/v1 could not be reached" while the
  request went to `/v1/chat/completions`; it now says `/chat/completions`, how
  many times it retried, and points at `streamIdleTimeoutMs` for long contexts.
- `transportRetries` (0-5, default 1) and a README troubleshooting section for
  this error.

## 0.2.5

- 0.2.4's failure back-off also swallowed the retry a top-up was supposed to
  trigger: the balance rejection recorded seconds earlier counted as "recently
  failed", so the catalog stayed empty until the two minutes elapsed. The
  back-off now excludes `INSUFFICIENT_BALANCE`, because that answer changes the
  moment money lands.

## 0.2.4

- Sync the catalog by itself once the account is funded. A top-up normally
  happens on the payment site, so the balance is the only signal available:
  `/status` now re-syncs when it sees a positive balance with an empty catalog,
  or a stale snapshot, and announces the change to the picker. The panel polls
  status every 45 seconds while visible, so models appear on their own.
- Failures back off for two minutes, so a group that legitimately has no models
  is not retried on every poll.

## 0.2.3

- Show the running build's version in the panel's 诊断 card. A fix that shipped
  minutes ago and an install that never updated look identical in a screenshot;
  now the version says which one it is.
- The 诊断 card and the diagnostic detail quote balances in ¥ like the rest of
  the panel.

## 0.2.2

- Quote quota in yuan, which is what the site actually sells. The panel labelled
  it 美元额度 and rendered every amount with `$`, but Sub2API prices one quota
  unit as one yuan ("1 额度 = 1 元") and the recharge page grants 2 元 of quota
  per 元 paid.
- The ratio is read from configuration (`rechargeMultiplier`, default 2) instead
  of being hardcoded in the card, and `/status` plus the order response carry it
  so the estimate and the host agree.

## 0.2.1

- Declare reasoning efforts so the picker actually offers a thinking control.
  The host only accepts an effort a model has declared, and the adapter declared
  none, so the selector was empty. Known families (deepseek-v4/flash/reasoner,
  gpt-5, o3/o4) now expose minimal/low/medium/high, the chosen level is merged
  into the request body as `reasoning_effort`, and `reasoningModels` opts other
  ids in without guessing at upstreams that would reject the field.

## 0.2.0 — feature complete

- **每模型上下文修正**：面板里点容量数字即可手填，存在面板状态文件里，优先于上游声明。
- **诊断面板**：一键检查登录、令牌、密钥、资料、余额、密钥分组、模型目录，失败项直接指出原因。
- **用量与订阅**：账户卡显示今日/累计用量与请求数，订阅进度用日/周/月三条进度条。
- **兑换码**：面板内直接兑换。
- **公告**：有未读公告时在顶部提示。
- **模型搜索**：模型超过 8 个时出现搜索框。
- **`/sub2api` 命令**：status / models / balance / recharge / help。
- **渲染边界**：面板内部错误不再拖垮整个设置页。
- **面板状态迁移**：旧的 `sub2api-selection.json` 会自动并入 `sub2api-panel.json`。
- **CI**：GitHub Actions 在 Node 22/24 上跑完整测试并校验打包内容；新增 `scripts/link-host.mjs` 统一宿主包链接方式，替代散落的符号链接。

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
