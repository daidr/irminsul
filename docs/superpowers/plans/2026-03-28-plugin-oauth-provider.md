# Plugin OAuth Provider 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展插件系统支持 OAuth Provider 注册，使插件可以为用户提供第三方账号绑定和快捷登录能力，并实现一个 GitHub OAuth 示例插件。

**Architecture:** 新增 4 个 OAuth 相关 Hook 类型，宿主在 `PluginManager` 中实现 provider discovery 和 hook 桥接。新增 `server/utils/oauth.ts` 封装 OAuth 状态管理和默认流程。4 条 Nitro API 路由处理 OAuth 授权/回调/解绑。前端登录页和 Home 页动态渲染 OAuth 按钮和绑定管理。

**Tech Stack:** Nuxt 4 / Nitro / MongoDB / Redis / Bun Worker IPC / Vue 3 Composition API / DaisyUI v5

---

## 文件总览

### 新建文件

| 文件 | 职责 |
|------|------|
| `server/utils/oauth.ts` | OAuth 工具函数（state 管理、默认 token 交换、默认 profile 获取、provider 查询） |
| `server/api/oauth/providers.get.ts` | 列出可用 OAuth Provider |
| `server/api/oauth/[providerId]/authorize.get.ts` | 发起 OAuth 授权重定向 |
| `server/api/oauth/[providerId]/callback.get.ts` | 处理 OAuth 回调 |
| `server/api/oauth/[providerId]/unbind.post.ts` | 解绑 OAuth 账号 |
| `app/components/OAuthButtons.vue` | 登录页 OAuth 方形图标按钮组 |
| `app/components/OAuthBindings.vue` | Home 页 OAuth 绑定管理卡片 |
| `tests/utils/oauth.test.ts` | OAuth 工具函数单元测试 |
| `irminsul-data/plugins/github-oauth/plugin.yaml` | GitHub OAuth 示例插件清单 |
| `irminsul-data/plugins/github-oauth/index.js` | GitHub OAuth 示例插件入口 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `server/utils/plugin/types.ts` | 在 `KNOWN_FUNCTIONAL_HOOKS` 中添加 4 个 OAuth hook |
| `server/types/user.schema.ts` | 添加 `OAuthBinding` 接口和 `UserDocument.oauthBindings` 字段 |
| `server/utils/user.repository.ts` | 添加 OAuth 绑定相关的索引和 CRUD 方法 |
| `server/utils/plugin/plugin-manager.ts` | 添加 `discoverOAuthProviders()` 方法，在 `start()` 末尾调用 |
| `server/middleware/01.session.ts` | 在 `event.context.user` 中加入 `oauthBindings` |
| `app/pages/login.vue` | 引入 `OAuthButtons` 组件 + 处理 OAuth query param toast |
| `app/components/HomePage.vue` | 引入 `OAuthBindings` 组件 + 添加 OAuth 相关 modal type |
| `app/components/ShortcutCard.vue` | 添加"账号绑定"快捷入口（可选，后续判断） |

---

### Task 1: 注册 OAuth Hook 类型

**Files:**
- Modify: `server/utils/plugin/types.ts:167-170`

- [ ] **Step 1: 在 `KNOWN_FUNCTIONAL_HOOKS` 中添加 OAuth hook**

```typescript
// server/utils/plugin/types.ts — 替换 lines 167-170
export const KNOWN_FUNCTIONAL_HOOKS = [
  "evlog:enricher",
  "evlog:drain",
  "oauth:provider",
  "oauth:map-profile",
  "oauth:exchange-token",
  "oauth:fetch-profile",
] as const;
```

- [ ] **Step 2: 验证现有测试仍然通过**

Run: `bun run test -- --run tests/utils/plugin.hook-registry.test.ts`
Expected: 所有测试 PASS（hook-registry 不依赖具体 hook 名称）

- [ ] **Step 3: 提交**

```bash
git add server/utils/plugin/types.ts
git commit -m "feat(plugin): register oauth hook types in KNOWN_FUNCTIONAL_HOOKS"
```

---

### Task 2: 数据模型 — OAuthBinding 类型和 User 文档变更

**Files:**
- Modify: `server/types/user.schema.ts:89-146`

- [ ] **Step 1: 在 `PasskeyRecord` 接口后添加 `OAuthBinding` 接口**

在 `server/types/user.schema.ts` 的 `PasskeyRecord` 接口结束（第 89 行 `}` 之后）和 `UserDocument` 接口开始（第 91 行 `/**` 之前）之间插入：

```typescript
/**
 * OAuth 第三方账号绑定记录
 */
export interface OAuthBinding {
  /** Provider ID（如 "github"），由插件定义 */
  provider: string;
  /** 用户在第三方平台的唯一 ID（字符串化） */
  providerId: string;
  /** 第三方平台显示名 */
  displayName: string;
  /** 绑定时间 */
  boundAt: Date;
}
```

- [ ] **Step 2: 在 `UserDocument` 中添加 `oauthBindings` 字段**

在 `passkeys: PasskeyRecord[];`（第 128 行）后插入：

```typescript
  /** OAuth 第三方账号绑定列表 */
  oauthBindings: OAuthBinding[];
```

- [ ] **Step 3: 提交**

```bash
git add server/types/user.schema.ts
git commit -m "feat: add OAuthBinding type and oauthBindings field to UserDocument"
```

---

### Task 3: User Repository — OAuth 绑定索引和 CRUD

**Files:**
- Modify: `server/utils/user.repository.ts`
- Test: `tests/utils/oauth.test.ts`

- [ ] **Step 1: 编写 OAuth repository 方法的测试**

创建 `tests/utils/oauth.test.ts`：

```typescript
import { describe, it, expect } from "vitest";

// 这些是纯逻辑测试，验证方法签名和返回类型
// 实际的 MongoDB 集成需要运行环境，此处用 todo 占位
describe("OAuth Repository Methods", () => {
  it.todo("addOAuthBinding adds a binding to user document");
  it.todo("addOAuthBinding rejects duplicate provider for same user");
  it.todo("removeOAuthBinding removes matching provider binding");
  it.todo("findUserByOAuthBinding finds user by provider+providerId");
  it.todo("findUserByOAuthBinding returns null for unbound provider");
});
```

- [ ] **Step 2: 在 `user.repository.ts` 顶部导入 `OAuthBinding` 类型**

在 `server/utils/user.repository.ts` 第 3-8 行的 import 中添加 `OAuthBinding`：

```typescript
import type {
  UserDocument,
  UserSkin,
  UserCape,
  YggdrasilToken,
  PasskeyRecord,
  OAuthBinding,
} from "~~/server/types/user.schema";
```

- [ ] **Step 3: 在 `ensureUserIndexes()` 中添加 OAuth 绑定索引**

在 `server/utils/user.repository.ts` 的 `ensureUserIndexes()` 函数内，`passkeys.credentialId` 索引之后（约第 31 行之后）添加：

```typescript
  await col.createIndex(
    { "oauthBindings.provider": 1, "oauthBindings.providerId": 1 },
    { unique: true, sparse: true },
  );
```

- [ ] **Step 4: 在 `findUserForSession()` 的投影中添加 `oauthBindings`**

修改 `server/utils/user.repository.ts` 的 `findUserForSession` 函数。

将投影从：
```typescript
    { projection: { skin: 1, cape: 1, bans: 1, time: 1, isAdmin: 1, emailVerified: 1 } },
```
改为：
```typescript
    { projection: { skin: 1, cape: 1, bans: 1, time: 1, isAdmin: 1, emailVerified: 1, oauthBindings: 1 } },
```

同时更新返回类型 Pick，在泛型参数中添加 `"oauthBindings"`：
```typescript
export async function findUserForSession(
  uuid: string,
): Promise<Pick<
  UserDocument,
  "skin" | "cape" | "bans" | "time" | "isAdmin" | "emailVerified" | "oauthBindings"
> | null> {
  return getUserCollection().findOne(
    { uuid },
    { projection: { skin: 1, cape: 1, bans: 1, time: 1, isAdmin: 1, emailVerified: 1, oauthBindings: 1 } },
  ) as Promise<Pick<
    UserDocument,
    "skin" | "cape" | "bans" | "time" | "isAdmin" | "emailVerified" | "oauthBindings"
  > | null>;
}
```

- [ ] **Step 5: 在文件末尾添加 OAuth 绑定 CRUD 方法**

在 `server/utils/user.repository.ts` 文件末尾添加：

```typescript
// --- OAuth 绑定 ---

/**
 * 添加 OAuth 绑定（每个 provider 只允许绑定一个账号）
 * 使用 $push + 过滤条件确保不重复绑定同一 provider
 */
export async function addOAuthBinding(uuid: string, binding: OAuthBinding): Promise<boolean> {
  const result = await getUserCollection().updateOne(
    { uuid, "oauthBindings.provider": { $ne: binding.provider } },
    { $push: { oauthBindings: binding } },
  );
  return result.modifiedCount > 0;
}

/**
 * 解绑 OAuth 账号
 */
export async function removeOAuthBinding(uuid: string, provider: string): Promise<boolean> {
  const result = await getUserCollection().updateOne(
    { uuid },
    { $pull: { oauthBindings: { provider } } },
  );
  return result.modifiedCount > 0;
}

/**
 * 按 provider + providerId 查找用户（用于 OAuth 登录）
 */
export async function findUserByOAuthBinding(
  provider: string,
  providerId: string,
): Promise<UserDocument | null> {
  return getUserCollection().findOne({
    "oauthBindings.provider": provider,
    "oauthBindings.providerId": providerId,
  });
}
```

- [ ] **Step 6: 验证 lint 通过**

Run: `bun run lint`
Expected: 无新错误

- [ ] **Step 7: 提交**

```bash
git add server/utils/user.repository.ts server/types/user.schema.ts tests/utils/oauth.test.ts
git commit -m "feat: add OAuth binding index and CRUD methods to user repository"
```

---

### Task 4: Session Middleware — 暴露 oauthBindings 到客户端

**Files:**
- Modify: `server/middleware/01.session.ts:18-29`

- [ ] **Step 1: 在 `event.context.user` 中添加 `oauthBindings`**

在 `server/middleware/01.session.ts` 的 `event.context.user` 对象中，`needsEmailVerification` 行之后添加 `oauthBindings`：

```typescript
  event.context.user = {
    ...sessionData,
    skinHash,
    skinSlim: userDoc?.skin?.type === 1,
    hasCustomSkin: !!userDoc?.skin?.hash,
    capeHash: userDoc?.cape?.hash ?? undefined,
    registerAt: userDoc?.time.register.getTime() ?? null,
    bans,
    isAdmin: userDoc?.isAdmin === true,
    emailVerified,
    needsEmailVerification: !!requireEmailVerification && !emailVerified,
    oauthBindings: (userDoc?.oauthBindings ?? []).map((b) => ({
      provider: b.provider,
      providerId: b.providerId,
      displayName: b.displayName,
      boundAt: b.boundAt.getTime(),
    })),
  };
```

- [ ] **Step 2: 提交**

```bash
git add server/middleware/01.session.ts
git commit -m "feat: expose oauthBindings in session context for client access"
```

---

### Task 5: OAuth 工具函数

**Files:**
- Create: `server/utils/oauth.ts`
- Test: `tests/utils/oauth.test.ts`（追加测试）

- [ ] **Step 1: 编写 OAuth state 管理和默认流程的测试**

在 `tests/utils/oauth.test.ts` 中追加（由于依赖 Redis 和 PluginManager，这些是 todo 占位）：

```typescript
describe("OAuth Utils", () => {
  it.todo("createOAuthState stores state in Redis with TTL");
  it.todo("consumeOAuthState retrieves and deletes state");
  it.todo("consumeOAuthState returns null for expired/missing state");
  it.todo("defaultExchangeToken sends POST with correct params");
  it.todo("defaultFetchProfile sends GET with Authorization header");
  it.todo("buildCallbackUrl constructs correct URL from runtime config");
});
```

- [ ] **Step 2: 创建 `server/utils/oauth.ts`**

```typescript
import { randomUUID } from "node:crypto";
import { createLogger } from "evlog";
import { getPluginManager } from "./plugin/plugin-manager";

// === Types ===

export interface OAuthProviderDescriptor {
  id: string;
  name: string;
  icon: string;
  brandColor: string;
  authorize: {
    url: string;
    scopes: string[];
  };
  token: {
    url: string;
  };
  userInfo?: {
    url: string;
    headers?: Record<string, string>;
  };
}

export interface OAuthMappedProfile {
  providerId: string;
  displayName: string;
}

export interface OAuthExchangeTokenArgs {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}

export interface OAuthTokenResult {
  accessToken: string;
  tokenType?: string;
}

export interface OAuthFetchProfileArgs {
  accessToken: string;
  tokenType: string;
}

interface OAuthStateData {
  action: "bind" | "login";
  userId?: string;
  providerId: string;
}

// === State ===

const OAUTH_STATE_TTL = 300; // 5 minutes

export async function createOAuthState(data: OAuthStateData): Promise<string> {
  const state = randomUUID().replace(/-/g, "");
  const redis = getRedisClient();
  const key = buildRedisKey("oauth", "state", state);
  await redis.set(key, JSON.stringify(data), { EX: OAUTH_STATE_TTL });
  return state;
}

export async function consumeOAuthState(state: string): Promise<OAuthStateData | null> {
  const redis = getRedisClient();
  const key = buildRedisKey("oauth", "state", state);
  const raw = await redis.getdel(key);
  if (!raw) return null;
  return JSON.parse(raw) as OAuthStateData;
}

// === Provider Discovery ===

/** 缓存的 provider 列表，由 discoverOAuthProviders 填充 */
let oauthProviders: Map<string, { descriptor: OAuthProviderDescriptor; pluginId: string }> = new Map();

export function setOAuthProviders(
  providers: Map<string, { descriptor: OAuthProviderDescriptor; pluginId: string }>,
): void {
  oauthProviders = providers;
}

export function getOAuthProviders(): OAuthProviderDescriptor[] {
  return [...oauthProviders.values()].map((p) => p.descriptor);
}

export function getOAuthProvider(
  id: string,
): { descriptor: OAuthProviderDescriptor; pluginId: string } | null {
  return oauthProviders.get(id) ?? null;
}

// === Default OAuth 2.0 Flow ===

export async function defaultExchangeToken(
  tokenUrl: string,
  args: OAuthExchangeTokenArgs,
): Promise<OAuthTokenResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    client_secret: args.clientSecret,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const accessToken = data.access_token as string;
  if (!accessToken) {
    throw new Error("Token exchange response missing access_token");
  }

  return {
    accessToken,
    tokenType: (data.token_type as string) ?? "Bearer",
  };
}

export async function defaultFetchProfile(
  userInfoUrl: string,
  accessToken: string,
  tokenType: string,
  headers?: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(userInfoUrl, {
    headers: {
      Authorization: `${tokenType} ${accessToken}`,
      Accept: "application/json",
      ...headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`User info fetch failed (${res.status}): ${text}`);
  }

  return res.json();
}

// === URL Builder ===

export function buildCallbackUrl(providerId: string): string {
  const config = useRuntimeConfig();
  const baseUrl = (config.yggdrasilBaseUrl as string).replace(/\/+$/, "");
  return `${baseUrl}/api/oauth/${providerId}/callback`;
}
```

- [ ] **Step 3: 验证 lint 通过**

Run: `bun run lint`
Expected: 无新错误

- [ ] **Step 4: 提交**

```bash
git add server/utils/oauth.ts tests/utils/oauth.test.ts
git commit -m "feat: add OAuth utility functions for state, token exchange, and profile fetch"
```

---

### Task 6: PluginManager — OAuth Provider Discovery 和 Hook 桥接

**Files:**
- Modify: `server/utils/plugin/plugin-manager.ts`

- [ ] **Step 1: 在 `plugin-manager.ts` 中导入 OAuth 类型**

在 `server/utils/plugin/plugin-manager.ts` 顶部的导入区域添加：

```typescript
import type { OAuthProviderDescriptor } from "../oauth";
import { setOAuthProviders } from "../oauth";
```

- [ ] **Step 2: 在 `bridgeEvlogHooks()` 方法之后添加 `discoverOAuthProviders()` 方法**

在 `server/utils/plugin/plugin-manager.ts` 的 `bridgeEvlogHooks()` 方法结束（约第 497 行 `}` 后）插入：

```typescript
  // === OAuth Provider Discovery ===

  async discoverOAuthProviders(): Promise<void> {
    const providers = new Map<string, { descriptor: OAuthProviderDescriptor; pluginId: string }>();
    const handlers = this.hookRegistry.get("oauth:provider");

    for (const handler of handlers) {
      try {
        const descriptor = (await this.bridge.callHook(
          handler.pluginId,
          "oauth:provider",
        )) as OAuthProviderDescriptor;

        if (!descriptor?.id || !descriptor?.name) {
          this.logManager.push({
            timestamp: new Date().toISOString(),
            level: "error",
            type: "event",
            pluginId: handler.pluginId,
            message: "oauth:provider hook returned invalid descriptor (missing id or name)",
          });
          continue;
        }

        if (providers.has(descriptor.id)) {
          this.logManager.push({
            timestamp: new Date().toISOString(),
            level: "error",
            type: "event",
            pluginId: handler.pluginId,
            message: `oauth:provider id "${descriptor.id}" already registered, skipping duplicate`,
          });
          continue;
        }

        providers.set(descriptor.id, { descriptor, pluginId: handler.pluginId });
        emitPluginEvent("oauth:provider_discovered", {
          pluginId: handler.pluginId,
          providerId: descriptor.id,
          providerName: descriptor.name,
        });
      } catch (err: unknown) {
        this.logManager.push({
          timestamp: new Date().toISOString(),
          level: "error",
          type: "event",
          pluginId: handler.pluginId,
          message: `oauth:provider discovery error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    setOAuthProviders(providers);
    emitPluginEvent("oauth:discovery_complete", { count: providers.size });
  }
```

- [ ] **Step 3: 在 `start()` 方法末尾调用 discovery（确保 host restart 时也重新执行）**

在 `server/utils/plugin/plugin-manager.ts` 的 `start()` 方法末尾（`this.logManager.cleanupExpiredLogs(retentionDays);` 之后，约第 208 行后）添加：

```typescript
    // Discover OAuth providers from loaded plugins
    await this.discoverOAuthProviders();
```

这样 discovery 在首次启动和 Host restart 时都会执行。`bridgeEvlogHooks` 仍留在 `initPlugins` 中因为它注册的是永久性 nitroApp hook。

- [ ] **Step 4: 验证 lint 通过**

Run: `bun run lint`
Expected: 无新错误

- [ ] **Step 5: 提交**

```bash
git add server/utils/plugin/plugin-manager.ts
git commit -m "feat(plugin): add OAuth provider discovery in PluginManager.start()"
```

---

### Task 7: API 路由 — 列出 Provider

**Files:**
- Create: `server/api/oauth/providers.get.ts`

- [ ] **Step 1: 创建 `server/api/oauth/providers.get.ts`**

```typescript
export default defineEventHandler(() => {
  const providers = getOAuthProviders();
  return {
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      brandColor: p.brandColor,
    })),
  };
});
```

- [ ] **Step 2: 提交**

```bash
git add server/api/oauth/providers.get.ts
git commit -m "feat: add GET /api/oauth/providers endpoint"
```

---

### Task 8: API 路由 — 授权重定向

**Files:**
- Create: `server/api/oauth/[providerId]/authorize.get.ts`

- [ ] **Step 1: 创建 `server/api/oauth/[providerId]/authorize.get.ts`**

```typescript
export default defineEventHandler(async (event) => {
  const providerId = getRouterParam(event, "providerId");
  if (!providerId) {
    throw createError({ statusCode: 400, statusMessage: "Missing providerId" });
  }

  const provider = getOAuthProvider(providerId);
  if (!provider) {
    throw createError({ statusCode: 404, statusMessage: "OAuth provider not found" });
  }

  const query = getQuery(event);
  const action = query.action as string;
  if (action !== "bind" && action !== "login") {
    throw createError({ statusCode: 400, statusMessage: "Invalid action, must be 'bind' or 'login'" });
  }

  let userId: string | undefined;

  if (action === "bind") {
    const user = requireAuth(event);
    userId = user.userId;

    // 检查是否已绑定该 provider
    const existingBinding = user.oauthBindings?.find(
      (b: { provider: string }) => b.provider === providerId,
    );
    if (existingBinding) {
      return sendRedirect(event, "/home?oauth=duplicate");
    }
  }

  const state = await createOAuthState({
    action,
    userId,
    providerId,
  });

  // 读取插件配置中的 clientId
  const pluginConfig = getSetting(`plugin.custom.${provider.pluginId}.config`) as Record<string, unknown> | null;
  const clientId = pluginConfig?.clientId as string;
  if (!clientId) {
    throw createError({ statusCode: 500, statusMessage: "OAuth provider missing clientId config" });
  }

  const redirectUri = buildCallbackUrl(providerId);
  const { descriptor } = provider;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: descriptor.authorize.scopes.join(" "),
    state,
    response_type: "code",
  });

  const authorizeUrl = `${descriptor.authorize.url}?${params.toString()}`;
  return sendRedirect(event, authorizeUrl);
});
```

- [ ] **Step 2: 提交**

```bash
git add server/api/oauth/[providerId]/authorize.get.ts
git commit -m "feat: add GET /api/oauth/[providerId]/authorize endpoint"
```

---

### Task 9: API 路由 — 回调处理

**Files:**
- Create: `server/api/oauth/[providerId]/callback.get.ts`

- [ ] **Step 1: 创建 `server/api/oauth/[providerId]/callback.get.ts`**

```typescript
import { useLogger } from "evlog";
import type { SessionData } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const log = useLogger(event);
  const providerId = getRouterParam(event, "providerId");
  const query = getQuery(event);
  const code = query.code as string;
  const stateParam = query.state as string;

  if (!providerId || !code || !stateParam) {
    return sendRedirect(event, "/login?oauth=error");
  }

  // 1. 消费 state
  const stateData = await consumeOAuthState(stateParam);
  if (!stateData) {
    return sendRedirect(event, "/login?oauth=error");
  }

  if (stateData.providerId !== providerId) {
    return sendRedirect(event, "/login?oauth=error");
  }

  const provider = getOAuthProvider(providerId);
  if (!provider) {
    return sendRedirect(event, "/login?oauth=error");
  }

  const { descriptor, pluginId } = provider;

  try {
    // 2. 读取插件凭据
    const pluginConfig = getSetting(`plugin.custom.${pluginId}.config`) as Record<string, unknown> | null;
    const clientId = pluginConfig?.clientId as string;
    const clientSecret = pluginConfig?.clientSecret as string;
    if (!clientId || !clientSecret) {
      log.set({ oauth: { error: "missing_credentials", providerId } });
      return sendRedirect(event, "/login?oauth=error");
    }

    const redirectUri = buildCallbackUrl(providerId);

    // 3. Token 交换（尝试插件覆盖，回退到默认）
    const pluginManager = getPluginManager();
    const hookRegistry = pluginManager.getHookRegistry();
    const bridge = pluginManager.getBridge();

    let tokenResult: { accessToken: string; tokenType?: string };

    const exchangeHandlers = hookRegistry.get("oauth:exchange-token")
      .filter((h) => h.pluginId === pluginId);

    if (exchangeHandlers.length > 0) {
      tokenResult = (await bridge.callHook(pluginId, "oauth:exchange-token", {
        code,
        redirectUri,
        clientId,
        clientSecret,
      })) as { accessToken: string; tokenType?: string };
    } else {
      tokenResult = await defaultExchangeToken(descriptor.token.url, {
        code,
        redirectUri,
        clientId,
        clientSecret,
      });
    }

    // 4. 获取用户信息（尝试插件覆盖，回退到默认）
    let rawProfile: unknown;

    const fetchProfileHandlers = hookRegistry.get("oauth:fetch-profile")
      .filter((h) => h.pluginId === pluginId);

    if (fetchProfileHandlers.length > 0) {
      rawProfile = await bridge.callHook(pluginId, "oauth:fetch-profile", {
        accessToken: tokenResult.accessToken,
        tokenType: tokenResult.tokenType ?? "Bearer",
      });
    } else if (descriptor.userInfo) {
      rawProfile = await defaultFetchProfile(
        descriptor.userInfo.url,
        tokenResult.accessToken,
        tokenResult.tokenType ?? "Bearer",
        descriptor.userInfo.headers,
      );
    } else {
      log.set({ oauth: { error: "no_userinfo_and_no_fetch_hook", providerId } });
      return sendRedirect(event, "/login?oauth=error");
    }

    // 5. 映射 Profile
    const mappedProfile = (await bridge.callHook(
      pluginId,
      "oauth:map-profile",
      rawProfile,
    )) as { providerId: string; displayName: string } | null;

    if (!mappedProfile?.providerId || !mappedProfile?.displayName) {
      log.set({ oauth: { error: "invalid_mapped_profile", providerId, rawProfile } });
      return sendRedirect(event, "/login?oauth=error");
    }

    // 6. 根据 action 分流
    if (stateData.action === "bind") {
      // 检查该第三方账号是否已被其他用户绑定
      const existingUser = await findUserByOAuthBinding(providerId, mappedProfile.providerId);
      if (existingUser && existingUser.uuid !== stateData.userId) {
        return sendRedirect(event, "/home?oauth=already-bound");
      }

      const added = await addOAuthBinding(stateData.userId!, {
        provider: providerId,
        providerId: mappedProfile.providerId,
        displayName: mappedProfile.displayName,
        boundAt: new Date(),
      });

      if (!added) {
        return sendRedirect(event, "/home?oauth=duplicate");
      }

      log.set({ oauth: { action: "bind", providerId, thirdPartyId: mappedProfile.providerId } });
      return sendRedirect(event, "/home?oauth=bind-success");
    }

    // action === "login"
    const user = await findUserByOAuthBinding(providerId, mappedProfile.providerId);
    if (!user) {
      return sendRedirect(event, "/login?oauth=not-bound");
    }

    // 创建 session
    const clientIp = extractClientIp(event);
    const ua = getHeader(event, "user-agent") || "unknown";
    await updateLastLogin(user.uuid, clientIp);

    const sessionData: SessionData = {
      userId: user.uuid,
      email: user.email,
      gameId: user.gameId,
      ip: clientIp,
      ua,
      loginAt: Date.now(),
    };

    await createSession(event, sessionData);
    log.set({ oauth: { action: "login", providerId, userId: user.uuid } });
    return sendRedirect(event, "/home");
  } catch (err: unknown) {
    log.error(err as Error, { step: "oauth_callback", providerId });
    return sendRedirect(event, "/login?oauth=error");
  }
});
```

- [ ] **Step 2: 验证 `PluginManager` 暴露了 `getBridge()` 方法**

检查 `server/utils/plugin/plugin-manager.ts` 是否有 `getBridge()` 公开方法。如果没有，添加：

```typescript
  getBridge(): PluginBridge {
    return this.bridge;
  }
```

- [ ] **Step 3: 提交**

```bash
git add server/api/oauth/[providerId]/callback.get.ts server/utils/plugin/plugin-manager.ts
git commit -m "feat: add GET /api/oauth/[providerId]/callback with full OAuth flow"
```

---

### Task 10: API 路由 — 解绑

**Files:**
- Create: `server/api/oauth/[providerId]/unbind.post.ts`

- [ ] **Step 1: 创建 `server/api/oauth/[providerId]/unbind.post.ts`**

```typescript
export default defineEventHandler(async (event) => {
  const user = requireAuth(event);
  const providerId = getRouterParam(event, "providerId");

  if (!providerId) {
    throw createError({ statusCode: 400, statusMessage: "Missing providerId" });
  }

  const removed = await removeOAuthBinding(user.userId, providerId);
  if (!removed) {
    throw createError({ statusCode: 404, statusMessage: "No binding found for this provider" });
  }

  return { success: true };
});
```

- [ ] **Step 2: 提交**

```bash
git add server/api/oauth/[providerId]/unbind.post.ts
git commit -m "feat: add POST /api/oauth/[providerId]/unbind endpoint"
```

---

### Task 11: 前端 — OAuthButtons 登录页组件

**Files:**
- Create: `app/components/OAuthButtons.vue`
- Modify: `app/pages/login.vue`

- [ ] **Step 1: 创建 `app/components/OAuthButtons.vue`**

```vue
<script setup lang="ts">
interface OAuthProvider {
  id: string;
  name: string;
  icon: string;
  brandColor: string;
}

const { data: providersData } = await useFetch("/api/oauth/providers");
const providers = computed<OAuthProvider[]>(
  () => (providersData.value as { providers: OAuthProvider[] })?.providers ?? [],
);

function handleLogin(providerId: string) {
  navigateTo(`/api/oauth/${providerId}/authorize?action=login`, { external: true });
}
</script>

<template>
  <div v-if="providers.length > 0" class="flex flex-col gap-7">
    <!-- Divider -->
    <div class="flex items-center gap-3">
      <div class="flex-1 border-t border-base-300" />
      <span class="text-xs opacity-40">第三方账号登录</span>
      <div class="flex-1 border-t border-base-300" />
    </div>

    <!-- OAuth Icon Buttons -->
    <div class="flex flex-row gap-2 justify-center">
      <div
        v-for="provider in providers"
        :key="provider.id"
        class="tooltip tooltip-top"
        :data-tip="provider.name"
      >
        <button
          type="button"
          class="btn btn-square w-11 h-11 min-h-0 p-0 border-base-300"
          :style="{ backgroundColor: provider.brandColor }"
          @click="handleLogin(provider.id)"
        >
          <img
            :src="provider.icon"
            :alt="provider.name"
            class="w-5 h-5"
            style="filter: brightness(0) invert(1)"
          >
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 在登录页中引入 OAuthButtons 并处理 OAuth toast**

修改 `app/pages/login.vue`：

在 `<script setup>` 顶部区域（`const toast = useToast();` 行之后）添加 OAuth toast 处理逻辑：

```typescript
// OAuth 回调 toast 提示
const route = useRoute();
const oauthMessages: Record<string, { type: "error" | "success"; text: string }> = {
  "not-bound": { type: "error", text: "该第三方账号未绑定任何用户" },
  error: { type: "error", text: "第三方登录失败，请重试" },
};

onMounted(() => {
  const oauthParam = route.query.oauth as string;
  if (oauthParam && oauthMessages[oauthParam]) {
    const msg = oauthMessages[oauthParam];
    if (msg.type === "error") toast.error(msg.text);
    else toast.success(msg.text);
  }
});
```

在模板中，在 Passkey 按钮的 `</button>` 结束标签（第 205 行）之后插入 `OAuthButtons` 组件：

```vue
      <!-- OAuth Providers -->
      <OAuthButtons />
```

- [ ] **Step 3: 提交**

```bash
git add app/components/OAuthButtons.vue app/pages/login.vue
git commit -m "feat: add OAuth icon buttons to login page with toast handling"
```

---

### Task 12: 前端 — OAuthBindings Home 页组件

**Files:**
- Create: `app/components/OAuthBindings.vue`
- Modify: `app/components/HomePage.vue`

- [ ] **Step 1: 创建 `app/components/OAuthBindings.vue`**

```vue
<script setup lang="ts">
interface OAuthProvider {
  id: string;
  name: string;
  icon: string;
  brandColor: string;
}

interface OAuthBindingInfo {
  provider: string;
  providerId: string;
  displayName: string;
  boundAt: number;
}

const { data: user } = useUser();
const { data: providersData, refresh: refreshProviders } = await useFetch("/api/oauth/providers");
const toast = useToast();
const unbindLoading = ref<string | null>(null);
const confirmProvider = ref<string | null>(null);

const providers = computed<OAuthProvider[]>(
  () => (providersData.value as { providers: OAuthProvider[] })?.providers ?? [],
);

const bindings = computed<OAuthBindingInfo[]>(
  () => user.value?.oauthBindings ?? [],
);

function getBinding(providerId: string): OAuthBindingInfo | undefined {
  return bindings.value.find((b) => b.provider === providerId);
}

function handleBind(providerId: string) {
  navigateTo(`/api/oauth/${providerId}/authorize?action=bind`, { external: true });
}

async function handleUnbind(providerId: string) {
  if (confirmProvider.value !== providerId) {
    confirmProvider.value = providerId;
    return;
  }

  confirmProvider.value = null;
  unbindLoading.value = providerId;
  try {
    await $fetch(`/api/oauth/${providerId}/unbind`, { method: "POST" });
    toast.success("已解绑");
    await refreshNuxtData("current-user");
  } catch {
    toast.error("解绑失败，请重试");
  } finally {
    unbindLoading.value = null;
  }
}

function cancelConfirm() {
  confirmProvider.value = null;
}
</script>

<template>
  <div v-if="providers.length > 0" class="border border-base-300 bg-base-200 p-5">
    <div class="flex items-center gap-2.5 text-lg">
      <Icon name="hugeicons:link-circle-02" class="text-xl" />
      <h2>第三方账号</h2>
    </div>
    <p class="text-sm opacity-60 mt-1">绑定后可直接使用第三方账号快捷登录</p>

    <div class="mt-4 flex flex-col gap-2">
      <div
        v-for="provider in providers"
        :key="provider.id"
        class="flex items-center gap-3 p-3 border"
        :class="getBinding(provider.id)
          ? 'border-base-300'
          : 'border-dashed border-base-300 opacity-60'"
      >
        <!-- Provider Icon -->
        <div
          class="w-10 h-10 flex items-center justify-center shrink-0"
          :style="{ backgroundColor: provider.brandColor }"
        >
          <img
            :src="provider.icon"
            :alt="provider.name"
            class="w-5 h-5"
            style="filter: brightness(0) invert(1)"
          >
        </div>

        <!-- Info -->
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm">{{ provider.name }}</div>
          <div v-if="getBinding(provider.id)" class="text-xs opacity-60 mt-0.5">
            {{ getBinding(provider.id)!.displayName }}
          </div>
          <div v-else class="text-xs opacity-40 mt-0.5">未绑定</div>
        </div>

        <!-- Action -->
        <div class="shrink-0 flex items-center gap-2">
          <template v-if="getBinding(provider.id)">
            <span class="text-xs text-success">已绑定</span>
            <button
              v-if="confirmProvider !== provider.id"
              class="btn btn-outline btn-error btn-xs"
              :disabled="unbindLoading === provider.id"
              @click="handleUnbind(provider.id)"
            >
              解绑
            </button>
            <template v-else>
              <button
                class="btn btn-error btn-xs"
                :disabled="unbindLoading === provider.id"
                @click="handleUnbind(provider.id)"
              >
                <span v-if="unbindLoading === provider.id" class="loading loading-spinner loading-xs" />
                确认
              </button>
              <button class="btn btn-ghost btn-xs" @click="cancelConfirm">取消</button>
            </template>
          </template>
          <button
            v-else
            class="btn btn-primary btn-xs"
            @click="handleBind(provider.id)"
          >
            绑定
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 在 `HomePage.vue` 中引入 `OAuthBindings` 并处理 OAuth toast**

在 `app/components/HomePage.vue` 的 `<script setup>` 中添加 OAuth toast 处理（在现有代码末尾，`</script>` 之前）：

```typescript
// OAuth 回调 toast 提示
const route = useRoute();
const toast = useToast();
const oauthMessages: Record<string, { type: "error" | "success"; text: string }> = {
  "bind-success": { type: "success", text: "第三方账号绑定成功" },
  "already-bound": { type: "error", text: "该第三方账号已绑定其他用户" },
  duplicate: { type: "error", text: "你已绑定该服务的账号" },
  error: { type: "error", text: "第三方登录失败，请重试" },
};

onMounted(() => {
  const oauthParam = route.query.oauth as string;
  if (oauthParam && oauthMessages[oauthParam]) {
    const msg = oauthMessages[oauthParam];
    if (msg.type === "error") toast.error(msg.text);
    else toast.success(msg.text);
  }
});
```

在模板中，将 `OAuthBindings` 放在左列 `ShortcutCard` 之后（约第 123 行 `</ShortcutCard>` 之后）：

```vue
        <OAuthBindings />
```

- [ ] **Step 3: 提交**

```bash
git add app/components/OAuthBindings.vue app/components/HomePage.vue
git commit -m "feat: add OAuth bindings card to home page with bind/unbind management"
```

---

### Task 13: GitHub OAuth 示例插件

**Files:**
- Create: `irminsul-data/plugins/github-oauth/plugin.yaml`
- Create: `irminsul-data/plugins/github-oauth/index.js`

- [ ] **Step 1: 创建 `irminsul-data/plugins/github-oauth/plugin.yaml`**

```yaml
name: GitHub OAuth
version: 1.0.0
description: 使用 GitHub 账号绑定和快捷登录
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

- [ ] **Step 2: 创建 `irminsul-data/plugins/github-oauth/index.js`**

```javascript
export function setup(ctx) {
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

  ctx.log.info("GitHub OAuth plugin loaded");
}
```

- [ ] **Step 3: 提交**

```bash
git add irminsul-data/plugins/github-oauth/plugin.yaml irminsul-data/plugins/github-oauth/index.js
git commit -m "feat: add GitHub OAuth example plugin"
```

---

### Task 14: 集成验证

- [ ] **Step 1: 运行全部测试**

Run: `bun run test -- --run`
Expected: 所有测试 PASS

- [ ] **Step 2: 运行 lint**

Run: `bun run lint`
Expected: 无错误

- [ ] **Step 3: 运行构建**

Run: `bun run build`
Expected: 构建成功

- [ ] **Step 4: 提交修复（如有）**

如果上述步骤发现问题，修复后提交：

```bash
git add -A
git commit -m "fix: address integration issues from OAuth provider implementation"
```
