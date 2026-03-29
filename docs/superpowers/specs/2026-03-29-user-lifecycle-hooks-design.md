# 用户生命周期 Hook 设计

## 概述

为插件系统新增用户生命周期钩子，使插件能够响应用户注册、登录、封禁、密码变更、OAuth 绑定变更等关键事件。所有 hook 均为**纯通知型（fire-and-forget）**，不阻塞也不拦截业务流程。

## 设计决策

| 决策 | 结论 | 理由 |
|------|------|------|
| 执行模型 | 纯通知型 | 与现有 functional hook 模式一致；核心操作不应被第三方插件拦截 |
| 命名模式 | 独立命名（`user:registered`） | 与 `evlog:enricher`、`oauth:provider` 风格对齐；payload 类型明确 |
| 范围 | 6 个 hook | 覆盖核心事件 + 安全敏感事件，可选事件留给后续扩展 |

## Hook 定义

### 通用 Payload 字段

所有用户生命周期 hook 的 payload 都包含以下字段：

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

用户被封禁后触发。

| 额外字段 | 类型 | 说明 |
|----------|------|------|
| `reason` | `string \| undefined` | 封禁理由 |
| `end` | `number \| undefined` | 到期时间戳，无则为永久 |
| `operator` | `string` | 操作管理员的 UUID |

### `user:unbanned`

用户被解封后触发。

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

## 触发点

| Hook | 文件 | 时机 |
|------|------|------|
| `user:registered` | `server/api/auth/register.post.ts` | `insertUser` 成功后 |
| `user:login` | `server/api/auth/login.post.ts` | 创建 session 后（method=`"password"`） |
| `user:login` | `server/api/passkey/auth-verify.post.ts` | 创建 session 后（method=`"passkey"`） |
| `user:login` | `server/utils/oauth-callback.ts` | OAuth 登录成功后（method=`"oauth"`） |
| `user:banned` | 未来的 ban 管理端点 | 添加 ban record 后 |
| `user:unbanned` | 未来的 unban 管理端点 | 移除 ban record 后 |
| `user:password-changed` | `server/api/user/change-password.post.ts` | 密码更新后、session 销毁前 |
| `user:password-reset` | `server/api/auth/reset-password.post.ts` | 密码重置成功后 |
| `user:oauth-bindchanged` | `server/utils/oauth-callback.ts` | 绑定成功后（action=`"bind"`） |
| `user:oauth-bindchanged` | `server/api/oauth/[providerId]/unbind.post.ts` | 解绑成功后（action=`"unbind"`） |

## 实现方案

### 1. 注册 Hook 名称

在 `server/utils/plugin/types.ts` 的 `KNOWN_FUNCTIONAL_HOOKS` 数组中添加 6 个新 hook 名称：

```typescript
export const KNOWN_FUNCTIONAL_HOOKS = [
  // ... 现有 hooks
  "user:registered",
  "user:login",
  "user:banned",
  "user:unbanned",
  "user:password-changed",
  "user:password-reset",
  "user:oauth-bindchanged",
] as const;
```

### 2. 新增调用方法

在 `PluginManager` 中新增 `emitUserHook` 方法，复用现有的 `hookRegistry` + `callPluginHook`（已有的公共方法，内部调用 `bridge.callHook`）：

```typescript
async emitUserHook(hookName: string, payload: Record<string, unknown>): Promise<void> {
  const handlers = this.hookRegistry.get(hookName);
  if (!handlers.length) return;

  for (const handler of handlers) {
    try {
      await this.callPluginHook(handler.pluginId, hookName, payload);
    } catch (err) {
      this.logManager.append(handler.pluginId, 'error', `Hook ${hookName} failed: ${err}`);
    }
  }
}
```

### 3. 提供全局访问函数

在 `server/utils/` 中新增 `plugin-hooks.ts`，暴露 auto-import 的辅助函数供 API 路由调用。`getPluginManager()` 已有且全局 auto-import：

```typescript
export function emitUserHook(hookName: string, payload: Record<string, unknown>): void {
  const manager = getPluginManager();
  if (!manager) return;
  // fire-and-forget: 不 await，不阻塞业务
  manager.emitUserHook(hookName, payload).catch(() => {});
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

1. **不阻塞业务**：hook 调用在操作完成后进行，fire-and-forget
2. **逐个隔离**：单个插件报错不影响其他插件
3. **超时保护**：复用 `PluginBridge` 已有的 30 秒超时
4. **错误可见**：错误写入插件日志，管理员可通过 admin 面板或 SSE 日志流查看

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
| `server/utils/plugin/types.ts` | 在 `KNOWN_FUNCTIONAL_HOOKS` 中添加 6 个 hook 名称 |
| `server/utils/plugin/plugin-manager.ts` | 新增 `emitUserHook` 方法 |
| `server/utils/plugin-hooks.ts`（新建） | 暴露 `emitUserHook` 全局辅助函数 |
| `server/api/auth/register.post.ts` | 触发 `user:registered` |
| `server/api/auth/login.post.ts` | 触发 `user:login`（password） |
| `server/api/passkey/auth-verify.post.ts` | 触发 `user:login`（passkey） |
| `server/utils/oauth-callback.ts` | 触发 `user:login`（oauth）+ `user:oauth-bindchanged`（bind） |
| `server/api/user/change-password.post.ts` | 触发 `user:password-changed` |
| `server/api/auth/reset-password.post.ts` | 触发 `user:password-reset` |
| `server/api/oauth/[providerId]/unbind.post.ts` | 触发 `user:oauth-bindchanged`（unbind） |
| `docs/plugin-examples/discord-notify/` | 示例插件：Discord Webhook 通知 |
| `docs/plugin-examples/security-audit/` | 示例插件：安全审计日志 |

## 测试策略

为 `emitUserHook` 方法编写单元测试，验证：
- 正常调用时所有 handler 被触发
- 单个 handler 报错不影响其他 handler
- 无 handler 时立即返回
- payload 完整传递

不需要为每个触发点编写集成测试——触发逻辑是单行调用，通过 code review 确认即可。
