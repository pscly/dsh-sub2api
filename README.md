# dsh-sub2api

把 [Sub2API](https://github.com/Wei-Shaw/sub2api) 中转站接进 DeepSeek Harness（DSH）。

装完之后，在 **设置 → Sub2API** 里填一次邮箱和密码就能用：插件自己判断该登录还是注册，注册后自动创建名为 `dsh` 的 API 密钥、写进本机凭据库，并把上游模型同步进模型选择器。余额、用量、订阅、兑换码、充值和技术支持都在同一个面板里。

```
npm:  dsh-sub2api          https://www.npmjs.com/package/dsh-sub2api
repo: pscly/dsh-sub2api    https://github.com/pscly/dsh-sub2api
```

---

## 它解决什么

手动接一个中转站要四步：拿账号 → 去后台建 Key → 把 Key 粘进设置 → 记住模型名。任何一步错，用户就卡住了。

| 手动接入 | 本插件 |
|---|---|
| 注册账号（可能要跳浏览器） | 面板里填邮箱密码 |
| 去后台创建 API Key 并复制 | 自动创建名为 `dsh` 的密钥 |
| 把 Key 粘贴到设置页 | 自动写入凭据库 |
| 手填 baseUrl 和模型列表 | 自动同步 `/v1/models` |
| 出问题自己猜 | 「运行诊断」直接指出坏在哪一项 |

## 安装

### npm（推荐）

```sh
dsh plugin --profile web add dsh-sub2api
```

也可以直接在 **插件 → 添加插件** 里搜 `dsh-sub2api`。

重启后打开 **设置 → Sub2API**。

### 从 GitHub 装

```sh
dsh plugin --profile web add github:pscly/dsh-sub2api#v0.2.0
```

### DSH Desktop

Desktop 用的就是官方 Harness 插件体系，本插件只依赖官方契约（`llm` / `webServer` / `tools` / `commands` / `slots`），在桌面端原样可用。

托盘菜单打开的终端里，裸命令默认作用于当前激活的 profile：

```sh
dsh plugin add dsh-sub2api
```

装完**必须重启 DSH Desktop**，新的 bundle 才会进入 Loader 组合。

| Desktop 通道 | 内置 DSH | 本插件 |
|---|---|---|
| stable | 0.2.1-rc.3 | ✅ |
| beta | 0.2.2-rc.3 | ✅ |
| next | 0.2.2-rc.3 | ✅ |

插件声明 `>=0.2.1-rc.2 <0.2.3`，并固定 `@dsh-ai-providers/openai-compatible@0.7.0`——这个版本同时接受 0.2.1 与 0.2.2 两个通道。

插件市场的一键安装要求：单一 npm 包名、官方 registry 的 `latest` 是稳定版本、包内声明 `dsh.bundle.patch`。三条都满足。

---

## 面板

### 账户

邮箱、余额、并发数、今日/累计用量，以及订阅进度条（日/周/月）。未登录时是登录表单：一个邮箱 + 一个密码 + 一个「继续」按钮。

**一个表单两种结果**：先试登录，只有「凭据错误」才自动注册。所以

- 新邮箱 → 注册 → 直接进入
- 老邮箱密码对 → 登录
- 老邮箱密码错 → 提示「这个邮箱已注册，密码不正确」，**不会重复建号**

### API 密钥

显示掩码，点「复制」才临时取回明文。密钥名固定为 `dsh`；再次点击是**轮换**（新建成功后才删除旧的），不是堆一堆。

### 余额与充值

金额预设 + 自定义，按 `1 元 = 2 美元额度` 实时显示预计到账。点「去支付」在新标签页打开支付页，付款后自动轮询状态并刷新余额。下方是兑换码入口。

### 模型

- 列出**全部**上游模型，勾选决定对话里显示哪些（全部勾选 = 不做限制）
- 容量数字可点，手动改这个模型的上下文窗口
- 超过 8 个模型时出现搜索框
- 显示容量来源：无标记=上游声明，`实测`=内置实测表，`默认`=兜底值，`手填`=你自己改的

### 诊断

一键跑六项检查：登录状态、访问令牌、API 密钥、账号资料、余额、密钥分组、模型目录。失败的那一项直接标出原因，不用在几个卡片之间猜。

---

## 命令与工具

```
/sub2api           账号、密钥、余额、模型数量
/sub2api models    列出对话里可选的模型
/sub2api balance   余额与订阅
/sub2api recharge  充值入口
/sub2api help      用法
```

Agent 工具（只读）：`sub2api_status`、`sub2api_models`。模型可以回答「我还有多少额度」，但不会替你花钱。

---

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
| `apiBase` | `https://sub.pscly.cc` | 中转站地址，末尾 `/v1` 会被去掉 |
| `payBase` | `https://pay.pscly.cc` | 充值中转站地址 |
| `apiKeyEnv` | `SUB2API_API_KEY` | 存 API Key 的凭据引用名 |
| `keyName` | `dsh` | 自动创建/复用的密钥名 |
| `groupId` | 自动选择 | 强制指定密钥所属分组 |
| `requestTimeoutMs` | 300000 | 普通请求超时 |
| `streamIdleTimeoutMs` | 300000 | 流式请求空闲超时 |
| `modelsCachePath` | `$DSH_HOME/sub2api-models.json` | 模型目录缓存 |
| `panelPath` | `$DSH_HOME/sub2api-panel.json` | 面板状态（可见模型 + 手填容量） |
| `visibleModels` | 全部 | 运营方统一指定可见模型（优先于面板选择） |
| `contextWindow` | 逐模型解析 | 强制覆盖**所有**模型的上下文窗口 |
| `defaultContextWindow` | 128000 | 上游未声明时的兜底值 |
| `showSidebarQuota` | false | 侧边栏余额卡片 |
| `autoProvision` | true | 登录后自动建 Key |
| `announceToAgent` | true | 向 agent 注入插件说明 |

---

## 三个必须知道的机制

### 1. 密钥分组

网关会拒绝**没有分组的密钥**（`API key is not assigned to a group`），所以自动选择必须有确定结果：

1. 配置里的 `groupId`
2. 账号 `allowed_groups` 里能匹配到的组
3. 只有一个组时就用它
4. 多个组时优先 `platform` 为 `openai` 的组（中间层走 `chat/completions`，别的平台服务不了）
5. 否则取第一个非独占组

### 2. 余额为 0 拿不到模型

Sub2API 的网关对 `/v1/models` 有余额门槛，零余额直接 `403 INSUFFICIENT_BALANCE`：

```
[200] POST /api/v1/keys         → 正常返回明文 key
[403] GET  /v1/models           → {"code":"INSUFFICIENT_BALANCE"}
[200] GET  /v1/sub2api/billing  → 正常（Key 绑分组后）
[404] GET  /api/v1/models       → 控制面没有模型接口
```

插件把它当作**待充值状态**而不是错误：面板显示「余额不足，暂时拿不到模型列表」+「去充值」，充值到账后自动同步。

> 运营建议：给新用户送一点初始余额，否则注册完第一屏必然是空的。

### 3. 上下文窗口

DSH 切换模型前要算容量，拿不到就拒绝：

```
Cannot switch to sub2api/...: no context capacity; configure contextWindow on that adapter model
```

`/v1/models` 是上游响应透传，多数上游不带 `context_length`，所以插件逐级回退：

1. 配置 `contextWindow`（全局）
2. 面板里手填的单模型值
3. 上游声明
4. 内置实测表（`deepseek-flash` / `deepseek-v4.1-flash` = 1,048,576，来自本站实测）
5. `defaultContextWindow`（默认 128000）

**填大了上游会 400，填小了会提前压缩**——拿不准就用面板里的手填值和诊断确认。

---

## 数据与安全

| 数据 | 位置 | 权限 |
|---|---|---|
| 登录会话（token） | DSH 凭据库 record `llm-sub2api/session` | 0600 |
| API Key | 凭据引用 `SUB2API_API_KEY` | 0600 |
| 模型目录缓存 | `$DSH_HOME/sub2api-models.json` | 0600 |
| 面板状态 | `$DSH_HOME/sub2api-panel.json` | 0600 |
| 密码 | **不保存** | — |

- 所有 `/api/sub2api/*` 路由只接受本机回环请求，非本机一律 403。
- 日志与错误信息不含 token、密钥或密码；错误体里的对象会被解包成可读文案，不会出现 `[object Object]`。
- 支付链接里的 `token` 只在用户点「去支付」时生成，不落盘、不写日志。

---

## 开发

```sh
npm install --ignore-scripts --legacy-peer-deps
node scripts/link-host.mjs     # 链接宿主的 @deepseek-ai/* 包
npm test                       # 32 项检查，全部离线
```

宿主包是 **peer dependency**：插件必须和宿主共用同一份 `LlmAdapter`，否则注册表的 `instanceof` 会失败。npm 不会安装同时声明为 peer 的包，所以要靠 `scripts/link-host.mjs` 从已安装的 DSH 里链接过来（CI 也是这么做的）。

测试用假 sub2api、假支付站、假宿主跑**真实插件入口**，覆盖：注册开通、重复登录复用密钥、错误密码、零余额状态、充值解禁、流式对话、模型可见性、单模型容量覆盖、诊断、命令、登出清理、无头环境、缺服务降级、错误体解包、选组规则、客户端模块契约。

CI（GitHub Actions）在 Node 22 与 24 上跑同一套测试并校验打包内容。

## 许可证

GPL-3.0-only。协议层复用 `@dsh-ai-providers/openai-compatible`（GPL-3.0-only）。
