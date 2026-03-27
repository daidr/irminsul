# 插件 OAuth Provider 设计

## 概述

扩展插件系统，允许插件注册 OAuth Provider，使已注册用户可以绑定第三方账号并用于快捷登录。采用 Discovery Hook + Override Hook 的分层架构，默认提供标准 OAuth 2.0 流程，同时允许插件覆盖特定阶段以支持非标准协议。

## 需求边界

- **仅账号绑定**：用户必须先用邮箱密码注册，再绑定 OAuth 账号，不支持 OAuth 直接注册
- **每个 Provider 仅绑定一个账号**：同一用户不可绑定同一 Provider 的多个账号
- **用途：快捷登录 + 展示**：绑定后可一键登录，用户设置页展示已绑定的第三方账号信息（displayName），不涉及数据同步
- **一个插件对应一个 Provider**：每个 OAuth 插件只注册一个 Provider，保持插件配置（clientId/clientSecret）、日志、启停的独立性
- **凭据复用现有 plugin config 系统**：clientId、clientSecret 等通过 `plugin.yaml` 的 `config` 字段声明，管理员在插件管理页配置

## Hook 设计

### 新增 Hook 类型

在 `KNOWN_FUNCTIONAL_HOOKS` 中新增以下 Hook：

| Hook 名称 | 必需？ | 调用时机 | 参数 | 返回值 |
|---|---|---|---|---|
| `oauth:provider` | 必需 | 启动时 discovery + 插件重载时 | 无 | `OAuthProviderDescriptor` |
| `oauth:map-profile` | 必需 | 获取到第三方用户信息后 | `rawProfile: object` | `OAuthMappedProfile` |
| `oauth:exchange-token` | 可选 | 替代默认的 code→token 交换 | `OAuthExchangeTokenArgs` | `OAuthTokenResult` |
| `oauth:fetch-profile` | 可选 | 替代默认的 userInfo 获取 | `OAuthFetchProfileArgs` | raw profile object |

### 类型定义

```typescript
interface OAuthProviderDescriptor {
  id: string;           // 唯一标识，如 "github"
  name: string;         // 显示名，如 "GitHub"
  icon: string;         // 图标 URL（推荐 SVG）
  brandColor: string;   // 品牌色（hex），用于按钮样式
  authorize: {
    url: string;        // 授权端点
    scopes: string[];   // 请求的权限范围
  };
  token: {
    url: string;        // Token 交换端点
  };
  userInfo?: {          // 可选；若不提供则必须实现 oauth:fetch-profile
    url: string;        // 用户信息端点
    headers?: Record<string, string>;  // 额外请求头（如 GitHub 需要 Accept: application/json）
  };
}

interface OAuthMappedProfile {
  providerId: string;   // 用户在第三方的唯一 ID（字符串化）
  displayName: string;  // 第三方显示名
}

interface OAuthExchangeTokenArgs {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}

interface OAuthTokenResult {
  accessToken: string;
  tokenType?: string;   // 默认 "Bearer"
}

interface OAuthFetchProfileArgs {
  accessToken: string;
  tokenType: string;
}
```

### Discovery 流程

1. 所有插件加载完成后（`PluginManager.start()` 末尾），遍历注册了 `oauth:provider` hook 的插件
2. 对每个插件调用 `oauth:provider` hook，收集返回的 `OAuthProviderDescriptor`
3. 校验 descriptor 的 `id` 唯一性（重复则记 error 日志并跳过后来者）
4. 将有效的 provider 列表缓存在 `PluginManager` 中，同时维护 `providerId → pluginId` 的映射
5. 插件热重载（Host restart）时重新执行 discovery

### clientId / clientSecret 约定

OAuth 插件**必须**使用 `clientId` 和 `clientSecret` 作为 config key 名称（如插件示例所示）。宿主在 token 交换时通过 `providerId → pluginId` 映射找到插件，再从 `PluginManager` 读取该插件的 config 获取这两个值。这是一个硬编码约定，无需在 descriptor 中声明。

### 回调 URL

`buildCallbackUrl(providerId)` 基于 `runtimeConfig.yggdrasilBaseUrl`（即 `IRMIN_YGGDRASIL_BASE_URL`）拼接：

```
{yggdrasilBaseUrl}/api/oauth/{providerId}/callback
```

管理员配置 OAuth App 时需要将此 URL 填入第三方平台的 redirect URI。

## 数据模型

### User 文档变更

在 `UserDocument` 中新增 `oauthBindings` 字段：

```typescript
interface OAuthBinding {
  provider: string;      // provider ID（如 "github"）
  providerId: string;    // 用户在第三方的唯一 ID
  displayName: string;   // 第三方显示名
  boundAt: Date;
}

interface UserDocument {
  // ... 现有字段 ...
  oauthBindings: OAuthBinding[];  // 默认空数组
}
```

### 新增索引

```javascript
// 确保同一第三方账号不被绑定到多个用户
{ "oauthBindings.provider": 1, "oauthBindings.providerId": 1 }
// unique: true, sparse: true
```

### User Repository 新增方法

```typescript
// 绑定 OAuth 账号
addOAuthBinding(uuid: string, binding: OAuthBinding): Promise<void>

// 解绑 OAuth 账号
removeOAuthBinding(uuid: string, provider: string): Promise<void>

// 按 provider + providerId 查找用户（用于 OAuth 登录）
findUserByOAuthBinding(provider: string, providerId: string): Promise<UserDocument | null>

// 检查用户是否已绑定指定 provider
hasOAuthBinding(uuid: string, provider: string): Promise<boolean>
```

## API 路由

### 新增路由

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/api/oauth/providers` | 无 | 返回所有可用 OAuth Provider 列表 |
| GET | `/api/oauth/[providerId]/authorize` | 条件性 | 发起 OAuth（bind 需登录，login 不需要） |
| GET | `/api/oauth/[providerId]/callback` | 无 | 第三方回调处理 |
| POST | `/api/oauth/[providerId]/unbind` | 需登录 | 解绑指定 Provider |

### 文件结构

```
server/api/oauth/
  providers.get.ts
  [providerId]/
    authorize.get.ts
    callback.get.ts
    unbind.post.ts
```

### `GET /api/oauth/providers`

返回所有已启用 OAuth 插件的 provider 元数据，仅供前端渲染按钮使用：

```json
{
  "providers": [
    { "id": "github", "name": "GitHub", "icon": "https://...", "brandColor": "#24292e" }
  ]
}
```

用户的绑定状态通过现有 `/api/auth/me` 返回（session middleware 增加 `oauthBindings` 投影）。

### `GET /api/oauth/[providerId]/authorize?action=bind|login`

1. 校验 `providerId` 存在且对应插件已启用，否则 404
2. 校验 `action` 参数为 `"bind"` 或 `"login"`
3. `action=bind`：调用 `requireAuth(event)`，检查用户未重复绑定该 provider
4. `action=login`：无需认证
5. 生成随机 state，存入 Redis
6. 302 重定向到 provider 的 authorize URL，携带 `client_id`、`redirect_uri`、`scope`、`state`

### `GET /api/oauth/[providerId]/callback?code=...&state=...`

1. 消费 state（Redis GETDEL，防重放）
2. 校验 `providerId` 与 state 中记录一致
3. **Token 交换**：若插件注册了 `oauth:exchange-token` hook 则调用，否则执行默认 OAuth 2.0 token 交换（POST to token URL, `application/x-www-form-urlencoded`）
4. **获取用户信息**：若插件注册了 `oauth:fetch-profile` hook 则调用，否则用 access token GET userInfo URL
5. **映射 Profile**：调用插件的 `oauth:map-profile` hook，获取 `{ providerId, displayName }`
6. 根据 `state.action` 分流：
   - `bind`：检查 `(provider, providerId)` 未被其他用户占用 → 写入 `oauthBindings` → 302 → `/home?oauth=bind-success`
   - `login`：查找 `(provider, providerId)` 对应用户 → 创建 session → 302 → `/home`；未找到 → 302 → `/login?oauth=not-bound`
7. 任何异常 → 302 回前端带 error query param

### `POST /api/oauth/[providerId]/unbind`

1. `requireAuth(event)`
2. 从当前用户的 `oauthBindings` 中移除匹配 provider 的记录
3. 返回 `{ success: true }`

## State 参数安全

| 属性 | 值 |
|---|---|
| 格式 | 随机 UUID（32 字节 hex） |
| Redis Key | `irmin:oauth:state:<state>` |
| TTL | 5 分钟 |
| 存储内容 | `{ action: "bind"\|"login", userId?: string, providerId: string }` |
| 消费方式 | GETDEL（一次性，防重放） |

## 宿主侧工具函数

新增 `server/utils/oauth.ts`，封装以下功能：

```typescript
// 从 PluginManager 获取所有可用 provider 描述
getOAuthProviders(): OAuthProviderDescriptor[]

// 获取单个 provider，不存在返回 null
getOAuthProvider(id: string): OAuthProviderDescriptor | null

// 创建 OAuth state 并存入 Redis
createOAuthState(data: { action: "bind" | "login"; userId?: string; providerId: string }): Promise<string>

// 消费 OAuth state（GETDEL），返回 null 表示无效/过期
consumeOAuthState(state: string): Promise<OAuthStateData | null>

// 默认 OAuth 2.0 token 交换
defaultExchangeToken(tokenUrl: string, args: OAuthExchangeTokenArgs): Promise<OAuthTokenResult>

// 默认 userInfo 获取
defaultFetchProfile(userInfoUrl: string, accessToken: string, tokenType: string, headers?: Record<string, string>): Promise<unknown>

// 生成回调 URL
buildCallbackUrl(providerId: string): string
```

路由 handler 调用这些工具函数，自身保持精简。

## 前端 UI

### 登录页

在现有 Passkey 按钮下方新增"第三方账号登录"独立分区：

- 分隔线标题："第三方账号登录"
- 方形按钮（44×44px），品牌色背景 + Provider 图标（来自 `icon` URL）
- flex row 居中排列，按钮间距 8px
- hover 时 tooltip 气泡显示 Provider 名称
- 点击后跳转 `/api/oauth/:providerId/authorize?action=login`
- 无 OAuth 插件启用时，整个分区（含分隔线）不渲染
- Provider 列表通过 `GET /api/oauth/providers` 获取

### 用户设置页 — 绑定管理

新增"第三方账号"区块，列出所有可用 Provider：

- **已绑定**：实线边框，显示 Provider 图标 + 名称 + displayName，绿色"已绑定"标签，红色"解绑"按钮
- **未绑定**：虚线边框，降低透明度，显示 Provider 图标 + 名称 + "未绑定"，主色"绑定"按钮
- 绑定按钮跳转 `/api/oauth/:providerId/authorize?action=bind`
- 解绑按钮需二次确认弹窗，确认后 POST `/api/oauth/:providerId/unbind`
- 绑定状态来自 `/api/auth/me` 返回的 `oauthBindings` 字段
- 无 OAuth 插件启用时，整个区块不渲染

### 前端 Toast 提示

登录页和设置页需要处理 OAuth 回调后的 query param 并展示 toast：

| Query Param | 提示内容 |
|---|---|
| `oauth=bind-success` | "第三方账号绑定成功" |
| `oauth=not-bound` | "该第三方账号未绑定任何用户" |
| `oauth=already-bound` | "该第三方账号已绑定其他用户" |
| `oauth=duplicate` | "你已绑定该服务的账号" |
| `oauth=error` | "第三方登录失败，请重试" |

## 插件示例

一个完整的 GitHub OAuth 插件示例：

**`plugin.yaml`：**

```yaml
name: GitHub OAuth
version: 1.0.0
description: 使用 GitHub 账号绑定和登录
author: irminsul
hooks:
  - oauth:provider
  - oauth:map-profile
config:
  - key: clientId
    label: Client ID
    type: text
    required: true
    description: GitHub OAuth App 的 Client ID
  - key: clientSecret
    label: Client Secret
    type: password
    required: true
    description: GitHub OAuth App 的 Client Secret
```

**`index.js`：**

```javascript
export function setup(ctx) {
  const config = ctx.config.getAll();

  ctx.hook("oauth:provider", () => ({
    id: "github",
    name: "GitHub",
    icon: "https://github.githubassets.com/favicons/favicon.svg",
    brandColor: "#24292e",
    authorize: {
      url: "https://github.com/login/oauth/authorize",
      scopes: ["read:user"],
    },
    token: {
      url: "https://github.com/login/oauth/access_token",
    },
    userInfo: {
      url: "https://api.github.com/user",
      headers: { Accept: "application/vnd.github+json" },
    },
  }));

  ctx.hook("oauth:map-profile", (raw) => ({
    providerId: String(raw.id),
    displayName: raw.login,
  }));
}
```

## 对 `/api/auth/me` 的变更

Session middleware 的 MongoDB 投影增加 `oauthBindings` 字段，使 `/api/auth/me` 返回中包含用户的绑定信息。前端通过 `useUser()` 获取的数据将自然包含该字段。
