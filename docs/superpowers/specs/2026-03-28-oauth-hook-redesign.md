# OAuth Hook 体系重构设计

## 背景

当前 OAuth 插件 hook 体系存在两个架构问题：

1. **凭据键名硬编码** — 平台在 authorize 和 callback 阶段硬编码读取 `pluginConfig.clientId` / `pluginConfig.clientSecret`，插件无法使用自定义键名（如 Apple 的 `teamId`/`keyId`/`privateKey`）。
2. **URL 静态缓存** — `oauth:provider` hook 在启动时调用一次并缓存，`authorize.url`/`token.url`/`userInfo.url` 无法动态变化（如 Microsoft 的租户 URL 需要标记 `restart: true`）。

## 设计目标

- 平台**完全不碰凭据**，不从 pluginConfig 读取任何键名
- 动态 URL 通过独立的请求时 hook 解决
- 不考虑历史兼容性
- 所有 hook 必选，平台不提供默认 OAuth 流程实现
- 通过 `ctx.oauth` 工具函数减少标准提供商的重复代码

## 新 Hook 体系

5 个 hook，全部必选：

### `oauth:provider`（启动时发现）

- **调用时机**：服务启动、插件启用、host 重启、crash 恢复
- **入参**：无
- **返回**：`{ id: string, name: string, icon: string, brandColor: string }`
- **说明**：仅返回展示信息，不再包含 authorize/token/userInfo 等 OAuth 协议细节

### `oauth:authorize`（用户点击登录/绑定时）

- **调用时机**：每次 authorize 请求
- **入参**：`{ redirectUri: string, state: string }`
- **返回**：`{ url: string }` — 完整的第三方授权 URL
- **说明**：插件自行拼接 `client_id`、`scope`、`response_type`、`response_mode` 等一切参数。平台只负责生成 `state`（CSRF 防护）和 `redirectUri`（基于 `IRMIN_YGGDRASIL_BASE_URL`）传入

### `oauth:exchange-token`（回调时 token 交换）

- **调用时机**：OAuth 回调收到 `code` 后
- **入参**：`{ code: string, redirectUri: string }`
- **返回**：`{ accessToken: string, tokenType?: string }`
- **说明**：不再传入 `clientId`/`clientSecret`，插件通过 `ctx.config` 自行读取凭据

### `oauth:fetch-profile`（获取用户信息）

- **调用时机**：token 交换成功后
- **入参**：`{ accessToken: string, tokenType: string }`
- **返回**：`unknown`（原始 profile 对象）
- **说明**：改为必选。Apple 等无 userInfo 端点的提供商在此 hook 中解析 id_token

### `oauth:map-profile`（映射用户信息）

- **调用时机**：获取到原始 profile 后
- **入参**：`unknown`（原始 profile）
- **返回**：`{ providerId: string, displayName: string }`
- **说明**：不变

## `OAuthProviderDescriptor` 类型

缩减为纯展示信息：

```typescript
interface OAuthProviderDescriptor {
  id: string;
  name: string;
  icon: string;
  brandColor: string;
}
```

移除的字段：`authorize`（url, scopes, params）、`token`（url）、`userInfo`（url, headers）。

## `ctx.oauth` 工具函数

在 Worker 侧的 `ctx` 对象上挂载 `oauth` 命名空间，提供两个标准 OAuth 2.0 流程的封装函数，减少标准提供商插件的重复代码：

### `ctx.oauth.exchangeToken(tokenUrl, options)`

```typescript
ctx.oauth.exchangeToken(
  tokenUrl: string,
  options: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  }
): Promise<{ accessToken: string; tokenType: string }>
```

行为：POST `application/x-www-form-urlencoded`，headers 含 `Accept: application/json`，body 含 `grant_type=authorization_code`、`code`、`redirect_uri`、`client_id`、`client_secret`。防御性检查：响应非 2xx 时 throw Error（含状态码和响应体），响应缺少 `access_token` 时 throw Error。返回 `{ accessToken, tokenType }`，`tokenType` 缺失时默认 `"Bearer"`。

### `ctx.oauth.fetchProfile(userInfoUrl, options)`

```typescript
ctx.oauth.fetchProfile(
  userInfoUrl: string,
  options: {
    accessToken: string;
    tokenType: string;
    headers?: Record<string, string>;
  }
): Promise<unknown>
```

行为：GET 请求，`Authorization: {tokenType} {accessToken}`，合并额外 headers。防御性检查：响应非 2xx 时 throw Error（含状态码和响应体）。返回解析后的 JSON 响应体。

### 实现位置

在 `server/worker/plugin-host.ts` 中构建 `ctx` 时挂载。这两个函数本质是 `fetch` 的封装，直接在 Worker 内执行，不需要 IPC。

## 平台侧改动

### `server/api/oauth/[providerId]/authorize.get.ts`

简化为：

1. 校验 `action` 参数（bind/login）
2. bind 时检查登录态 + 重复绑定
3. `createOAuthState({ action, userId, providerId })`
4. `callPluginHook(pluginId, "oauth:authorize", { redirectUri, state })`
5. **校验返回值**：`result.url` 必须为非空字符串且以 `https://` 开头，否则返回 500 错误（防止开放重定向和 `javascript:` 等危险协议注入）
6. `sendRedirect(event, result.url)`

删除：凭据读取、`clientId`/`clientSecret` 校验、URL 拼接逻辑。

### `server/utils/oauth-callback.ts`

简化为 3 个 hook 直接调用，无条件分支。每个 hook 调用失败时记录包含 `step` 字段的日志以区分错误阶段：

1. `callPluginHook("oauth:exchange-token", { code, redirectUri })` → tokenResult
   - **校验**：`tokenResult.accessToken` 必须为非空字符串，否则记录错误（`step: "exchange_token"`）并重定向
   - **默认值**：`tokenResult.tokenType` 缺失时补 `"Bearer"`
2. `callPluginHook("oauth:fetch-profile", { accessToken, tokenType })` → rawProfile
   - 失败时记录 `step: "fetch_profile"`
3. `callPluginHook("oauth:map-profile", rawProfile)` → mappedProfile
   - **校验**：`mappedProfile.providerId` 和 `mappedProfile.displayName` 必须为非空字符串，否则记录错误（`step: "map_profile"`）
4. 业务逻辑（绑定/登录）不变

**错误重定向目标**：根据 `action` 区分 — `action=login` 时跳转 `/login?oauth=error`，`action=bind` 时跳转 `/home?oauth=error`，保持与绑定成功（`/home?oauth=bind-success`）的目标页面一致。

删除：凭据读取、`hasExchangeHook`/`hasFetchHook` 条件判断、`defaultExchangeToken`/`defaultFetchProfile` 兜底调用。

### `server/utils/oauth.ts`

- `OAuthProviderDescriptor` 缩减为 4 字段
- 删除 `OAuthExchangeTokenArgs`、`OAuthFetchProfileArgs`、`OAuthTokenResult` 类型
- 删除 `defaultExchangeToken`、`defaultFetchProfile` 函数（逻辑搬到 Worker 侧 `ctx.oauth`）
- 删除 `authorize.params` 相关代码
- 保留：`OAuthMappedProfile`、`OAuthStateData`、state 管理函数、`buildCallbackUrl`

### `server/utils/plugin/types.ts`

`KNOWN_FUNCTIONAL_HOOKS` 新增 `"oauth:authorize"`。

### `server/utils/plugin/plugin-manager.ts`

`discoverOAuthProviders` 中验证逻辑：
- 检查返回值有 `id` 和 `name`
- 检查该插件在 `hookRegistry` 中是否同时注册了 `oauth:authorize`、`oauth:exchange-token`、`oauth:fetch-profile`、`oauth:map-profile` 四个 hook，缺少任一则跳过并记录错误日志（包含缺失的 hook 名称）

### `server/worker/plugin-host.ts`

构建 `ctx` 时新增 `ctx.oauth` 对象，包含 `exchangeToken` 和 `fetchProfile` 两个工具函数。

## 插件侧改动

所有 5 个 OAuth 插件（github、google、microsoft、discord、apple）需要重写：

### plugin.yaml 变化

hooks 列表从 2-4 个统一为 5 个：

```yaml
hooks:
  - oauth:provider
  - oauth:authorize
  - oauth:exchange-token
  - oauth:fetch-profile
  - oauth:map-profile
```

### 标准提供商示例（GitHub）

```javascript
export function setup(ctx) {
  const config = ctx.config.getAll();

  ctx.hook("oauth:provider", () => ({
    id: "github",
    name: "GitHub",
    icon: "data:image/svg+xml;base64,...",
    brandColor: "#24292e",
  }));

  ctx.hook("oauth:authorize", ({ redirectUri, state }) => {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: "read:user",
      state,
      response_type: "code",
    });
    return { url: `https://github.com/login/oauth/authorize?${params}` };
  });

  ctx.hook("oauth:exchange-token", ({ code, redirectUri }) =>
    ctx.oauth.exchangeToken("https://github.com/login/oauth/access_token", {
      code, redirectUri,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    })
  );

  ctx.hook("oauth:fetch-profile", ({ accessToken, tokenType }) =>
    ctx.oauth.fetchProfile("https://api.github.com/user", {
      accessToken, tokenType,
      headers: { Accept: "application/vnd.github+json" },
    })
  );

  ctx.hook("oauth:map-profile", (raw) => ({
    providerId: String(raw.id),
    displayName: raw.login,
  }));
}
```

### 非标准提供商示例（Apple）

Apple 不使用 `ctx.oauth` 工具函数，完全自定义：

- `oauth:authorize`：拼接 URL 时加 `response_mode=form_post`
- `oauth:exchange-token`：动态生成 JWT client_secret，自行 fetch token 端点，返回 id_token 作为 accessToken
- `oauth:fetch-profile`：解码 id_token JWT payload
- `oauth:map-profile`：映射 `sub` → `providerId`，`email` → `displayName`

**语义复用说明**：在 Apple 这类非标准流程中，`oauth:exchange-token` 返回的 `accessToken` 字段实际携带的是 id_token 原始值（而非 OAuth access token），`tokenType` 对 `oauth:fetch-profile` 也无实际意义。这是插件两端自行约定的内部协议，属于合法的设计模式 — 平台不解读这些字段的语义，只做透传。

## 端到端数据流

```
用户点击 "GitHub 登录"
        │
        ▼
 ┌─ authorize.get.ts ──────────────────────────────────┐
 │  1. 校验 action (bind/login)                         │
 │  2. bind 时检查登录态 + 重复绑定                       │
 │  3. createOAuthState({ action, userId, providerId }) │
 │  4. callPluginHook("oauth:authorize",                │
 │       { redirectUri, state })                        │
 │  5. 校验 result.url 非空且 https:// 开头              │
 │  6. 302 → result.url                                │
 └─────────────────────────────────────────────────────┘
        │
        ▼  用户在第三方完成授权
        │
        ▼
 ┌─ callback.get/post.ts ──────────────────────────────┐
 │  1. 提取 code/state/error (GET query 或 POST body)  │
 │  2. consumeOAuthState(state)                        │
 │  3. callPluginHook("oauth:exchange-token",           │
 │       { code, redirectUri })                        │
 │     → 校验 accessToken 非空，tokenType 默认 "Bearer" │
 │  4. callPluginHook("oauth:fetch-profile",            │
 │       { accessToken, tokenType })                   │
 │     → rawProfile                                    │
 │  5. callPluginHook("oauth:map-profile", rawProfile)  │
 │     → 校验 providerId 和 displayName 非空            │
 │  6. bind → addOAuthBinding / login → createSession  │
 │                                                      │
 │  错误跳转: login→/login?oauth=error                  │
 │            bind→/home?oauth=error                    │
 └─────────────────────────────────────────────────────┘
```

## 平台职责边界

- 管 state（创建/消费/CSRF 防护）
- 管 redirectUri（基于 `IRMIN_YGGDRASIL_BASE_URL` 构建）
- 管业务逻辑（绑定/登录/session 创建）
- **不碰** OAuth 协议细节（URL 拼接、凭据、scope、token 交换、profile 获取）

## 涉及修改的文件

| 文件 | 改动 |
|---|---|
| `server/utils/oauth.ts` | `OAuthProviderDescriptor` 缩减为 4 字段；删除 `defaultExchangeToken`/`defaultFetchProfile` 及相关类型 |
| `server/utils/oauth-callback.ts` | 删除凭据读取和条件分支，3 个 hook 直接调用 |
| `server/api/oauth/[providerId]/authorize.get.ts` | 删除凭据校验和 URL 拼接，改为调 `oauth:authorize` hook |
| `server/utils/plugin/types.ts` | `KNOWN_FUNCTIONAL_HOOKS` 新增 `oauth:authorize` |
| `server/utils/plugin/plugin-manager.ts` | `discoverOAuthProviders` 简化验证逻辑 |
| `server/worker/plugin-host.ts` | `ctx` 新增 `oauth.exchangeToken` / `oauth.fetchProfile` 工具函数 |
| `irminsul-data/plugins/github-oauth/*` | 重写适配新 hook 体系 |
| `irminsul-data/plugins/google-oauth/*` | 重写适配新 hook 体系 |
| `irminsul-data/plugins/microsoft-oauth/*` | 重写适配新 hook 体系 |
| `irminsul-data/plugins/discord-oauth/*` | 重写适配新 hook 体系 |
| `irminsul-data/plugins/apple-oauth/*` | 重写适配新 hook 体系 |
