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

```sh
dsh plugin --profile web add dsh-sub2api
```

重启后打开 **设置 → Sub2API**。

> 每个 profile 的插件列表独立：终端界面还需单独装一次。

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
| `groupId` | 自动选择 | 强制指定密钥所属分组 |
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
