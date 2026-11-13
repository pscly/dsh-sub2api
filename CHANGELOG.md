# Changelog

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
