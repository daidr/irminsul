# 用户生命周期 Hook 设计

## 概述

为插件系统新增用户生命周期钩子，使插件能够响应用户注册、登录、封禁、密码变更、OAuth 绑定变更等关键事件。所有 hook 均为**纯通知型（fire-and-forget）**，不阻塞也不拦截业务流程。

## 设计决策

| 决策 | 结论 | 理由 |
|------|------|------|
| 执行模型 | 纯通知型 | 与现有 functional hook 模式一致；核心操作不应被第三方插件拦截 |
| 命名模式 | 独立命名（`user:registered`） | 与 `evlog:enricher`、`oauth:provider` 风格对齐；payload 类型明确 |
| 范围 | 7 个 hook | 覆盖核心事件 + 安全敏感事件，可选事件留给后续扩展 |
| Hook 分类 | 新增 `KNOWN_EVENT_HOOKS` 常量 | 区分有返回值的 functional hook 和纯通知型 event hook |
| Handler 调用 | 并行（`Promise.allSettled`） | fire-and-forget 场景无需串行等待，避免慢插件拖累其他插件 |
| 桥接方式 | 主动调用（非 Nitro hook 桥接） | 用户事件没有对应的 Nitro hook 可桥接，直接在 API handler 中调用更直观 |

## Hook 定义

### 通用 Payload 字段

所有用户生命周期 hook 的 payload 都包含以下基础字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `uuid` | `string` | 用户 UUID |
| `email` | `string` | 用户邮箱 |
| `gameId` | `string` | 游戏 ID |
| `timestamp` | `number` | 事件时间戳（`Date.now()`） |

### `user:registered`

注册成功后触发。

| 额外字段 | 类型 | 说明 |
|----------|------|------|
| `ip` | `string \| null` | 注册 IP |

### `user:login`

Web 登录成功后触发（密码登录、Passkey 登录、OAuth 登录）。

| 额外字段 | 类型 | 说明 |
|----------|------|------|
| `ip` | `string \| null` | 登录 IP |
| `method` | `"password" \| "passkey" \| "oauth"` | 登录方式 |

### `user:banned`

用户被封禁后触发。**注意：当前 ban 管理端点尚未实现，此 hook 暂不会被触发，将在 admin 用户管理功能上线时接入。**

| 额外字段 | 类型 | 说明 |
|----------|------|------|
| `reason` | `string \| undefined` | 封禁理由 |
| `end` | `number \| undefined` | 到期时间戳，无则为永久 |
| `operator` | `string` | 操作管理员的 UUID |

### `user:unbanned`

用户被解封后触发。**注意：同 `user:banned`，暂不触发。**

| 额外字段 | 类型 | 说明 |
|----------|------|------|
| `operator` | `string` | 操作管理员的 UUID |

### `user:password-changed`

用户主动修改密码后触发。

| 额外字段 | 类型 | 说明 |
|----------|------|------|
| `ip` | `string \| null` | 操作 IP |

### `user:password-reset`

通过忘记密码流程重置密码后触发。

| 额外字段 | 类型 | 说明 |
|----------|------|------|
| `ip` | `string \| null` | 操作 IP |

### `user:oauth-bindchanged`

OAuth 账号绑定或解绑后触发。

| 额外字段 | 类型 | 说明 |
|----------|------|------|
| `action` | `"bind" \| "unbind"` | 绑定还是解绑 |
| `provider` | `string` | OAuth 提供者 ID |
| `displayName` | `string \| undefined` | 第三方显示名（仅 bind 时有值） |

### TypeScript 类型定义

在 `server/utils/plugin/types.ts` 中定义 payload 接口，提供类型安全：

```typescript
interface UserHookBasePayload {
  uuid: string;
  email: string;
  gameId: string;
  timestamp: number;
}

interface UserRegisteredPayload extends UserHookBasePayload {
  ip: string | null;
}

interface UserLoginPayload extends UserHookBasePayload {
  ip: string | null;
  method: "password" | "passkey" | "oauth";
}

interface UserBannedPayload extends UserHookBasePayload {
  reason?: string;
  end?: number;
  operator: string;
}

interface UserUnbannedPayload extends UserHookBasePayload {
  operator: string;
}

interface UserPasswordChangedPayload extends UserHookBasePayload {
  ip: string | null;
}

interface UserPasswordResetPayload extends UserHookBasePayload {
  ip: string | null;
}

interface UserOAuthBindChangedPayload extends UserHookBasePayload {
  action: "bind" | "unbind";
  provider: string;
  displayName?: string;
}

type UserHookPayloadMap = {
  "user:registered": UserRegisteredPayload;
  "user:login": UserLoginPayload;
  "user:banned": UserBannedPayload;
  "user:unbanned": UserUnbannedPayload;
  "user:password-changed": UserPasswordChangedPayload;
  "user:password-reset": UserPasswordResetPayload;
  "user:oauth-bindchanged": UserOAuthBindChangedPayload;
};
```

## 触发点

| Hook | 文件 | 时机 |
|------|------|------|
| `user:registered` | `server/api/auth/register.post.ts` | `insertUser` 成功后 |
| `user:login` | `server/api/auth/login.post.ts` | 创建 session 后（method=`"password"`） |
| `user:login` | `server/api/passkey/auth-verify.post.ts` | 创建 session 后（method=`"passkey"`） |
| `user:login` | `server/utils/oauth-callback.ts` | OAuth 登录成功后（method=`"oauth"`） |
| `user:banned` | 未来的 ban 管理端点 | 添加 ban record 后（暂不触发） |
| `user:unbanned` | 未来的 unban 管理端点 | 移除 ban record 后（暂不触发） |
| `user:password-changed` | `server/api/user/change-password.post.ts` | 密码更新后、session 销毁前 |
| `user:password-reset` | `server/api/auth/reset-password.post.ts` | 密码重置成功后 |
| `user:oauth-bindchanged` | `server/utils/oauth-callback.ts` | 绑定成功后（action=`"bind"`） |
| `user:oauth-bindchanged` | `server/api/oauth/[providerId]/unbind.post.ts` | 解绑成功后（action=`"unbind"`） |

## 实现方案

### 1. 注册 Hook 名称

在 `server/utils/plugin/types.ts` 中新增 `KNOWN_EVENT_HOOKS` 常量数组，与现有的 `LIFECYCLE_HOOKS` 和 `KNOWN_FUNCTIONAL_HOOKS` 并列。Event hook 是纯通知型、无返回值，语义上区别于有返回值的 functional hook：

```typescript
export const KNOWN_EVENT_HOOKS = [
  "user:registered",
  "user:login",
  "user:banned",
  "user:unbanned",
  "user:password-changed",
  "user:password-reset",
  "user:oauth-bindchanged",
] as const;

export const ALL_KNOWN_HOOKS = [
  ...LIFECYCLE_HOOKS,
  ...KNOWN_FUNCTIONAL_HOOKS,
  ...KNOWN_EVENT_HOOKS,
] as const;
```

同时添加判别函数：

```typescript
export function isEventHook(name: string): boolean {
  return (KNOWN_EVENT_HOOKS as readonly string[]).includes(name);
}
```

### 2. 新增调用方法

在 `PluginManager` 中新增 `emitUserHook` 方法。使用 `Promise.allSettled` 并行调用所有 handler，避免慢插件拖累其他插件（最坏情况总耗时 = 单个 handler 超时上限 30s，而非 N x 30s）：

```typescript
async emitUserHook<K extends keyof UserHookPayloadMap>(
  hookName: K,
  payload: UserHookPayloadMap[K],
): Promise<void> {
  const handlers = this.hookRegistry.get(hookName);
  if (!handlers.length) return;

  const results = await Promise.allSettled(
    handlers.map((handler) =>
      this.callPluginHook(handler.pluginId, hookName, payload),
    ),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      this.logManager.append(
        handlers[i].pluginId,
        "error",
        `Hook ${hookName} failed: ${result.reason}`,
      );
    }
  }
}
```

### 3. 提供全局访问函数

在 `server/utils/` 中新增 `plugin-hooks.ts`，暴露 auto-import 的辅助函数供 API 路由调用。`getPluginManager()` 已有且全局 auto-import。

增加 host 状态前置检查：当 Host 处于 crashed/stopped 状态时，`bridge.callHook` 会创建挂起 30s 的 Promise（因为 worker 已不存在），因此需要在调用前过滤：

```typescript
export function emitUserHook<K extends keyof UserHookPayloadMap>(
  hookName: K,
  payload: UserHookPayloadMap[K],
): void {
  const manager = getPluginManager();
  if (!manager) return;

  // Host 非运行状态时跳过，避免 IPC 消息堆积
  const { status } = manager.getHostStatus();
  if (status !== "running" && status !== "dirty") return;

  manager.emitUserHook(hookName, payload).catch((err) => {
    console.warn(`[plugin] emitUserHook(${hookName}) unexpected error:`, err);
  });
}
```

### 4. 在触发点调用

各 API 端点在业务操作完成后调用 `emitUserHook`。示例（注册）：

```typescript
// server/api/auth/register.post.ts
// ... insertUser 成功后
emitUserHook('user:registered', {
  uuid: user.uuid,
  email: user.email,
  gameId: user.gameId,
  ip: getRequestIP(event),
  timestamp: Date.now(),
});

return { success: true };
```

## 错误处理

1. **不阻塞业务**：hook 调用在操作完成后进行，fire-and-forget（不 `await`）
2. **并行隔离**：所有 handler 通过 `Promise.allSettled` 并行执行，单个插件报错不影响其他插件
3. **超时保护**：复用 `PluginBridge` 已有的 30 秒超时
4. **Host 状态检查**：crashed/stopped 状态下直接跳过，避免创建无意义的挂起 Promise
5. **异常可见**：
   - 单个 handler 错误写入插件日志（管理员可通过 admin 面板或 SSE 日志流查看）
   - `emitUserHook` 自身的意外错误记录到 console.warn，不静默吞掉

## 性能考量

**已有的保护措施：**
- 并行调用 handler，总耗时不超过单个 handler 超时上限（30s）
- Host 状态前置检查，崩溃时不发 IPC 消息
- fire-and-forget 不阻塞 API 响应

**已知风险与缓解策略：**

在极端高并发场景（如开服高峰大量登录）下，`user:login` 可能高频触发。每次触发会向 Worker 线程发送 N 条 IPC 消息（N = 订阅该 hook 的插件数），如果插件处理缓慢（如外部 HTTP 调用），消息会在 Worker 事件循环中排队，`pendingCalls` Map 中的 entry 也会累积。

第一版不实现背压机制。原因：
- Irminsul 的用户量级通常为中小型 Minecraft 服务器社区，极端高并发场景概率低
- 30 秒超时已提供兜底保护
- 过早优化会增加不必要的复杂度

如果后续监控发现 `pendingCalls` 增长异常，可追加以下措施：
- pending hook calls 超过阈值（如 1000）时跳过新通知并记录 warning
- 对高频 hook（`user:login`）做采样或限流

## 示例插件

### Discord Webhook 通知插件

将用户事件推送到 Discord 频道。体现多 hook 订阅 + 配置字段 + `ctx.fetch` 用法。

**`plugin.yaml`：**

```yaml
name: Discord 通知
version: 1.0.0
description: 将用户事件推送到 Discord Webhook
author: Irminsul
hooks:
  - user:registered
  - user:login
  - user:banned
  - user:unbanned
config:
  - key: webhookUrl
    label: Webhook URL
    type: text
    required: true
  - key: enableLogin
    label: 推送登录事件
    type: boolean
    default: false
```

**`index.js`：**

```js
export function setup(ctx) {
  async function send(content) {
    const { webhookUrl } = ctx.config.getAll();
    if (!webhookUrl) return;
    await ctx.fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  }

  ctx.hook('user:registered', (e) => {
    send(`📋 新用户注册：**${e.gameId}**（${e.email}）`);
  });

  ctx.hook('user:login', (e) => {
    const { enableLogin } = ctx.config.getAll();
    if (!enableLogin) return;
    const methods = { password: '密码', passkey: 'Passkey', oauth: 'OAuth' };
    send(`🔑 用户登录：**${e.gameId}**（${methods[e.method]}）`);
  });

  ctx.hook('user:banned', (e) => {
    const duration = e.end ? `至 ${new Date(e.end).toLocaleDateString()}` : '永久';
    send(`🚫 用户封禁：**${e.gameId}**（${duration}）${e.reason ? `\n理由：${e.reason}` : ''}`);
  });

  ctx.hook('user:unbanned', (e) => {
    send(`✅ 用户解封：**${e.gameId}**`);
  });
}
```

### 安全审计日志插件

记录安全敏感操作的审计日志。体现 `ctx.log` 结构化日志用法。

**`plugin.yaml`：**

```yaml
name: 安全审计
version: 1.0.0
description: 记录安全敏感操作的审计日志
author: Irminsul
hooks:
  - user:password-changed
  - user:password-reset
  - user:oauth-bindchanged
```

**`index.js`：**

```js
export function setup(ctx) {
  ctx.hook('user:password-changed', (e) => {
    ctx.log.set({ uuid: e.uuid, gameId: e.gameId, ip: e.ip });
    ctx.log.info('用户主动修改密码');
  });

  ctx.hook('user:password-reset', (e) => {
    ctx.log.set({ uuid: e.uuid, gameId: e.gameId, ip: e.ip });
    ctx.log.warn('用户通过忘记密码流程重置密码');
  });

  ctx.hook('user:oauth-bindchanged', (e) => {
    ctx.log.set({ uuid: e.uuid, gameId: e.gameId, provider: e.provider });
    const msg = e.action === 'bind'
      ? `绑定 OAuth 账号（${e.displayName}）`
      : `解绑 OAuth 账号`;
    ctx.log.info(msg);
  });
}
```

## 需要修改的文件

| 文件 | 变更 |
|------|------|
| `server/utils/plugin/types.ts` | 新增 `KNOWN_EVENT_HOOKS` 常量、payload 类型定义、`isEventHook` 判别函数；更新 `ALL_KNOWN_HOOKS` |
| `server/utils/plugin/plugin-manager.ts` | 新增 `emitUserHook` 方法 |
| `server/utils/plugin-hooks.ts`（新建） | 暴露 `emitUserHook` 全局辅助函数（含 host 状态检查） |
| `server/api/auth/register.post.ts` | 触发 `user:registered` |
| `server/api/auth/login.post.ts` | 触发 `user:login`（password） |
| `server/api/passkey/auth-verify.post.ts` | 触发 `user:login`（passkey） |
| `server/utils/oauth-callback.ts` | 触发 `user:login`（oauth）+ `user:oauth-bindchanged`（bind） |
| `server/api/user/change-password.post.ts` | 触发 `user:password-changed` |
| `server/api/auth/reset-password.post.ts` | 触发 `user:password-reset` |
| `server/api/oauth/[providerId]/unbind.post.ts` | 触发 `user:oauth-bindchanged`（unbind） |
| `docs/plugin-examples/discord-notify/`（新建） | 示例插件：Discord Webhook 通知 |
| `docs/plugin-examples/security-audit/`（新建） | 示例插件：安全审计日志 |

## 测试策略

为 `emitUserHook` 方法编写单元测试，覆盖以下场景：

- 正常调用时所有 handler 被并行触发
- 单个 handler 报错不影响其他 handler，错误被记录到插件日志
- 无 handler 时立即返回
- payload 完整传递到 handler

为全局辅助函数 `emitUserHook` 编写单元测试，覆盖以下场景：

- `getPluginManager()` 返回 null 时不报错
- Host 处于 crashed/stopped 状态时跳过调用
- Host 处于 running/dirty 状态时正常调用

不需要为每个触发点编写集成测试——触发逻辑是单行调用，通过 code review 确认即可。
