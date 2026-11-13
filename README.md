# dsh-sub2api

把 [sub2api](https://github.com/Wei-Shaw/sub2api) 中转站接进 DeepSeek Harness（DSH）的插件。

用户装完插件后，在 **设置 → Sub2API** 里填一次邮箱和密码就能用：插件自动判断该登录还是注册，注册后自动创建名为 `dsh` 的 API 密钥、写入本机凭据库，并把上游模型同步进模型选择器。余额、订阅进度、兑换码和充值入口都在同一个面板里。

## 它解决什么

手动把中转站接进 DSH 需要四步：拿账号 → 去后台建 Key → 把 Key 填进设置 → 记住模型名。任何一步出错，用户就卡住了。

这个插件把这四步压成一次输入：

| 手动接入 | 本插件 |
|---|---|
| 注册账号（可能要跳浏览器） | 面板里填邮箱密码 |
| 去后台创建 API Key 并复制 | 自动创建名为 `dsh` 的密钥 |
| 把 Key 粘贴到设置页 | 自动写入凭据库 |
| 手动填 baseUrl 和模型列表 | 自动同步 `/v1/models` |

## 功能

- **单表单登录/注册**：先试登录，只有"凭据错误"才自动注册；密码错不会被误报成"账号不存在"，也不会重复建号。
- **自动开通**：建 Key → 写凭据 → 同步模型，五步各自报告结果，某一步失败不会拖垮整体。
- **模型自动同步**：目录来自上游 `/v1/models`，10 分钟 TTL、磁盘缓存、可手动刷新。
- **流式对话**：协议层复用 `@dsh-ai-providers/openai-compatible`，工具调用、推理增量、图片输入、重试都由它负责。
- **余额与用量**：登录态下读 `/user/profile`、订阅进度与用量统计。
- **充值**：面板内选金额，按 `1 元 = 2 美元` 显示预计到账，点「去支付」在新标签页打开支付页；订单状态可轮询到「已到账」。
- **兑换码**：面板内直接兑换。
- **Agent 工具**：`sub2api_status`、`sub2api_models`，让模型能回答"我还有多少额度"。

## 安装

### npm（推荐）

```sh
dsh plugin --profile web add dsh-sub2api
```

也可以在 **插件 → 添加插件** 里直接搜 `dsh-sub2api`。

重启后打开 **设置 → Sub2API**。

> 每个 profile 的插件列表独立：终端界面还需单独装一次。

### 从 GitHub 装（不依赖 npm）

```sh
dsh plugin --profile web add github:pscly/dsh-sub2api#v0.1.4
```

### DSH Desktop

Desktop 用的就是官方 Harness 插件体系，本插件只依赖官方契约（`llm` / `webServer` / `tools` / `slots`），所以在桌面端原样可用。

在托盘菜单打开的终端里，裸命令默认作用于**当前激活的 profile**：

```sh
dsh plugin add dsh-sub2api
```

或者显式指定（Desktop 的默认 profile 叫 `desktop`）：

```sh
dsh plugin --profile desktop add dsh-sub2api
```

装完**需要重启 DSH Desktop**，新的 bundle 才会进入 Loader 组合。桌面端不会把插件从一个 profile 复制到另一个，所以命令必须打在你实际在用的那个 profile 上。

**通道兼容性**（`upstream.json` 实测）：

| Desktop 通道 | 内置 DSH | 本插件 |
|---|---|---|
| stable | 0.2.1-rc.3 | ✅ |
| beta | 0.2.2-rc.3 | ✅ |
| next | 0.2.2-rc.3 | ✅ |

插件声明 `>=0.2.1-rc.2 <0.2.3`，并固定 `@dsh-ai-providers/openai-compatible@0.7.0`——这个版本同时接受 0.2.1 与 0.2.2 两个通道（0.7.3 只接受 0.2.2）。

**从插件市场一键安装**：Desktop 的市场只对满足四个条件的条目提供自动安装——单一 npm 包名、官方 registry 的 `latest` 返回同名稳定版本、包内声明 `dsh.bundle.patch`。本包已全部满足（`dsh-sub2api@0.1.4` 起在 npm 上），所以在市场里能直接点安装。

## 配置

插件行写在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`：

```yaml
- id: llm-sub2api
  name: "dsh-sub2api"
  config:
    apiBase: "https://sub.pscly.cc"
    payBase: "https://pay.pscly.cc"
    apiKeyEnv: SUB2API_API_KEY
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `apiBase` | `https://sub.pscly.cc` | 中转站地址，`/v1` 后缀会被自动去掉 |
| `payBase` | `https://pay.pscly.cc` | 充值中转站地址 |
| `apiKeyEnv` | `SUB2API_API_KEY` | 存 API Key 的凭据引用名 |
| `keyName` | `dsh` | 自动创建的密钥名 |
| `groupId` | 自动选择 | 强制指定密钥所属分组（自动选择见下） |
| `requestTimeoutMs` | 300000 | 普通请求超时 |
| `streamIdleTimeoutMs` | 300000 | 流式请求空闲超时 |
| `modelsCachePath` | `$DSH_HOME/sub2api-models.json` | 模型目录缓存 |
| `visibleModels` | 全部 | 只显示这些模型 id |
| `contextWindow` | 跟随上游 | 强制覆盖上下文窗口 |
| `showSidebarQuota` | false | 侧边栏余额卡片 |
| `autoProvision` | true | 登录后自动建 Key |
| `announceToAgent` | true | 向 agent 注入插件说明 |

## 数据与凭据

| 数据 | 位置 | 权限 |
|---|---|---|
| 登录会话（token） | DSH 凭据库 record `llm-sub2api/session` | 0600 |
| API Key | 凭据引用 `SUB2API_API_KEY` | 0600 |
| 模型目录缓存 | `$DSH_HOME/sub2api-models.json` | 0600 |
| 密码 | **不保存** | — |

面板永远只显示密钥掩码；「复制」会向本机路由临时取一次明文。

## 安全边界

- 所有 `/api/sub2api/*` 路由只接受本机回环请求，非本机一律 403。
- 日志与错误信息不包含 token、密钥或密码。
- 支付链接里的 `token` 是 sub2api 的访问令牌，只在用户点「去支付」时生成，不写日志、不落盘。

## 上下文窗口

DSH 在切换模型前要算上下文容量，拿不到就直接拒绝：

```
Cannot switch to sub2api/...: no context capacity; configure contextWindow on that adapter model
```

`/v1/models` 透传的是上游响应，多数上游**不带 `context_length`**，所以插件自己补一个，回退链是：

1. 配置里的 `contextWindow`（对所有模型生效）
2. 上游声明的 `context_length` / `context_window`
3. 实测表（目前只有 `deepseek-flash` / `deepseek-v4.1-flash` = 1,048,576，来自本站实测）
4. `defaultContextWindow`，默认 **128000**

面板的模型列表里会标出容量来源：`128k · 默认` 表示是兜底值，`1049k · 实测` 表示来自实测表，没有标记表示上游自己声明的。

> 兜底值只是让对话能跑起来。如果某个模型实际容量更大，把它写进配置的 `contextWindow`，或者告诉我加进实测表——填大了上游会 400，填小了会提前压缩。

## 选择对话里显示哪些模型

上游一个中转站往往有几十个模型，全部塞进选择器既难找也容易选错。面板的「模型 → 选择模型」里可以勾选要用的那几个：

- 勾选结果存在 `$DSH_HOME/sub2api-selection.json`（0600），不写进设置文档
- **全部勾选等于不做限制**，等同于没设置
- 通过 `groupId` 之外的方式固定的话，配置里的 `visibleModels` 优先级更高（适合运营方统一指定）
- 保存后会立刻通知宿主刷新选择器，不用重开会话

## 密钥建在哪个分组

网关会拒绝**没有分组的密钥**（`API key is not assigned to a group`），所以自动选择必须有确定结果：

1. 配置里的 `groupId`
2. 账号的 `allowed_groups` 里能匹配到的组
3. 只有一个组时，就用它
4. 多个组时，优先 `platform` 为 `openai` 的组（中间层走的是 `chat/completions`，别的平台的组服务不了）
5. 否则取第一个非独占组

## 余额为 0 时为什么没有模型

Sub2API 的网关对 `/v1/models` 有余额门槛：**账户余额为 0 时直接返回 `403 INSUFFICIENT_BALANCE`**，模型列表拿不到。这不是插件的解析问题，实测确认：

```
[200] POST /api/v1/keys         → 正常返回明文 key
[403] GET  /v1/models           → {"code":"INSUFFICIENT_BALANCE"}
[200] GET  /v1/sub2api/billing  → 正常（Key 绑定分组后）
[404] GET  /api/v1/models       → 控制面没有模型接口
```

所以插件把零余额当作**"待充值"状态**而不是错误：设置页里显示「余额不足，暂时拿不到模型列表」和一个「去充值」按钮，充值到账后自动同步，不需要重新登录。

> 对运营者的建议：如果希望新用户注册后就能看到模型，在后台给注册赠送一点初始余额；否则新用户的第一屏必然是空的。

## 关于充值

支付是独立服务 `pay.pscly.cc`。它的嵌入式充值页要求带上 `user_id` 和 `token` 并回源校验 Sub2API 身份，所以**裸链接一定 403**——这也是为什么不能只在设置里放一个跳转按钮。

插件提供两条路径：

1. **链接模式**：生成带身份的 URL，新标签页打开，金额在支付页选。
2. **直达模式**：面板里选金额，Host 完成 CSRF 握手后直接拿到 `/checkout/{orderNo}`，并可轮询到账状态。失败时自动退回模式 1。

## 开发

```sh
npm install            # 安装 @dsh-ai-providers/*
npm test               # 冒烟 + 边界测试（本地假服务，不联网）
```

测试用假 sub2api、假支付站和内存凭据服务跑真实插件入口，覆盖注册开通、重复登录复用密钥、错误密码、流式对话、充值下单与轮询、兑换码、登出清理，以及无头环境、缺凭据服务、空目录、传输层缺失等边界。

## 许可证

GPL-3.0-only。协议层复用了 `@dsh-ai-providers/openai-compatible`（GPL-3.0-only）。
