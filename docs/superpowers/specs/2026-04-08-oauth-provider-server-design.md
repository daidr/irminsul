# OAuth 授权服务器设计

## 概述

将 Irminsul 扩展为 OAuth 2.1 授权服务器，允许第三方应用通过 Irminsul 鉴权并获取玩家数据。支持 Authorization Code + PKCE、Client Credentials 两种授权模式，不透明 Token，独立数据模型。

**与现有 OAuth 的区别：** 现有 `server/api/oauth/` 是 OAuth 消费者（用户通过第三方登录 Irminsul）。本设计是 OAuth 提供者（第三方通过 Irminsul 鉴权获取玩家数据）。

## 需求摘要

- **应用创建权限**：管理员 + 经管理员标记的开发者
- **开发者指定方式**：管理员直接在后台将用户标记为开发者，无申请流程
- **应用审批**：二级制（已审批 / 未审批），未审批应用不可使用
- **数据范围**：基础档案（uuid、gameId、skin、cape）+ 账户信息（email、注册时间等）+ 写操作（上传/删除材质）
- **Grant Types**：Authorization Code + 强制 PKCE（公开客户端）、Client Credentials、Refresh Token
- **Token 格式**：不透明 Token（Opaque），SHA-256 哈希后存储
- **静默授权**：用户已授权过相同 scope 时自动跳转，用户可在设置中撤销
- **Rate Limiting**：暂不实现，后续根据需要再加

## 数据模型

### 用户文档扩展

在 `UserDocument` 上新增字段：

```typescript
isDeveloper: boolean;  // 默认 false，管理员可标记
```

### `oauth_apps` 集合 — OAuth 应用

```typescript
interface OAuthAppDocument {
  _id: ObjectId;
  clientId: string;           // 随机生成的公开标识（32 位 hex）
  clientSecretHash: string;   // Argon2id 哈希后的 secret（仅机密客户端有）
  type: "confidential" | "public";  // 机密客户端（有后端）/ 公开客户端（SPA/移动端）
  name: string;               // 应用名称
  description: string;        // 应用描述
  icon: string | null;        // 应用图标 URL（可选）
  redirectUris: string[];     // 允许的回调地址列表
  scopes: string[];           // 申请使用的 scope 列表
  ownerId: string;            // 所有者 uuid（开发者或管理员）
  approved: boolean;          // 管理员审批状态
  approvedBy: string | null;  // 审批人 uuid
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

索引：

| 索引 | 选项 |
|------|------|
| `{ clientId: 1 }` | unique |
| `{ ownerId: 1 }` | 按开发者查询应用列表 |
| `{ approved: 1 }` | 筛选待审批应用 |

### 授权码 — Redis 存储

Key 格式：`{redisScope}:oauth:code:{codeHash}`，TTL = 60 秒。

```typescript
interface OAuthAuthorizationCode {
  clientId: string;
  userId: string;           // 授权用户 uuid
  scopes: string[];
  redirectUri: string;      // 本次使用的回调地址（需严格匹配）
  codeChallenge: string;    // PKCE challenge
  codeChallengeMethod: "S256";  // OAuth 2.1 仅支持 S256
  createdAt: number;
}
```

### `oauth_tokens` 集合 — Access Token / Refresh Token

```typescript
interface OAuthTokenDocument {
  _id: ObjectId;
  tokenHash: string;          // SHA-256 哈希后存储（不存储明文）
  type: "access" | "refresh";
  clientId: string;
  userId: string | null;      // Client Credentials 模式为 null
  scopes: string[];
  expiresAt: Date;            // access: 1 小时, refresh: 30 天
  createdAt: Date;
  revokedAt: Date | null;     // 撤销时间
  parentTokenHash: string | null;  // refresh token rotation 追踪
}
```

索引：

| 索引 | 选项 |
|------|------|
| `{ tokenHash: 1 }` | unique，token 查找 |
| `{ clientId: 1, userId: 1 }` | 按应用+用户查询 |
| `{ expiresAt: 1 }` | TTL 索引，自动清理过期 token |
| `{ revokedAt: 1, expiresAt: 1 }` | 清理已撤销 token |

### `oauth_authorizations` 集合 — 用户授权记录（静默授权用）

```typescript
interface OAuthAuthorizationDocument {
  _id: ObjectId;
  clientId: string;
  userId: string;
  scopes: string[];          // 已授权的 scope 列表
  grantedAt: Date;
  updatedAt: Date;
}
```

索引：

| 索引 | 选项 |
|------|------|
| `{ clientId: 1, userId: 1 }` | unique，查询用户是否已授权 |
| `{ userId: 1 }` | 用户查看/撤销自己的授权 |

### Scope 定义

| Scope | 描述 | 包含数据 |
|-------|------|----------|
| `profile:read` | 读取基础档案 | uuid, gameId, skin, cape |
| `profile:write` | 修改材质 | 上传/删除 skin, cape |
| `email:read` | 读取邮箱 | email, emailVerified |
| `account:read` | 读取账户信息 | 注册时间、封禁状态等 |

Client Credentials 模式仅允许 `profile:read`。

## OAuth 2.1 协议端点

### 端点总览

所有端点放在 `server/api/oauth-provider/` 下。

| 端点 | 方法 | 用途 | 认证 |
|------|------|------|------|
| `/api/oauth-provider/authorize` | GET | 授权端点，展示确认页或静默跳转 | 需要用户 session |
| `/api/oauth-provider/authorize` | POST | 用户确认授权，生成授权码并重定向 | 需要用户 session |
| `/api/oauth-provider/token` | POST | 令牌端点 | 客户端认证 |
| `/api/oauth-provider/revoke` | POST | 撤销 token（RFC 7009） | 客户端认证 |
| `/api/oauth-provider/userinfo` | GET | 获取当前授权用户信息 | Bearer token |
| `/api/oauth-provider/.well-known/openid-configuration` | GET | 服务发现元数据 | 无 |

### Authorization Code + PKCE 流程

```
第三方应用                    Irminsul                        用户浏览器
    |                            |                               |
    |--- 重定向到 /authorize --->|                               |
    |   ?response_type=code      |                               |
    |   &client_id=xxx           |                               |
    |   &redirect_uri=xxx        |--- 检查用户 session ---------->|
    |   &scope=profile:read      |    (未登录则跳登录页)          |
    |   &code_challenge=xxx      |                               |
    |   &code_challenge_method=S256                               |
    |   &state=xxx               |                               |
    |                            |--- 检查是否已授权相同 scope -->|
    |                            |    已授权: 静默生成 code       |
    |                            |    未授权: 展示确认页          |
    |                            |                               |
    |                            |<-- 用户点击「授权」(POST) ----|
    |                            |--- 生成 code, 存 Redis ------>|
    |<-- 重定向 redirect_uri ----|    TTL=60s                     |
    |   ?code=xxx&state=xxx      |                               |
    |                            |                               |
    |--- POST /token ----------->|                               |
    |   grant_type=              |                               |
    |     authorization_code     |                               |
    |   &code=xxx                |--- 验证 code + PKCE --------->|
    |   &code_verifier=xxx       |--- 生成 access + refresh ---->|
    |   &redirect_uri=xxx        |--- 删除 code ----------------->|
    |<-- { access_token,         |                               |
    |      refresh_token,        |                               |
    |      expires_in, ... } ----|                               |
```

### Client Credentials 流程

```
第三方服务端                  Irminsul
    |                            |
    |--- POST /token ----------->|
    |   grant_type=              |
    |     client_credentials     |
    |   &client_id=xxx           |--- 验证 clientId + secret
    |   &client_secret=xxx       |--- 检查 type=confidential
    |   &scope=profile:read      |--- 仅允许 profile:read
    |<-- { access_token,         |
    |      expires_in, ... } ----|   (无 refresh token)
```

### Refresh Token Rotation

每次使用 refresh token 换取新 access token 时，同时颁发新的 refresh token，旧 refresh token 立即失效。如果检测到已撤销的 refresh token 被重复使用（重放攻击），立即撤销该 token 链下所有 token。通过 `parentTokenHash` 字段追踪。

### 客户端认证方式

- **机密客户端（confidential）**：`client_id` + `client_secret`（HTTP Basic 或 POST body）
- **公开客户端（public）**：仅 `client_id`，不需要 secret，但强制要求 PKCE

### 错误响应

遵循 RFC 6749 §5.2 标准格式：

```json
{
  "error": "invalid_grant",
  "error_description": "Authorization code has expired"
}
```

## API 端点

### 开发者 — 应用管理

| 端点 | 方法 | 用途 | 权限 |
|------|------|------|------|
| `/api/oauth-provider/apps` | GET | 列出自己的应用 | isDeveloper |
| `/api/oauth-provider/apps` | POST | 创建应用 | isDeveloper |
| `/api/oauth-provider/apps/:clientId` | GET | 查看应用详情 | 应用所有者 |
| `/api/oauth-provider/apps/:clientId` | PATCH | 更新应用信息 | 应用所有者 |
| `/api/oauth-provider/apps/:clientId` | DELETE | 删除应用（级联撤销所有 token 和授权） | 应用所有者 |
| `/api/oauth-provider/apps/:clientId/reset-secret` | POST | 重新生成 client secret | 应用所有者（仅 confidential） |

创建应用时：
- 自动生成 `clientId`（32 位 hex）
- 机密客户端生成 `clientSecret`（48 位随机 base64url），Argon2id 哈希后存储
- `approved` 默认 `false`，需管理员审批
- Secret 仅在创建和重置时明文返回一次

### 用户 — 授权管理

| 端点 | 方法 | 用途 | 权限 |
|------|------|------|------|
| `/api/oauth-provider/authorizations` | GET | 列出我授权过的应用 | 已登录 |
| `/api/oauth-provider/authorizations/:clientId` | DELETE | 撤销对某应用的授权（级联撤销 token） | 已登录 |

### 管理员

| 端点 | 方法 | 用途 | 权限 |
|------|------|------|------|
| `/api/oauth-provider/admin/apps` | GET | 列出所有应用（支持按 approved 筛选） | isAdmin |
| `/api/oauth-provider/admin/apps/:clientId/approve` | POST | 审批应用 | isAdmin |
| `/api/oauth-provider/admin/apps/:clientId/revoke-approval` | POST | 撤销审批（级联撤销所有 token） | isAdmin |
| `/api/oauth-provider/admin/apps/:clientId` | DELETE | 强制删除应用 | isAdmin |
| `/api/oauth-provider/admin/developers/:uuid` | POST | 标记用户为开发者 | isAdmin |
| `/api/oauth-provider/admin/developers/:uuid` | DELETE | 撤销开发者身份 | isAdmin |

### 资源端点（第三方应用调用）

| 端点 | 方法 | 用途 | 所需 scope |
|------|------|------|------------|
| `/api/oauth-provider/userinfo` | GET | 当前用户信息（由 scope 决定返回字段） | 任意 |
| `/api/oauth-provider/resources/profile/:uuid` | GET | 查询指定玩家公开档案 | `profile:read` |
| `/api/oauth-provider/resources/profile/:uuid/skin` | PUT | 上传皮肤 | `profile:write` |
| `/api/oauth-provider/resources/profile/:uuid/skin` | DELETE | 删除皮肤 | `profile:write` |
| `/api/oauth-provider/resources/profile/:uuid/cape` | PUT | 上传披风 | `profile:write` |
| `/api/oauth-provider/resources/profile/:uuid/cape` | DELETE | 删除披风 | `profile:write` |

`profile:write` 端点校验 Bearer token 的 `userId` 必须与 `:uuid` 一致。Client Credentials token（无 userId）不能访问写端点。

## 前端页面

### 新增页面

| 页面路由 | 用途 | 访问权限 |
|----------|------|----------|
| `/oauth/authorize` | OAuth 授权确认页 | 已登录用户 |
| `/developer/apps` | 开发者应用列表 | isDeveloper |
| `/developer/apps/new` | 创建新应用 | isDeveloper |
| `/developer/apps/:clientId` | 应用详情与编辑 | 应用所有者 |
| `/settings/authorizations` | 我授权过的第三方应用列表 | 已登录用户 |
| `/admin/oauth-apps` | 管理员审批应用列表 | isAdmin |
| `/admin/users/:uuid`（现有页面扩展） | 添加「标记为开发者」按钮 | isAdmin |

### 授权确认页 (`/oauth/authorize`)

从 GET `/api/oauth-provider/authorize` 重定向而来（未授权过的情况）。

页面内容：
- 应用图标 + 名称 + 描述
- 请求的权限列表（scope 的人类可读描述）
- 当前登录用户的 gameId 和头像
- 「授权」和「拒绝」两个按钮
- 拒绝时重定向回 `redirect_uri` 并携带 `error=access_denied`

实现：GET `/api/oauth-provider/authorize` 检测到需要用户确认时，重定向到 `/oauth/authorize?client_id=...&scope=...&state=...&...`，用户点击授权按钮 POST 到 `/api/oauth-provider/authorize`。

### 开发者应用管理页

- 应用列表：名称、类型、审批状态、创建时间
- 创建表单：名称、描述、类型选择、回调地址（支持多个）、请求的 scope（多选）
- 创建成功后 modal 展示 `clientId` 和 `clientSecret`（仅此一次）
- 详情页可编辑信息、重置 secret、删除应用
- 未审批应用标注「等待管理员审批」

### 用户授权管理页 (`/settings/authorizations`)

- 列出已授权的第三方应用：名称、图标、scope、授权时间
- 每项有「撤销」按钮

### 管理员审批页 (`/admin/oauth-apps`)

- 待审批和已审批应用列表（tab 或筛选切换）
- 审批 / 撤销审批操作

### 导航入口

- `isDeveloper` 用户显示「开发者」入口
- 用户设置页增加「第三方应用授权」入口
- 管理后台增加「OAuth 应用管理」入口

## 安全机制

### 客户端 Secret 管理

- `crypto.randomBytes(36).toString('base64url')` 生成（48 字符）
- Argon2id 哈希存储，`Bun.password.verify` 验证
- 仅在创建和重置时返回明文

### 授权码安全

- `crypto.randomBytes(32).toString('base64url')` 生成
- Redis 中以 SHA-256 哈希为 key 存储
- TTL = 60 秒，使用后立即删除
- 严格绑定 `redirect_uri`

### PKCE 强制策略

- 公开客户端：强制 PKCE
- 机密客户端：建议但不强制
- 仅支持 `S256`，不支持 `plain`

### Token 安全

- Access / refresh token 均以 SHA-256 哈希存储
- `crypto.randomBytes(32).toString('base64url')` 生成
- Access token 有效期 1 小时，refresh token 30 天
- Refresh token rotation：每次刷新颁发新 token，旧的立即失效

### 重放攻击检测

已撤销的 refresh token 被使用时，立即撤销该 token 链上所有 token（通过 `parentTokenHash` 追溯），并撤销该用户对该应用的所有 token。

### 边界情况

| 场景 | 处理方式 |
|------|----------|
| 用户未登录访问 `/oauth/authorize` | 重定向到登录页，登录后回到授权页 |
| `redirect_uri` 不在注册列表中 | 直接显示错误页（不重定向，防止 open redirect） |
| 应用未审批 | 授权端点返回错误，不展示确认页 |
| 请求的 scope 超出应用注册范围 | 返回 `invalid_scope` 错误 |
| 用户被封禁 | 不影响 OAuth 授权（ban 仅限制 Yggdrasil） |
| 开发者身份被撤销 | 已有应用保留可用，不能创建新应用 |
| 应用被删除 | 级联撤销所有 token，删除所有授权记录 |
| 应用审批被撤销 | 级联撤销所有 token，授权记录保留 |

### CORS

OAuth 资源端点支持跨域（安全性由 Bearer token 保证）：

- `/api/oauth-provider/token` — 允许跨域 POST
- `/api/oauth-provider/userinfo` — 允许跨域 GET
- `/api/oauth-provider/resources/**` — 允许跨域
- 响应头：`Access-Control-Allow-Origin: *`

## Settings 扩展

新增内置配置项：

| Key | 默认值 | 描述 |
|-----|--------|------|
| `oauth.enabled` | `false` | 是否启用 OAuth 提供者功能 |
| `oauth.accessTokenTtlMs` | `3600000` (1h) | Access token 有效期 |
| `oauth.refreshTokenTtlMs` | `2592000000` (30d) | Refresh token 有效期 |
| `oauth.authorizationCodeTtlS` | `60` | 授权码有效期（秒） |

`oauth.enabled` 为 `false` 时，所有 OAuth 提供者端点返回 503，前端隐藏相关入口（管理后台仍可访问用于预配置）。

## 服务发现

`GET /api/oauth-provider/.well-known/openid-configuration`：

```json
{
  "issuer": "{yggdrasilBaseUrl}",
  "authorization_endpoint": "{yggdrasilBaseUrl}/oauth/authorize",
  "token_endpoint": "{yggdrasilBaseUrl}/api/oauth-provider/token",
  "revocation_endpoint": "{yggdrasilBaseUrl}/api/oauth-provider/revoke",
  "userinfo_endpoint": "{yggdrasilBaseUrl}/api/oauth-provider/userinfo",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "client_credentials", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["profile:read", "profile:write", "email:read", "account:read"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "none"]
}
```

## 数据库初始化

在 `server/plugins/server-startup.ts` 初始化流程中，新增 `oauth_apps`、`oauth_tokens`、`oauth_authorizations` 三个集合的索引创建，放在并行初始化阶段。
