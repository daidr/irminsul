# OAuth Hook 体系重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 OAuth 插件 hook 体系，让平台完全不碰凭据，所有 OAuth 协议细节由插件全权负责，通过独立 hook 支持动态 URL。

**Architecture:** 将 `OAuthProviderDescriptor` 缩减为纯展示信息（id/name/icon/brandColor），新增 `oauth:authorize` hook 让插件返回完整授权 URL，`oauth:exchange-token` 和 `oauth:fetch-profile` 改为必选且不再传凭据。Worker 侧新增 `ctx.oauth` 工具函数封装标准 OAuth 2.0 流程。

**Tech Stack:** TypeScript, Nitro server routes, Bun Worker (plugin-host.ts), YAML plugin manifests

**Spec:** `docs/superpowers/specs/2026-03-28-oauth-hook-redesign.md`

---

### Task 1: 新增 `oauth:authorize` 到已知 hook 列表

**Files:**
- Modify: `server/utils/plugin/types.ts:169-176`

- [ ] **Step 1: 在 `KNOWN_FUNCTIONAL_HOOKS` 中新增 `oauth:authorize`**

```typescript
export const KNOWN_FUNCTIONAL_HOOKS = [
  "evlog:enricher",
  "evlog:drain",
  "oauth:provider",
  "oauth:authorize",
  "oauth:map-profile",
  "oauth:exchange-token",
  "oauth:fetch-profile",
] as const;
```

- [ ] **Step 2: Commit**

```bash
rtk git add server/utils/plugin/types.ts && rtk git commit -m "$(cat <<'EOF'
feat(plugin): add oauth:authorize to known functional hooks
EOF
)"
```

---

### Task 2: 缩减 `OAuthProviderDescriptor` 并清理 `oauth.ts`

**Files:**
- Modify: `server/utils/oauth.ts`

- [ ] **Step 1: 重写 `oauth.ts`，缩减类型并删除默认实现函数**

将整个文件替换为以下内容（保留 state 管理和 URL 构建，删除 `defaultExchangeToken`/`defaultFetchProfile` 及相关类型）：

```typescript
import { randomUUID } from "node:crypto";

// === Types ===

export interface OAuthProviderDescriptor {
  id: string;
  name: string;
  icon: string;
  brandColor: string;
}

export interface OAuthMappedProfile {
  providerId: string;
  displayName: string;
}

export interface OAuthStateData {
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
  await redis.send("SET", [key, JSON.stringify(data), "EX", OAUTH_STATE_TTL.toString()]);
  return state;
}

export async function consumeOAuthState(state: string): Promise<OAuthStateData | null> {
  const redis = getRedisClient();
  const key = buildRedisKey("oauth", "state", state);
  const raw = (await redis.send("GETDEL", [key])) as string | null;
  if (!raw) return null;
  return JSON.parse(raw) as OAuthStateData;
}

// === URL Builder ===

export function buildCallbackUrl(providerId: string): string {
  const config = useRuntimeConfig();
  const baseUrl = (config.yggdrasilBaseUrl as string)?.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("IRMIN_YGGDRASIL_BASE_URL is not configured, OAuth callbacks require it");
  }
  return `${baseUrl}/api/oauth/${providerId}/callback`;
}
```

- [ ] **Step 2: Commit**

```bash
rtk git add server/utils/oauth.ts && rtk git commit -m "$(cat <<'EOF'
refactor(oauth): strip OAuthProviderDescriptor to display-only fields

Remove authorize/token/userInfo from descriptor, delete
defaultExchangeToken/defaultFetchProfile and related types.
Platform no longer touches OAuth protocol details.
EOF
)"
```

---

### Task 3: 在 Worker 侧 `ctx` 新增 `ctx.oauth` 工具函数

**Files:**
- Modify: `server/worker/plugin-host.ts`

- [ ] **Step 1: 在 `PluginContext` 接口中新增 `oauth` 属性**

在 `server/worker/plugin-host.ts` 的 `PluginContext` 接口中（`fetch` 行之后）添加：

```typescript
  oauth: {
    exchangeToken(
      tokenUrl: string,
      options: { code: string; redirectUri: string; clientId: string; clientSecret: string },
    ): Promise<{ accessToken: string; tokenType: string }>;
    fetchProfile(
      userInfoUrl: string,
      options: { accessToken: string; tokenType: string; headers?: Record<string, string> },
    ): Promise<unknown>;
  };
```

- [ ] **Step 2: 在 `createPluginContext` 的返回对象中实现 `oauth`**

在 `fetch: globalThis.fetch.bind(globalThis),` 之后添加：

```typescript
    oauth: {
      async exchangeToken(tokenUrl, options) {
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          code: options.code,
          redirect_uri: options.redirectUri,
          client_id: options.clientId,
          client_secret: options.clientSecret,
        });

        const res = await globalThis.fetch(tokenUrl, {
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
      },

      async fetchProfile(userInfoUrl, options) {
        const res = await globalThis.fetch(userInfoUrl, {
          headers: {
            Authorization: `${options.tokenType} ${options.accessToken}`,
            Accept: "application/json",
            ...options.headers,
          },
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`User info fetch failed (${res.status}): ${text}`);
        }

        return res.json();
      },
    },
```

- [ ] **Step 3: Commit**

```bash
rtk git add server/worker/plugin-host.ts && rtk git commit -m "$(cat <<'EOF'
feat(plugin): add ctx.oauth utility functions to worker context

Provide ctx.oauth.exchangeToken() and ctx.oauth.fetchProfile() for
plugins to perform standard OAuth 2.0 token exchange and profile
fetching with built-in error handling.
EOF
)"
```

---

### Task 4: 重写 `authorize.get.ts`

**Files:**
- Modify: `server/api/oauth/[providerId]/authorize.get.ts`

- [ ] **Step 1: 替换整个文件内容**

```typescript
export default defineEventHandler(async (event) => {
  const providerId = getRouterParam(event, "providerId");
  if (!providerId) {
    throw createError({ statusCode: 400, statusMessage: "Missing providerId" });
  }

  const manager = getPluginManager();
  const provider = manager.getOAuthProvider(providerId);
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

  const redirectUri = buildCallbackUrl(providerId);

  const result = (await manager.callPluginHook(
    provider.pluginId,
    "oauth:authorize",
    { redirectUri, state },
  )) as { url?: string } | null;

  const authorizeUrl = result?.url;
  if (!authorizeUrl || typeof authorizeUrl !== "string" || !authorizeUrl.startsWith("https://")) {
    throw createError({ statusCode: 500, statusMessage: "OAuth plugin returned invalid authorize URL" });
  }

  return sendRedirect(event, authorizeUrl);
});
```

- [ ] **Step 2: Commit**

```bash
rtk git add server/api/oauth/[providerId]/authorize.get.ts && rtk git commit -m "$(cat <<'EOF'
refactor(oauth): delegate authorize URL construction to plugin hook

Call oauth:authorize hook instead of building URL in platform.
Remove credential reads and URL params assembly. Validate returned
URL starts with https:// to prevent open redirect.
EOF
)"
```

---

### Task 5: 重写 `oauth-callback.ts`

**Files:**
- Modify: `server/utils/oauth-callback.ts`

- [ ] **Step 1: 替换整个文件内容**

```typescript
import type { H3Event } from "h3";
import { useLogger } from "evlog";

interface CallbackParams {
  code: string;
  state: string;
  error?: string;
}

/**
 * OAuth 回调共享逻辑，供 GET（标准 redirect）和 POST（form_post）两种回调方式复用
 */
export async function handleOAuthCallback(event: H3Event, params: CallbackParams) {
  const log = useLogger(event);
  const providerId = getRouterParam(event, "providerId");
  const { code, state: stateParam, error: errorParam } = params;

  // 处理第三方返回的错误（如用户拒绝授权）
  if (errorParam) {
    if (stateParam) await consumeOAuthState(stateParam);
    if (errorParam === "access_denied") {
      return sendRedirect(event, "/login?oauth=denied");
    }
    return sendRedirect(event, "/login?oauth=error");
  }

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

  const errorRedirect = stateData.action === "bind" ? "/home?oauth=error" : "/login?oauth=error";

  const manager = getPluginManager();
  const provider = manager.getOAuthProvider(providerId);
  if (!provider) {
    return sendRedirect(event, errorRedirect);
  }

  const { pluginId } = provider;
  const redirectUri = buildCallbackUrl(providerId);

  try {
    // 2. Token 交换
    const tokenResult = (await manager.callPluginHook(pluginId, "oauth:exchange-token", {
      code,
      redirectUri,
    })) as { accessToken?: string; tokenType?: string } | null;

    if (!tokenResult?.accessToken) {
      log.set({ oauth: { error: "empty_access_token", step: "exchange_token", providerId } });
      return sendRedirect(event, errorRedirect);
    }

    const accessToken = tokenResult.accessToken;
    const tokenType = tokenResult.tokenType ?? "Bearer";

    // 3. 获取用户信息
    const rawProfile = await manager.callPluginHook(pluginId, "oauth:fetch-profile", {
      accessToken,
      tokenType,
    });

    // 4. 映射 Profile
    const mappedProfile = (await manager.callPluginHook(
      pluginId,
      "oauth:map-profile",
      rawProfile,
    )) as { providerId: string; displayName: string } | null;

    if (!mappedProfile?.providerId || !mappedProfile?.displayName) {
      log.set({ oauth: { error: "invalid_mapped_profile", step: "map_profile", providerId, rawProfile } });
      return sendRedirect(event, errorRedirect);
    }

    // 5. 根据 action 分流
    if (stateData.action === "bind") {
      const existingUser = await findUserByOAuthBinding(providerId, mappedProfile.providerId);
      if (existingUser && existingUser.uuid !== stateData.userId) {
        return sendRedirect(event, "/home?oauth=already-bound");
      }

      try {
        const added = await addOAuthBinding(stateData.userId!, {
          provider: providerId,
          providerId: mappedProfile.providerId,
          displayName: mappedProfile.displayName,
          boundAt: new Date(),
        });

        if (!added) {
          return sendRedirect(event, "/home?oauth=duplicate");
        }
      } catch (err: any) {
        if (err?.code === 11000) {
          return sendRedirect(event, "/home?oauth=already-bound");
        }
        throw err;
      }

      log.set({ oauth: { action: "bind", providerId, thirdPartyId: mappedProfile.providerId } });
      return sendRedirect(event, "/home?oauth=bind-success");
    }

    // action === "login"
    const user = await findUserByOAuthBinding(providerId, mappedProfile.providerId);
    if (!user) {
      return sendRedirect(event, "/login?oauth=not-bound");
    }

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
    return sendRedirect(event, errorRedirect);
  }
}
```

- [ ] **Step 2: Commit**

```bash
rtk git add server/utils/oauth-callback.ts && rtk git commit -m "$(cat <<'EOF'
refactor(oauth): simplify callback to direct hook calls

Remove credential reads, conditional hook dispatch, and default
fallback functions. All three hooks called unconditionally.
Error redirects respect action type (bind→/home, login→/login).
EOF
)"
```

---

### Task 6: 更新 `discoverOAuthProviders` 验证逻辑

**Files:**
- Modify: `server/utils/plugin/plugin-manager.ts:559-612`

- [ ] **Step 1: 在 `discoverOAuthProviders` 中添加 hook 完整性校验**

在 `if (!descriptor?.id || !descriptor?.name)` 检查之后、`if (providers.has(descriptor.id))` 检查之前，插入以下代码：

```typescript
        // 校验插件是否注册了全部必需的 OAuth hooks
        const requiredHooks = ["oauth:authorize", "oauth:exchange-token", "oauth:fetch-profile", "oauth:map-profile"];
        const missingHooks = requiredHooks.filter(
          (h) => !this.hookRegistry.get(h).some((r) => r.pluginId === handler.pluginId),
        );
        if (missingHooks.length > 0) {
          this.logManager.push({
            timestamp: new Date().toISOString(),
            level: "error",
            type: "event",
            pluginId: handler.pluginId,
            message: `oauth:provider registered but missing required hooks: ${missingHooks.join(", ")}`,
          });
          continue;
        }
```

- [ ] **Step 2: Commit**

```bash
rtk git add server/utils/plugin/plugin-manager.ts && rtk git commit -m "$(cat <<'EOF'
feat(plugin): validate all required OAuth hooks during discovery

Skip providers whose plugin is missing any of the 4 required hooks
(oauth:authorize, oauth:exchange-token, oauth:fetch-profile,
oauth:map-profile) and log which hooks are missing.
EOF
)"
```

---

### Task 7: 重写 GitHub OAuth 插件

**Files:**
- Modify: `irminsul-data/plugins/github-oauth/plugin.yaml`
- Modify: `irminsul-data/plugins/github-oauth/index.js`

- [ ] **Step 1: 更新 `plugin.yaml` 的 hooks 列表**

```yaml
name: GitHub OAuth
version: 1.0.0
description: 使用 GitHub 账号绑定和快捷登录
author: irminsul
hooks:
  - oauth:provider
  - oauth:authorize
  - oauth:exchange-token
  - oauth:fetch-profile
  - oauth:map-profile
config:
  - key: callbackUrl
    label: OAuth Callback URL
    type: oauth-callback-url
    description: 在 GitHub OAuth App 设置中，将此 URL 填入 "Authorization callback URL" 字段
    url: https://github.com/settings/developers
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

- [ ] **Step 2: 重写 `index.js`**

```javascript
export function setup(ctx) {
  const config = ctx.config.getAll();

  ctx.hook("oauth:provider", () => ({
    id: "github",
    name: "GitHub",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik04IDBDMy41OCAwIDAgMy41OCAwIDhjMCAzLjU0IDIuMjkgNi41MyA1LjQ3IDcuNTkuNC4wNy41NS0uMTcuNTUtLjM4IDAtLjE5LS4wMS0uODItLjAxLTEuNDktMi4wMS4zNy0yLjUzLS40OS0yLjY5LS45NC0uMDktLjIzLS40OC0uOTQtLjgyLTEuMTMtLjI4LS4xNS0uNjgtLjUyLS4wMS0uNTMuNjMtLjAxIDEuMDguNTggMS4yMy44Mi43MiAxLjIxIDEuODcuODcgMi4zMy42Ni4wNy0uNTIuMjgtLjg3LjUxLTEuMDctMS43OC0uMi0zLjY0LS44OS0zLjY0LTMuOTUgMC0uODcuMzEtMS41OS44Mi0yLjE1LS4wOC0uMi0uMzYtMS4wMi4wOC0yLjEyIDAgMCAuNjctLjIxIDIuMi44Mi42NC0uMTggMS4zMi0uMjcgMi0uMjcuNjggMCAxLjM2LjA5IDIgLjI3IDEuNTMtMS4wNCAyLjItLjgyIDIuMi0uODIuNDQgMS4xLjE2IDEuOTIuMDggMi4xMi41MS41Ni44MiAxLjI3LjgyIDIuMTUgMCAzLjA3LTEuODcgMy43NS0zLjY1IDMuOTUuMjkuMjUuNTQuNzMuNTQgMS40OCAwIDEuMDctLjAxIDEuOTMtLjAxIDIuMiAwIC4yMS4xNS40Ni41NS4zOEE4LjAxMyA4LjAxMyAwIDAwMTYgOGMwLTQuNDItMy41OC04LTgtOHoiLz48L3N2Zz4=",
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
      code,
      redirectUri,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    }),
  );

  ctx.hook("oauth:fetch-profile", ({ accessToken, tokenType }) =>
    ctx.oauth.fetchProfile("https://api.github.com/user", {
      accessToken,
      tokenType,
      headers: { Accept: "application/vnd.github+json" },
    }),
  );

  ctx.hook("oauth:map-profile", (raw) => ({
    providerId: String(raw.id),
    displayName: raw.login,
  }));

  ctx.log.info("GitHub OAuth plugin loaded");
}
```

- [ ] **Step 3: Commit**

```bash
rtk git add irminsul-data/plugins/github-oauth/ && rtk git commit -m "$(cat <<'EOF'
refactor(plugin): rewrite github-oauth for new hook architecture

Register all 5 required hooks. Use ctx.oauth helpers for token
exchange and profile fetch. Plugin owns URL construction and
credential reads.
EOF
)"
```

---

### Task 8: 重写 Google OAuth 插件

**Files:**
- Modify: `irminsul-data/plugins/google-oauth/plugin.yaml`
- Modify: `irminsul-data/plugins/google-oauth/index.js`

- [ ] **Step 1: 更新 `plugin.yaml` 的 hooks 列表**

```yaml
name: Google OAuth
version: 1.0.0
description: 使用 Google 账号绑定和快捷登录
author: irminsul
hooks:
  - oauth:provider
  - oauth:authorize
  - oauth:exchange-token
  - oauth:fetch-profile
  - oauth:map-profile
config:
  - key: callbackUrl
    label: OAuth Callback URL
    type: oauth-callback-url
    description: 在 Google Cloud Console 的 OAuth 2.0 客户端设置中，将此 URL 添加到"已获授权的重定向 URI"
    url: https://console.cloud.google.com/apis/credentials
  - key: clientId
    label: Client ID
    type: text
    required: true
    description: Google OAuth 2.0 客户端 ID
  - key: clientSecret
    label: Client Secret
    type: password
    required: true
    description: Google OAuth 2.0 客户端密钥
```

- [ ] **Step 2: 重写 `index.js`**

```javascript
export function setup(ctx) {
  const config = ctx.config.getAll();

  ctx.hook("oauth:provider", () => ({
    id: "google",
    name: "Google",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxOCAxOCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xNy42NCA5LjJjMC0uNjMtLjA2LTEuMjUtLjE2LTEuODRIOXYzLjQ4aDQuODRhNC4xNCA0LjE0IDAgMDEtMS44IDIuNzJ2Mi4yNmgyLjkyYTguNzggOC43OCAwIDAwMi42OC02LjYyeiIvPjxwYXRoIGQ9Ik05IDE4YzIuNDMgMCA0LjQ3LS44IDUuOTYtMi4xOGwtMi45Mi0yLjI2Yy0uOC41NC0xLjgzLjg2LTMuMDQuODYtMi4zNCAwLTQuMzMtMS41OC01LjA0LTMuNzFILjk2djIuMzNBOC45OSA4Ljk5IDAgMDA5IDE4eiIvPjxwYXRoIGQ9Ik0zLjk2IDEwLjcxQTUuNDEgNS40MSAwIDAxMy42OCA5YzAtLjU5LjEtMS4xNy4yOC0xLjcxVjQuOTZILjk2QTguOTkgOC45OSAwIDAwMCA5YzAgMS40NS4zNSAyLjgyLjk2IDQuMDRsMy0yLjMzeiIvPjxwYXRoIGQ9Ik05IDMuNThjMS4zMiAwIDIuNS40NSAzLjQ0IDEuMzVsMi41OC0yLjU4QzEzLjQ2Ljg5IDExLjQzIDAgOSAwQTguOTkgOC45OSAwIDAwLjk2IDQuOTZsMyAyLjMzQzQuNjcgNS4xNiA2LjY2IDMuNTggOSAzLjU4eiIvPjwvc3ZnPg==",
    brandColor: "#4285F4",
  }));

  ctx.hook("oauth:authorize", ({ redirectUri, state }) => {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: "openid profile email",
      state,
      response_type: "code",
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
  });

  ctx.hook("oauth:exchange-token", ({ code, redirectUri }) =>
    ctx.oauth.exchangeToken("https://oauth2.googleapis.com/token", {
      code,
      redirectUri,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    }),
  );

  ctx.hook("oauth:fetch-profile", ({ accessToken, tokenType }) =>
    ctx.oauth.fetchProfile("https://www.googleapis.com/oauth2/v3/userinfo", {
      accessToken,
      tokenType,
    }),
  );

  ctx.hook("oauth:map-profile", (raw) => ({
    providerId: String(raw.sub),
    displayName: raw.name || raw.email,
  }));

  ctx.log.info("Google OAuth plugin loaded");
}
```

- [ ] **Step 3: Commit**

```bash
rtk git add irminsul-data/plugins/google-oauth/ && rtk git commit -m "$(cat <<'EOF'
refactor(plugin): rewrite google-oauth for new hook architecture
EOF
)"
```

---

### Task 9: 重写 Microsoft OAuth 插件

**Files:**
- Modify: `irminsul-data/plugins/microsoft-oauth/plugin.yaml`
- Modify: `irminsul-data/plugins/microsoft-oauth/index.js`

- [ ] **Step 1: 更新 `plugin.yaml` 的 hooks 列表**

注意：Microsoft 的 tenant 相关配置无需再标记 `restart: true`，因为 URL 现在在每次 authorize/exchange-token 请求时动态计算。

```yaml
name: Microsoft OAuth
version: 1.0.0
description: 使用 Microsoft 账号绑定和快捷登录
author: irminsul
hooks:
  - oauth:provider
  - oauth:authorize
  - oauth:exchange-token
  - oauth:fetch-profile
  - oauth:map-profile
config:
  - key: callbackUrl
    label: OAuth Callback URL
    type: oauth-callback-url
    description: 在 Azure Portal 的应用注册中，将此 URL 添加到"重定向 URI"（Web 平台）
    url: https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade
  - key: clientId
    label: Application (client) ID
    type: text
    required: true
    description: Azure AD 应用注册的 Application (client) ID
  - key: clientSecret
    label: Client Secret
    type: password
    required: true
    description: Azure AD 应用注册的客户端密码（Value，非 Secret ID）
  - key: tenant
    label: Tenant
    type: select
    default: common
    description: 选择允许登录的账号类型
    options:
      - label: 所有 Microsoft 账号（个人 + 工作/学校）
        value: common
      - label: 仅工作/学校账号（多租户）
        value: organizations
      - label: 仅个人 Microsoft 账号
        value: consumers
      - label: 仅特定租户（需填写下方租户 ID）
        value: custom
  - key: customTenant
    label: 租户 ID / 域名
    type: text
    description: "填写租户 ID（GUID）或域名（如 contoso.onmicrosoft.com）"
    visible_when:
      field: tenant
      eq: custom
    required_when:
      field: tenant
      eq: custom
```

- [ ] **Step 2: 重写 `index.js`**

```javascript
function getTenant(config) {
  return config.tenant === "custom" && config.customTenant
    ? config.customTenant
    : config.tenant || "common";
}

export function setup(ctx) {
  const config = ctx.config.getAll();

  ctx.hook("oauth:provider", () => ({
    id: "microsoft",
    name: "Microsoft",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMSAyMSI+PHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjkiIGhlaWdodD0iOSIgZmlsbD0iI2YyNTAyMiIvPjxyZWN0IHg9IjExIiB5PSIxIiB3aWR0aD0iOSIgaGVpZ2h0PSI5IiBmaWxsPSIjN2ZiYTAwIi8+PHJlY3QgeD0iMSIgeT0iMTEiIHdpZHRoPSI5IiBoZWlnaHQ9IjkiIGZpbGw9IiMwMGE0ZWYiLz48cmVjdCB4PSIxMSIgeT0iMTEiIHdpZHRoPSI5IiBoZWlnaHQ9IjkiIGZpbGw9IiNmZmI5MDAiLz48L3N2Zz4=",
    brandColor: "#2F2F2F",
  }));

  ctx.hook("oauth:authorize", ({ redirectUri, state }) => {
    const tenant = getTenant(ctx.config.getAll());
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: "openid profile email User.Read",
      state,
      response_type: "code",
    });
    return { url: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}` };
  });

  ctx.hook("oauth:exchange-token", ({ code, redirectUri }) => {
    const tenant = getTenant(ctx.config.getAll());
    return ctx.oauth.exchangeToken(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        code,
        redirectUri,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      },
    );
  });

  ctx.hook("oauth:fetch-profile", ({ accessToken, tokenType }) =>
    ctx.oauth.fetchProfile("https://graph.microsoft.com/v1.0/me", {
      accessToken,
      tokenType,
    }),
  );

  ctx.hook("oauth:map-profile", (raw) => ({
    providerId: String(raw.id),
    displayName: raw.displayName || raw.userPrincipalName,
  }));

  ctx.log.info(`Microsoft OAuth plugin loaded (tenant: ${getTenant(config)})`);
}
```

- [ ] **Step 3: Commit**

```bash
rtk git add irminsul-data/plugins/microsoft-oauth/ && rtk git commit -m "$(cat <<'EOF'
refactor(plugin): rewrite microsoft-oauth for new hook architecture

Tenant URL is now computed dynamically per-request in oauth:authorize
and oauth:exchange-token hooks, removing the need for restart: true
on tenant config fields.
EOF
)"
```

---

### Task 10: 重写 Discord OAuth 插件

**Files:**
- Modify: `irminsul-data/plugins/discord-oauth/plugin.yaml`
- Modify: `irminsul-data/plugins/discord-oauth/index.js`

- [ ] **Step 1: 更新 `plugin.yaml` 的 hooks 列表**

```yaml
name: Discord OAuth
version: 1.0.0
description: 使用 Discord 账号绑定和快捷登录
author: irminsul
hooks:
  - oauth:provider
  - oauth:authorize
  - oauth:exchange-token
  - oauth:fetch-profile
  - oauth:map-profile
config:
  - key: callbackUrl
    label: OAuth Callback URL
    type: oauth-callback-url
    description: 在 Discord Developer Portal 的 OAuth2 设置中，将此 URL 添加到 "Redirects"
    url: https://discord.com/developers/applications
  - key: clientId
    label: Client ID
    type: text
    required: true
    description: Discord 应用的 Client ID（在 OAuth2 页面可找到）
  - key: clientSecret
    label: Client Secret
    type: password
    required: true
    description: Discord 应用的 Client Secret
```

- [ ] **Step 2: 重写 `index.js`**

```javascript
export function setup(ctx) {
  const config = ctx.config.getAll();

  ctx.hook("oauth:provider", () => ({
    id: "discord",
    name: "Discord",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMy41NDUgMi45MDdhMTMuMiAxMy4yIDAgMCAwLTMuMjU3LTEuMDExLjA1LjA1IDAgMCAwLS4wNTIuMDI1Yy0uMTQxLjI1LS4yOTcuNTc3LS40MDYuODMzYTEyLjIgMTIuMiAwIDAgMC0zLjY1OCAwIDguMyA4LjMgMCAwIDAtLjQxMi0uODMzLjA1LjA1IDAgMCAwLS4wNTItLjAyNWMtMS4xMjUuMTk0LTIuMjIuNTM0LTMuMjU3IDEuMDExYS4wNC4wNCAwIDAgMC0uMDIxLjAxOEMuMzU2IDYuMDI0LS4yMTMgOS4wNDcuMDY2IDEyLjAzMnEuMDAzLjAyMi4wMjEuMDM3YTEzLjMgMTMuMyAwIDAgMCAzLjk5NiAyLjAyLjA1LjA1IDAgMCAwIC4wNTYtLjAxOWMuMzA4LS40Mi41ODItLjg2My44MTgtMS4zMjlhLjA1LjA1IDAgMCAwLS4wMjgtLjA3IDguNyA4LjcgMCAwIDEtMS4yNDgtLjU5NS4wNS4wNSAwIDAgMS0uMDA1LS4wODNxLjEyNS0uMDkzLjI0OC0uMTk1YS4wNS4wNSAwIDAgMSAuMDUxLS4wMDdjMi42MTkgMS4xOTYgNS40NTQgMS4xOTYgOC4wNDEgMGEuMDUuMDUgMCAwIDEgLjA1My4wMDdxLjEyMS4xLjI0OC4xOTVhLjA1LjA1IDAgMCAxLS4wMDQuMDgzIDguMiA4LjIgMCAwIDEtMS4yNDkuNTk0LjA1LjA1IDAgMCAwLS4wMjcuMDdjLjI0LjQ2NS41MTUuOTA5LjgxNyAxLjMyOWEuMDUuMDUgMCAwIDAgLjA1Ni4wMTkgMTMuMiAxMy4yIDAgMCAwIDQuMDAxLTIuMDIuMDUuMDUgMCAwIDAgLjAyMS0uMDM3Yy4zMzQtMy40NTEtLjU1OS02LjQ0OS0yLjM2Ni05LjEwNmEuMDMuMDMgMCAwIDAtLjAyLS4wMTltLTguMTk4IDcuMzA3Yy0uNzg5IDAtMS40MzgtLjcyNC0xLjQzOC0xLjYxMnMuNjM3LTEuNjEzIDEuNDM4LTEuNjEzYy44MDcgMCAxLjQ1LjczIDEuNDM4IDEuNjEzIDAgLjg4OC0uNjM3IDEuNjEyLTEuNDM4IDEuNjEybTUuMzE2IDBjLS43ODggMC0xLjQzOC0uNzI0LTEuNDM4LTEuNjEycy42MzctMS42MTMgMS40MzgtMS42MTNjLjgwNyAwIDEuNDUxLjczIDEuNDM4IDEuNjEzIDAgLjg4OC0uNjMxIDEuNjEyLTEuNDM4IDEuNjEyIi8+PC9zdmc+",
    brandColor: "#5865F2",
  }));

  ctx.hook("oauth:authorize", ({ redirectUri, state }) => {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: "identify",
      state,
      response_type: "code",
    });
    return { url: `https://discord.com/oauth2/authorize?${params}` };
  });

  ctx.hook("oauth:exchange-token", ({ code, redirectUri }) =>
    ctx.oauth.exchangeToken("https://discord.com/api/oauth2/token", {
      code,
      redirectUri,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    }),
  );

  ctx.hook("oauth:fetch-profile", ({ accessToken, tokenType }) =>
    ctx.oauth.fetchProfile("https://discord.com/api/users/@me", {
      accessToken,
      tokenType,
    }),
  );

  ctx.hook("oauth:map-profile", (raw) => ({
    providerId: String(raw.id),
    displayName: raw.global_name || raw.username,
  }));

  ctx.log.info("Discord OAuth plugin loaded");
}
```

- [ ] **Step 3: Commit**

```bash
rtk git add irminsul-data/plugins/discord-oauth/ && rtk git commit -m "$(cat <<'EOF'
refactor(plugin): rewrite discord-oauth for new hook architecture
EOF
)"
```

---

### Task 11: 重写 Apple OAuth 插件

**Files:**
- Modify: `irminsul-data/plugins/apple-oauth/plugin.yaml`
- Modify: `irminsul-data/plugins/apple-oauth/index.js`

- [ ] **Step 1: 更新 `plugin.yaml` 的 hooks 列表**

```yaml
name: Apple OAuth
version: 1.0.0
description: 使用 Apple 账号绑定和快捷登录（Sign in with Apple）
author: irminsul
hooks:
  - oauth:provider
  - oauth:authorize
  - oauth:exchange-token
  - oauth:fetch-profile
  - oauth:map-profile
config:
  - key: callbackUrl
    label: OAuth Callback URL
    type: oauth-callback-url
    description: 在 Apple Developer 的 Services ID 配置中，将此 URL 添加到 "Return URLs"
    url: https://developer.apple.com/account/resources/identifiers/list/serviceId
  - key: clientId
    label: Service ID (Client ID)
    type: text
    required: true
    description: Apple Services ID 标识符（如 com.example.auth）
  - key: teamId
    label: Team ID
    type: text
    required: true
    description: Apple Developer 团队 ID（10 位字符，可在开发者账号右上角找到）
  - key: keyId
    label: Key ID
    type: text
    required: true
    description: Sign in with Apple 私钥的 Key ID（在 Keys 页面可找到）
  - key: privateKey
    label: Private Key (.p8)
    type: textarea
    required: true
    description: "Sign in with Apple 私钥内容（.p8 文件的完整内容，包含 BEGIN/END 行）"
```

- [ ] **Step 2: 重写 `index.js`**

```javascript
/**
 * Apple OAuth Plugin
 *
 * Apple Sign In 不提供标准的 userInfo 端点，用户信息从 id_token (JWT) 中解析。
 * client_secret 需要动态生成为 ES256 签名的 JWT。
 *
 * 语义复用：oauth:exchange-token 返回的 accessToken 实际是 id_token 原始值，
 * oauth:fetch-profile 从中解码用户信息。这是插件内部约定的协议。
 */

/** 将 PEM 格式私钥转为 CryptoKey */
async function importPrivateKey(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** Base64url 编码 */
function base64url(data) {
  if (typeof data === "string") {
    data = new TextEncoder().encode(data);
  }
  return btoa(String.fromCharCode(...new Uint8Array(data)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** 解码 Base64url */
function base64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return atob(str);
}

/** 生成 Apple client_secret JWT（有效期 ~6 个月） */
async function generateClientSecret(teamId, clientId, keyId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId };
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + 15776000,
    aud: "https://appleid.apple.com",
    sub: clientId,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );

  const signatureB64 = base64url(signature);
  return `${signingInput}.${signatureB64}`;
}

/** 解析 JWT payload（不验证签名，仅解码） */
function decodeJwtPayload(jwt) {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");
  return JSON.parse(base64urlDecode(parts[1]));
}

export function setup(ctx) {
  const config = ctx.config.getAll();

  ctx.hook("oauth:provider", () => ({
    id: "apple",
    name: "Apple",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMS4xODIgNS4wOTNBMy4yIDMuMiAwIDAgMSAxMi43IDIuN2EzLjI3IDMuMjcgMCAwIDAtMi41NzItMS4zMTNjLTEuMDg2LS4xMTItMi4xMzguNjQxLTIuNjkuNjQxcy0xLjQyLS42My0yLjM0LS42MTNBMy40NSAzLjQ1IDAgMCAwIDIuMTggMy4xM0MuODkgNS4zNDggMS44NiA4LjY2OCAzLjEgMTAuNDc4Yy42MTguODkgMS4zNDggMS44ODggMi4zMDYgMS44NTIuOTMxLS4wMzggMS4yODEtLjU5OCAyLjQwNC0uNTk4czEuNDQuNTk4IDIuNDE3LjU3OGMxLS4wMTcgMS42My0uOSAyLjI0LTEuNzk2YTcuNyA3LjcgMCAwIDAgMS4wMjItMi4wODYgMy4xMSAzLjExIDAgMCAxLTEuODktMi44NnpNOS40MTIgMS40MjhBMy4xOCAzLjE4IDAgMCAwIDEwLjE0IDBhMy4yNCAzLjI0IDAgMCAwLTIuMDkgMS4wODIgMy4wMyAzLjAzIDAgMCAwLS43NSAyLjIgMi42OCAyLjY4IDAgMCAwIDIuMTEtMS44NTR6Ii8+PC9zdmc+",
    brandColor: "#000000",
  }));

  ctx.hook("oauth:authorize", ({ redirectUri, state }) => {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: "name email",
      state,
      response_type: "code",
      response_mode: "form_post",
    });
    return { url: `https://appleid.apple.com/auth/authorize?${params}` };
  });

  ctx.hook("oauth:exchange-token", async ({ code, redirectUri }) => {
    const clientSecret = await generateClientSecret(
      config.teamId,
      config.clientId,
      config.keyId,
      config.privateKey,
    );

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: clientSecret,
    });

    const res = await ctx.fetch("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Apple token exchange failed (${res.status}): ${text}`);
    }

    const data = await res.json();

    // 将 id_token 作为 accessToken 传递给 fetch-profile 阶段
    return {
      accessToken: data.id_token,
      tokenType: "id_token",
    };
  });

  ctx.hook("oauth:fetch-profile", ({ accessToken }) => {
    // accessToken 实际上是 id_token JWT，解码 payload 即可获取用户信息
    return decodeJwtPayload(accessToken);
  });

  ctx.hook("oauth:map-profile", (raw) => ({
    providerId: String(raw.sub),
    displayName: raw.email || raw.sub,
  }));

  ctx.log.info("Apple OAuth plugin loaded");
}
```

- [ ] **Step 3: Commit**

```bash
rtk git add irminsul-data/plugins/apple-oauth/ && rtk git commit -m "$(cat <<'EOF'
refactor(plugin): rewrite apple-oauth for new hook architecture

Add oauth:authorize hook with response_mode=form_post.
Token exchange generates JWT client_secret dynamically.
No longer depends on platform passing clientId in hook args.
EOF
)"
```

---

### Task 12: 验证与清理

**Files:**
- Verify: all modified files

- [ ] **Step 1: 运行 lint 检查**

Run: `rtk bun run lint`
Expected: PASS (no errors in modified server files)

- [ ] **Step 2: 运行 format 检查**

Run: `rtk bun run fmt:check`
Expected: PASS or fix with `bun run fmt`

- [ ] **Step 3: 确认 dev server 能启动**

Run: `bun run dev`
Expected: Server starts without errors, plugin system initializes

- [ ] **Step 4: 最终 commit（如有 lint/format 修复）**

```bash
rtk git add -A && rtk git commit -m "$(cat <<'EOF'
chore: fix lint and format issues from oauth hook redesign
EOF
)"
```
