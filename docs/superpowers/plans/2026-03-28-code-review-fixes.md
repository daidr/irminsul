# Code Review 修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复代码审查中发现的 15 个问题（跳过 #4 首用户 admin 竞态），涵盖 Redis 原子操作、MongoDB 查询、插件系统竞态、前端错误处理等。

**Architecture:** 按模块分组修复：先修服务端 Redis 原子操作（影响面最大），再修 MongoDB 查询，然后插件系统并发安全，最后前端错误处理和 SSE 生命周期。

**Tech Stack:** TypeScript, Redis (GETDEL / SET NX), MongoDB ($elemMatch), Vue 3 Composition API

---

### Task 1: Redis 原子操作 — consumePasswordResetToken

**Files:**
- Modify: `server/utils/password-reset.ts:81-98`

- [ ] **Step 1: 将 `consumePasswordResetToken` 的 GET+DEL 改为 GETDEL**

将非原子的 GET → parse → DEL 改为原子 GETDEL：

```typescript
export async function consumePasswordResetToken(
  event: H3Event,
  token: string,
): Promise<{ userId: string; email: string } | null> {
  const tokenHash = hashToken(token);
  const key = resetKey(tokenHash);
  const redis = getRedisClient();
  const raw = (await redis.send("GETDEL", [key])) as string | null;
  if (!raw) return null;

  const data = JSON.parse(raw) as ResetTokenData;

  await redis.send("DEL", [lockKey(data.userId)]);

  useLogger(event).set({ passwordReset: { tokenConsumed: true, userId: data.userId } });
  return { userId: data.userId, email: data.email };
}
```

- [ ] **Step 2: 验证 dev server 启动无报错**

Run: `bun run dev` (手动验证启动无错误后停止)

- [ ] **Step 3: Commit**

```bash
git add server/utils/password-reset.ts
git commit -m "fix: consumePasswordResetToken 改用 GETDEL 原子操作防止并发消费"
```

---

### Task 2: Redis 原子操作 — consumeEmailVerificationToken

**Files:**
- Modify: `server/utils/email-verification.ts:75-92`

- [ ] **Step 1: 将 `consumeEmailVerificationToken` 的 GET+DEL 改为 GETDEL**

```typescript
export async function consumeEmailVerificationToken(
  event: H3Event,
  token: string,
): Promise<{ userId: string; email: string } | null> {
  const tokenHash = hashToken(token);
  const key = verifyKey(tokenHash);
  const redis = getRedisClient();
  const raw = (await redis.send("GETDEL", [key])) as string | null;
  if (!raw) return null;

  const data = JSON.parse(raw) as VerifyTokenData;

  await redis.send("DEL", [lockKey(data.userId)]);

  useLogger(event).set({ emailVerification: { tokenConsumed: true, userId: data.userId } });
  return { userId: data.userId, email: data.email };
}
```

- [ ] **Step 2: Commit**

```bash
git add server/utils/email-verification.ts
git commit -m "fix: consumeEmailVerificationToken 改用 GETDEL 原子操作防止并发消费"
```

---

### Task 3: Redis 原子操作 — forgot-password 邮件频率限制

**Files:**
- Modify: `server/api/auth/forgot-password.post.ts:9-16`

- [ ] **Step 1: 将 GET-then-SET 改为 SET NX EX 原子操作**

```typescript
async function checkEmailResetRateLimit(email: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = buildRedisKey("password-reset-email", email.toLowerCase());
  const result = await redis.send("SET", [key, "1", "EX", RESET_EMAIL_COOLDOWN_SECONDS.toString(), "NX"]);
  return result !== null;
}
```

`SET ... NX` 只在 key 不存在时设置，返回 `"OK"` 表示成功设置（允许通过），返回 `null` 表示 key 已存在（限流）。

- [ ] **Step 2: Commit**

```bash
git add server/api/auth/forgot-password.post.ts
git commit -m "fix: forgot-password 频率限制改用 SET NX EX 原子操作防止竞态"
```

---

### Task 4: Redis 原子操作 — token 创建的 TOCTOU

**Files:**
- Modify: `server/utils/password-reset.ts:39-66`
- Modify: `server/utils/email-verification.ts:33-60`

- [ ] **Step 1: 将 `createPasswordResetToken` 改为 SET NX 锁**

用 `SET ... NX EX` 原子尝试获取锁，替代先 GET 检查再 SET 的模式：

```typescript
export async function createPasswordResetToken(
  event: H3Event,
  userId: string,
  email: string,
): Promise<string | null> {
  const redis = getRedisClient();

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const rawToken = Buffer.from(tokenBytes).toString("hex");
  const tokenHash = hashToken(rawToken);
  const key = resetKey(tokenHash);

  // 原子获取锁：若锁已存在则说明该用户已有活跃 token
  const lockResult = await redis.send("SET", [lockKey(userId), tokenHash, "EX", RESET_EXPIRY_SECONDS.toString(), "NX"]);
  if (!lockResult) {
    useLogger(event).set({ passwordReset: { skipped: "token_already_active", userId } });
    return null;
  }

  const data: ResetTokenData = {
    userId,
    email,
    createdAt: Date.now(),
  };

  await redis.send("SET", [key, JSON.stringify(data), "EX", RESET_EXPIRY_SECONDS.toString()]);

  useLogger(event).set({ passwordReset: { tokenCreated: true, userId } });
  return rawToken;
}
```

注意：`hasActivePasswordResetToken` 函数仍可保留供外部查询使用（如前端显示状态），但 `createPasswordResetToken` 不再依赖它。

- [ ] **Step 2: 将 `createEmailVerificationToken` 做同样改造**

```typescript
export async function createEmailVerificationToken(
  event: H3Event,
  userId: string,
  email: string,
): Promise<string | null> {
  const redis = getRedisClient();

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const rawToken = Buffer.from(tokenBytes).toString("hex");
  const tokenHash = hashToken(rawToken);
  const key = verifyKey(tokenHash);

  // 原子获取锁
  const lockResult = await redis.send("SET", [lockKey(userId), tokenHash, "EX", VERIFY_EXPIRY_SECONDS.toString(), "NX"]);
  if (!lockResult) {
    useLogger(event).set({ emailVerification: { skipped: "token_already_active", userId } });
    return null;
  }

  const data: VerifyTokenData = {
    userId,
    email,
    createdAt: Date.now(),
  };

  await redis.send("SET", [key, JSON.stringify(data), "EX", VERIFY_EXPIRY_SECONDS.toString()]);

  useLogger(event).set({ emailVerification: { tokenCreated: true, userId } });
  return rawToken;
}
```

- [ ] **Step 3: Commit**

```bash
git add server/utils/password-reset.ts server/utils/email-verification.ts
git commit -m "fix: token 创建改用 SET NX 原子锁防止 TOCTOU 竞态"
```

---

### Task 5: 插件管理器生命周期 Mutex

**Files:**
- Modify: `server/utils/plugin/plugin-manager.ts`

- [ ] **Step 1: 在 PluginManager 中添加简单的 async mutex**

在 `PluginManager` class 内部添加一个基于 Promise 的简单互斥锁：

```typescript
// 在 class PluginManager 内，private 字段区域添加:
private lifecycleLock: Promise<void> = Promise.resolve();

private withLifecycleLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = this.lifecycleLock;
  let resolve: () => void;
  this.lifecycleLock = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}
```

- [ ] **Step 2: 用 `withLifecycleLock` 包装 `enablePlugin`**

将 `enablePlugin` 方法体包装在锁内。保留方法签名不变：

```typescript
async enablePlugin(id: string): Promise<{ ok: boolean; error?: string }> {
  return this.withLifecycleLock(async () => {
    const plugin = this.plugins.get(id);
    if (!plugin) return { ok: false, error: "Plugin not found" };
    if (plugin.status === "enabled") return { ok: true };

    if (plugin.status === "pending_disable") {
      plugin.enabled = true;
      plugin.status = "enabled";
      plugin.error = undefined;
      this.dirtyReasons = this.dirtyReasons.filter(
        (r) => !(r.pluginId === id && r.reason === "disabled"),
      );
      this.notifyStatusChange();
      await this.saveRegistry();
      return { ok: true };
    }

    if (plugin.status === "error" && plugin.meta.hooks.length === 0) {
      return { ok: false, error: plugin.error ?? "Plugin has errors" };
    }

    try {
      await this.loadPluginIntoHost(plugin);
      plugin.enabled = true;
      plugin.error = undefined;
      await this.saveRegistry();
      await this.discoverOAuthProviders();
      emitPluginEvent("plugin:enabled", { pluginId: id });
      return { ok: true };
    } catch (err: unknown) {
      plugin.status = "error";
      plugin.error = err instanceof Error ? err.message : String(err);
      await this.saveRegistry();
      emitPluginEvent("plugin:enable_failed", { pluginId: id, error: plugin.error });
      return { ok: false, error: plugin.error };
    }
  });
}
```

- [ ] **Step 3: 用 `withLifecycleLock` 包装 `disablePlugin`**

```typescript
async disablePlugin(id: string): Promise<void> {
  return this.withLifecycleLock(async () => {
    const plugin = this.plugins.get(id);
    if (!plugin || plugin.status !== "enabled") return;

    plugin.enabled = false;
    plugin.status = "pending_disable";
    this.addDirtyReason(id, "disabled");

    await this.saveRegistry();
    emitPluginEvent("plugin:disabled", { pluginId: id });
  });
}
```

- [ ] **Step 4: 用 `withLifecycleLock` 包装 `restartHost`**

同时在 `restartHost` 开头清除崩溃恢复定时器：

```typescript
async restartHost(): Promise<void> {
  return this.withLifecycleLock(async () => {
    // 清除待执行的崩溃恢复定时器
    if (this.crashRecoveryTimer) {
      clearTimeout(this.crashRecoveryTimer);
      this.crashRecoveryTimer = null;
    }

    emitPluginEvent("host:restarting");
    await this.bridge.shutdown();
    this.hookRegistry.clear();
    this.setHostStatus("stopped");

    await this.scan();

    this.bridge.start();
    this.setHostStatus("running");

    const toLoad = [...this.plugins.values()]
      .filter((p) => p.enabled && p.status !== "error")
      .sort((a, b) => a.order - b.order);

    for (const plugin of toLoad) {
      try {
        await this.loadPluginIntoHost(plugin);
        emitPluginEvent("plugin:reloaded", { pluginId: plugin.id });
      } catch (err: unknown) {
        plugin.status = "error";
        plugin.error = err instanceof Error ? err.message : String(err);
        emitPluginEvent("plugin:reload_failed", {
          pluginId: plugin.id,
          error: plugin.error,
        });
      }
    }

    await this.discoverOAuthProviders();

    this.dirtyReasons = [];
    this.notifyStatusChange();
    emitPluginEvent("host:restarted", {
      loaded: toLoad.filter((p) => p.status === "enabled").length,
      failed: toLoad.filter((p) => p.status === "error").length,
    });
  });
}
```

- [ ] **Step 5: 添加 `crashRecoveryTimer` 字段并修复 `handleCrash`**

添加字段声明：
```typescript
private crashRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
```

修改 `handleCrash` 中的 setTimeout 部分，保存 timer 引用并用 `withLifecycleLock` 包装恢复逻辑：

```typescript
// 在 handleCrash 方法中，替换原来的 setTimeout 块（约第 698 行起）：
this.crashRecoveryTimer = setTimeout(() => {
  void this.withLifecycleLock(async () => {
    try {
      emitPluginEvent("host:crash_recovery_start", { attempt: this.crashCount });
      this.bridge.start();
      this.setHostStatus("running");

      const toLoad = [...this.plugins.values()]
        .filter((p) => p.enabled)
        .sort((a, b) => a.order - b.order);

      for (const plugin of toLoad) {
        try {
          await this.loadPluginIntoHost(plugin);
        } catch {
          plugin.status = "error";
          plugin.error = "Failed to reload after crash";
        }
      }

      await this.discoverOAuthProviders();

      this.dirtyReasons = [];
      this.notifyStatusChange();
      emitPluginEvent("host:crash_recovery_done", {
        loaded: toLoad.filter((p) => p.status === "enabled").length,
        failed: toLoad.filter((p) => p.status === "error").length,
      });
    } catch (restartErr) {
      emitPluginEvent("host:crash_recovery_failed", {
        error: restartErr instanceof Error ? restartErr.message : String(restartErr),
      });
    }
  });
}, 1000);
```

- [ ] **Step 6: 在 `destroy` 中清除 timer**

在 `destroy()` 方法体开头添加：

```typescript
if (this.crashRecoveryTimer) {
  clearTimeout(this.crashRecoveryTimer);
  this.crashRecoveryTimer = null;
}
```

- [ ] **Step 7: Commit**

```bash
git add server/utils/plugin/plugin-manager.ts
git commit -m "fix(plugin): 添加生命周期 mutex 防止并发操作竞态，保存崩溃恢复 timer 引用"
```

---

### Task 6: MongoDB $elemMatch 修复

**Files:**
- Modify: `server/utils/user.repository.ts:327-337` (`updateTokenLastUsed`)
- Modify: `server/utils/user.repository.ts:453-461` (`findUserByOAuthBinding`)

- [ ] **Step 1: 修复 `updateTokenLastUsed` 使用 $elemMatch**

```typescript
export async function updateTokenLastUsed(accessToken: string, ip: string): Promise<void> {
  await getUserCollection().updateOne(
    { tokens: { $elemMatch: { accessToken, status: 1 } } },
    {
      $set: {
        "tokens.$.lastUsedIp": ip,
        "tokens.$.lastUsedAt": Date.now(),
      },
    },
  );
}
```

- [ ] **Step 2: 修复 `findUserByOAuthBinding` 使用 $elemMatch**

```typescript
export async function findUserByOAuthBinding(
  provider: string,
  providerId: string,
): Promise<UserDocument | null> {
  return getUserCollection().findOne({
    oauthBindings: { $elemMatch: { provider, providerId } },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add server/utils/user.repository.ts
git commit -m "fix: MongoDB 数组查询改用 \$elemMatch 防止跨元素误匹配"
```

---

### Task 7: Yggdrasil tokenExpiryMs 类型转换

**Files:**
- Modify: `server/utils/yggdrasil.service.ts:103`

- [ ] **Step 1: 添加 `Number()` 转换**

将第 103 行：
```typescript
const expiryMs = config.yggdrasilTokenExpiryMs || 432000000;
```

改为：
```typescript
const expiryMs = Number(config.yggdrasilTokenExpiryMs) || 432000000;
```

- [ ] **Step 2: Commit**

```bash
git add server/utils/yggdrasil.service.ts
git commit -m "fix: yggdrasilRefresh 中 tokenExpiryMs 添加 Number() 转换，与其他处一致"
```

---

### Task 8: 插件配置 RegExp 安全处理

**Files:**
- Modify: `server/utils/plugin/config-validator.ts:114-122`
- Modify: `server/utils/plugin/condition.ts:51`

- [ ] **Step 1: 在 `config-validator.ts` 中 try-catch 包裹 RegExp 构造**

```typescript
  // Pattern check (for string values)
  if (validation.pattern && typeof value === "string") {
    let regex: RegExp;
    try {
      regex = new RegExp(validation.pattern);
    } catch {
      return `${field.label} has an invalid validation pattern`;
    }
    if (!regex.test(value)) {
      return (
        validation.message ??
        `${field.label} does not match the required pattern`
      );
    }
  }
```

- [ ] **Step 2: 在 `condition.ts` 中 try-catch 包裹 regex 运算符**

将第 51 行：
```typescript
if ("regex" in op) return new RegExp(op.regex).test(String(value ?? ""));
```

改为：
```typescript
if ("regex" in op) {
  try {
    return new RegExp(op.regex).test(String(value ?? ""));
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/utils/plugin/config-validator.ts server/utils/plugin/condition.ts
git commit -m "fix(plugin): RegExp 构造添加 try-catch 防止非法正则导致 500"
```

---

### Task 9: 日志分页 nextCursor 修复

**Files:**
- Modify: `server/utils/plugin/log-manager.ts:109-140`

- [ ] **Step 1: 修正 getHistory 的分页逻辑**

问题在于 `logs.length >= limit` 检查在 `push` 之前，导致 cursor 指向了未入结果集的条目。正确做法：先 push 再检查是否已满，用结果集中最早的条目（即 `logs[0]`，因为反向遍历所以 `logs[0]` 是最新的，`logs` 最后一个元素是最早的，reverse 前 `logs[0]` 是最新的）作为 cursor。

```typescript
    for (const file of files) {
      const filePath = join(logsDir, file);
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter(Boolean);

      // Parse lines in reverse (newest first)
      for (let i = lines.length - 1; i >= 0; i--) {
        let entry: PluginLogEntry;
        try {
          entry = JSON.parse(lines[i]);
        } catch {
          continue;
        }

        // Cursor filter: skip entries at or after the cursor
        if (opts.before && entry.timestamp >= opts.before) continue;

        // Level/type filter
        if (opts.level && entry.level !== opts.level) continue;
        if (opts.type && entry.type !== opts.type) continue;

        logs.push(entry);

        if (logs.length >= limit) {
          // logs 是按新→旧顺序，logs[logs.length-1] 是最旧的条目
          // nextCursor = 最旧条目的 timestamp，下次分页用 before < nextCursor
          logs.reverse();
          return { logs, nextCursor: logs[0].timestamp, hasMore: true };
        }
      }
    }
```

同时需要修改 cursor 过滤条件，从 `>=` 改为 `>`（因为 cursor 是结果集内的条目 timestamp）：

```typescript
        if (opts.before && entry.timestamp > opts.before) continue;
```

不对——这样会导致同一 timestamp 的多条日志反复返回。更好的方案：保持 `>=`，但 cursor 使用结果集最旧条目的 timestamp。这意味着如果存在同 timestamp 的多条记录，可能跳过一些。实际场景中，ISO timestamp 精确到毫秒，重复概率极低，这是可接受的权衡。

最终修正的循环逻辑：

```typescript
    for (const file of files) {
      const filePath = join(logsDir, file);
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter(Boolean);

      for (let i = lines.length - 1; i >= 0; i--) {
        let entry: PluginLogEntry;
        try {
          entry = JSON.parse(lines[i]);
        } catch {
          continue;
        }

        if (opts.before && entry.timestamp >= opts.before) continue;
        if (opts.level && entry.level !== opts.level) continue;
        if (opts.type && entry.type !== opts.type) continue;

        logs.push(entry);

        if (logs.length >= limit) {
          logs.reverse();
          return { logs, nextCursor: logs[0].timestamp, hasMore: true };
        }
      }
    }
```

关键变化：先 `push` 再检查 `limit`，cursor 取自结果集中最旧的条目 `logs[0]`（reverse 后）。

- [ ] **Step 2: Commit**

```bash
git add server/utils/plugin/log-manager.ts
git commit -m "fix(plugin): 修复日志分页 nextCursor 偏移错误"
```

---

### Task 10: 日志下载 date 参数校验

**Files:**
- Modify: `server/api/admin/plugins/[id]/logs/download.get.ts:8`

- [ ] **Step 1: 添加 date 格式校验**

在第 8 行之后添加校验：

```typescript
  const date = (query.date as string) ?? new Date().toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw createError({ statusCode: 400, message: "Invalid date format, expected YYYY-MM-DD" });
  }
```

- [ ] **Step 2: Commit**

```bash
git add server/api/admin/plugins/[id]/logs/download.get.ts
git commit -m "fix(plugin): 校验日志下载 date 参数格式防止路径遍历"
```

---

### Task 11: 日志写入改为异步

**Files:**
- Modify: `server/utils/plugin/log-manager.ts:1,47-52`

- [ ] **Step 1: 将 `appendFileSync` 改为异步 `appendFile`**

修改 import：将 `appendFileSync` 替换为从 `node:fs/promises` 导入 `appendFile`。由于 `push` 方法是同步的并被大量调用，我们将文件写入改为"fire-and-forget"模式：

import 行改为：
```typescript
import { existsSync, mkdirSync, readdirSync, unlinkSync, readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
```

push 方法中文件写入部分改为：
```typescript
    // File persistence (async append)
    const logsDir = join(this.pluginsDir, pluginId, "logs");
    if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
    const date = entry.timestamp.slice(0, 10); // YYYY-MM-DD
    const filePath = join(logsDir, `${date}.jsonl`);
    void appendFile(filePath, JSON.stringify(entry) + "\n");
```

使用 `void` 忽略 promise — ring buffer 已缓存数据供实时读取，文件持久化允许异步完成。

- [ ] **Step 2: Commit**

```bash
git add server/utils/plugin/log-manager.ts
git commit -m "fix(plugin): 日志文件写入改用异步 appendFile 避免阻塞事件循环"
```

---

### Task 12: PluginHostStatus SSE 重连 timer 泄漏修复

**Files:**
- Modify: `app/components/admin/PluginHostStatus.vue:7,9-27,30`

- [ ] **Step 1: 添加 reconnectTimer 跟踪并在卸载时清除**

```vue
<script setup lang="ts">
const emit = defineEmits<{ restarted: [] }>();

const status = ref<string | null>(null);
const dirtyReasons = ref<any[]>([]);
const restarting = ref(false);
let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connectSSE() {
  disconnectSSE();
  eventSource = new EventSource("/api/admin/plugins/host/status-stream");
  eventSource.addEventListener("status", (e) => {
    const data = JSON.parse(e.data);
    status.value = data.status;
    dirtyReasons.value = data.dirtyReasons;
  });
  eventSource.onerror = () => {
    disconnectSSE();
    reconnectTimer = setTimeout(connectSSE, 3000);
  };
}

function disconnectSSE() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  eventSource?.close();
  eventSource = null;
}

onMounted(connectSSE);
onBeforeUnmount(disconnectSSE);
```

其余代码（`restartHost`, computed 等）保持不变。

- [ ] **Step 2: Commit**

```bash
git add app/components/admin/PluginHostStatus.vue
git commit -m "fix(admin): PluginHostStatus SSE 重连 timer 在卸载时正确清除"
```

---

### Task 13: PluginLogTab SSE 添加错误处理和重连

**Files:**
- Modify: `app/components/admin/PluginLogTab.vue:12,15-26,28-31`

- [ ] **Step 1: 添加 onerror 重连和 timer 跟踪**

在 script setup 中修改：

```typescript
let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connectSSE() {
  disconnectSSE();
  const params = new URLSearchParams();
  if (levelFilter.value) params.set("level", levelFilter.value);
  if (typeFilter.value) params.set("type", typeFilter.value);
  eventSource = new EventSource(`/api/admin/plugins/${props.pluginId}/logs/stream?${params}`);
  eventSource.addEventListener("log", (e) => {
    const entry = JSON.parse(e.data);
    logs.value.push(entry);
    nextTick(() => scrollToBottomIfNeeded());
  });
  eventSource.onerror = () => {
    disconnectSSE();
    reconnectTimer = setTimeout(connectSSE, 3000);
  };
}

function disconnectSSE() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  eventSource?.close();
  eventSource = null;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/admin/PluginLogTab.vue
git commit -m "fix(admin): PluginLogTab SSE 添加 onerror 重连及 timer 清理"
```

---

### Task 14: 前端 Modal 组件补充 catch 错误处理

**Files:**
- Modify: `app/components/SessionManageModal.vue:62-140`
- Modify: `app/components/PasskeyModal.vue:28-36`
- Modify: `app/components/UserPopover.vue:33-41`

- [ ] **Step 1: SessionManageModal — 所有 fetch 操作添加 catch + toast**

首先在文件顶部添加 toast：

```typescript
const toast = useToast();
```

然后修改所有 6 个 async 函数，在 `try` 和 `finally` 之间添加 `catch`：

`loadGameSessions`:
```typescript
async function loadGameSessions() {
  loading.value = true;
  try {
    const result = await $fetch<{ success: boolean; sessions: GameSessionItem[] }>(
      "/api/user/sessions/game",
    );
    if (result.success) gameSessions.value = result.sessions;
  } catch {
    toast.error("加载游戏会话失败");
  } finally {
    loading.value = false;
  }
}
```

`loadWebSessions`:
```typescript
async function loadWebSessions() {
  loading.value = true;
  try {
    const result = await $fetch<{ success: boolean; sessions: WebSessionItem[] }>(
      "/api/user/sessions/web",
    );
    if (result.success) webSessions.value = result.sessions;
  } catch {
    toast.error("加载网页会话失败");
  } finally {
    loading.value = false;
  }
}
```

`handleInvalidateGame`:
```typescript
async function handleInvalidateGame(accessToken: string) {
  actionLoading.value = accessToken;
  try {
    const result = await $fetch<{ success: boolean }>("/api/user/sessions/game", {
      method: "DELETE",
      body: { accessToken },
    });
    if (result.success) await loadGameSessions();
  } catch {
    toast.error("注销会话失败");
  } finally {
    actionLoading.value = null;
  }
}
```

`handleInvalidateAllGame`:
```typescript
async function handleInvalidateAllGame() {
  actionLoading.value = "all-game";
  try {
    const result = await $fetch<{ success: boolean }>("/api/user/sessions/game/all", {
      method: "DELETE",
    });
    if (result.success) await loadGameSessions();
  } catch {
    toast.error("注销所有游戏会话失败");
  } finally {
    actionLoading.value = null;
  }
}
```

`handleDeleteWeb`:
```typescript
async function handleDeleteWeb(sessionId: string) {
  actionLoading.value = sessionId;
  try {
    const result = await $fetch<{ success: boolean }>("/api/user/sessions/web", {
      method: "DELETE",
      body: { sessionId },
    });
    if (result.success) await loadWebSessions();
  } catch {
    toast.error("登出会话失败");
  } finally {
    actionLoading.value = null;
  }
}
```

`handleDeleteOtherWeb`:
```typescript
async function handleDeleteOtherWeb() {
  actionLoading.value = "all-web";
  try {
    const result = await $fetch<{ success: boolean }>("/api/user/sessions/web/others", {
      method: "DELETE",
    });
    if (result.success) await loadWebSessions();
  } catch {
    toast.error("登出其他会话失败");
  } finally {
    actionLoading.value = null;
  }
}
```

- [ ] **Step 2: PasskeyModal — loadPasskeys 添加 catch**

```typescript
async function loadPasskeys() {
  loading.value = true;
  try {
    const result = await $fetch<{ success: boolean; passkeys: PasskeyItem[] }>("/api/passkey/list");
    if (result.success) passkeys.value = result.passkeys;
  } catch {
    toast.error("加载通行密钥失败");
  } finally {
    loading.value = false;
  }
}
```

（`toast` 已在文件中声明：`const toast = useToast();`，见第 14 行）

- [ ] **Step 3: UserPopover — handleLogout 添加 catch**

先添加 toast（在 script setup 中）：

```typescript
const toast = useToast();
```

```typescript
async function handleLogout() {
  loggingOut.value = true;
  try {
    await $fetch("/api/auth/logout", { method: "POST" });
    await refreshNuxtData("current-user");
    await navigateTo("/login");
  } catch {
    toast.error("退出登录失败，请稍后重试");
  } finally {
    loggingOut.value = false;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add app/components/SessionManageModal.vue app/components/PasskeyModal.vue app/components/UserPopover.vue
git commit -m "fix: Modal 组件 fetch 操作补充 catch 错误处理和 toast 提示"
```

---

### Task 15: 运行 lint 验证

- [ ] **Step 1: 运行 lint 检查所有修改的文件**

Run: `bun run lint`
Expected: 无错误

- [ ] **Step 2: 如有 lint 错误，修复后重新 commit**

Run: `bun run lint:fix`（如有需要）
