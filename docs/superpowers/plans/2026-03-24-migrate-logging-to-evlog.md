# 日志迁移至 evlog — 实现计划

> **给代理执行者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐步执行。步骤使用 checkbox (`- [ ]`) 语法跟踪进度。

**目标：** 将 @logtape/logtape 替换为 evlog wide events，请求日志使用 `useLogger`，非请求日志使用 `createLogger`，搭建带文件输出和可扩展结构的 drain 管道。采样率和文件保留数通过环境变量配置。

**架构：** evlog/nuxt 模块自动为所有服务端路由创建 wide event（每请求一个事件）。服务端工具函数通过 `useLogger()`（Nitro async context）丰富请求的 wide event。非请求代码（启动插件、启动工具函数）使用 `createLogger` + 手动 `emit()`。所有日志流经统一的 drain 管道（文件系统 + 未来的外部 drain）。采样率和最大日志文件数通过 `IRMIN_EVLOG_*` 环境变量控制。

**技术栈：** evlog v2.9+（已安装）、evlog/nuxt 模块、evlog/fs drain 适配器、evlog/pipeline、Nuxt 4 / Nitro

**参考：** 设计文档 `docs/superpowers/specs/2026-03-24-migrate-logging-to-evlog-design.md`

---

## 文件结构

### 新建文件
- `server/plugins/02.evlog-drain.ts` — 带 pipeline 的文件系统 drain 插件（替代 logtape 文件输出）

### 修改文件
- `nuxt.config.ts` — 添加 evlog/nuxt 模块、采样配置，移除 @logtape/logtape 外部依赖，移除 `appLogLevel`
- `package.json` — 移除 @logtape/logtape 和 @logtape/otel 依赖

### 删除文件
- `server/plugins/02.init-log.ts` — Logtape 初始化插件（被 evlog/nuxt 替代）

### 需迁移的启动插件（6 个文件）
- `server/plugins/00.runtime-check.ts` — 4 个 console.log/error 调用
- `server/plugins/01.init-dirs.ts` — 1 个 console.log 调用
- `server/plugins/03.db.ts` — 1 个 console.log 调用
- `server/plugins/04.init-indexes.ts` — 1 个 console.log 调用
- `server/plugins/05.init-settings.ts` — 1 个 console.log 调用
- `server/plugins/07.init-secrets.ts` — 1 个 console.log 调用

### 需迁移的服务端工具函数（12 个文件）

**启动专用日志（转为 `createLogger`）— 4 个文件：**
- `server/utils/settings.repository.ts` — 3 个日志调用（启动函数）
- `server/utils/user.repository.ts` — 1 个日志调用（启动函数）
- `server/utils/yggdrasil.crypto.ts` — 3 个日志调用（启动函数）
- `server/utils/secrets.ts` — 3 个日志调用（启动函数）

**请求上下文日志（转为 `useLogger`）— 8 个文件：**
- `server/utils/email.service.ts` — 3 个日志调用（warn + info + error）
- `server/utils/email-verification.ts` — 3 个日志调用（info）
- `server/utils/password-reset.ts` — 3 个日志调用（info）
- `server/utils/password.ts` — 1 个日志调用（warn）
- `server/utils/rate-limit.ts` — 3 个日志调用（warn + info）
- `server/utils/texture.service.ts` — 3 个日志调用（info）
- `server/utils/yggdrasil.service.ts` — 5 个日志调用（info）
- `server/utils/yggdrasil.handler.ts` — 1 个日志调用（error）+ 需要传递 useLogger(event)

### 需迁移的 API 路由（8 个文件）
- `server/api/auth/login.post.ts` — 2 个日志调用（info + error）
- `server/api/auth/forgot-password.post.ts` — 2 个日志调用（error）
- `server/api/auth/reset-password.post.ts` — 1 个日志调用（info）
- `server/api/auth/verify-email.post.ts` — 2 个日志调用（warn + info）
- `server/api/auth/send-verification-email.post.ts` — 2 个日志调用（error）
- `server/api/user/change-password.post.ts` — 1 个日志调用（info）
- `server/api/passkey/auth-verify.post.ts` — 5 个日志调用（debug）
- `server/api/passkey/register-verify.post.ts` — 2 个日志调用（debug）

---

## 迁移模式

### 模式 A：启动插件日志
```typescript
// 迁移前
export default defineNitroPlugin(async () => {
  console.log("[Plugin 04] Init indexes");
  await ensureUserIndexes();
});

// 迁移后（createLogger 由 evlog/nuxt 自动导入）
export default defineNitroPlugin(async () => {
  const log = createLogger({ category: "startup" });
  log.set({ plugin: "04.init-indexes", action: "start" });
  await ensureUserIndexes();
  log.set({ action: "complete" });
  log.emit();
});
```

### 模式 B：启动工具函数
```typescript
// 迁移前
import { getLogger } from "@logtape/logtape";
const logger = getLogger(["irminsul", "db"]);
export async function ensureIndexes() {
  // ...
  logger.info`Indexes ensured.`;
}

// 迁移后（createLogger 自动导入）
export async function ensureIndexes() {
  const log = createLogger({ category: "db" });
  // ...
  log.set({ action: "ensureIndexes", status: "complete" });
  log.emit();
}
```

### 模式 C：请求上下文工具函数
```typescript
// 迁移前
import { getLogger } from "@logtape/logtape";
const logger = getLogger(["irminsul", "auth"]);
export async function createToken(userId: string) {
  // ...
  logger.info`Token created for user ${userId}`;
}

// 迁移后（useLogger 自动导入）
export async function createToken(userId: string) {
  // ...
  useLogger().set({ auth: { tokenCreated: true, userId } });
}
```

### 模式 D：请求上下文错误记录
```typescript
// 迁移前
logger.error`Failed to send email to ${to}: ${err}`;

// 迁移后
useLogger().error(err as Error, { step: "email_send", to });
```

### 模式 E：事件处理器日志
```typescript
// 迁移前
import { getLogger } from "@logtape/logtape";
const logger = getLogger(["irminsul", "auth"]);
export default defineEventHandler(async (event) => {
  // ...
  logger.info`Password changed for user ${uuid}`;
});

// 迁移后（useLogger 自动导入）
export default defineEventHandler(async (event) => {
  const log = useLogger(event);
  // ...
  log.set({ auth: { action: "password_changed", userId: uuid } });
});
```

### 模式 F：调试日志（通行密钥验证）
```typescript
// 迁移前
logger.debug`Passkey login failed: no user for ${credentialId}`;

// 迁移后
useLogger(event).set({ passkey: { failure: "no_user_found", credentialId } });
```

---

## 任务

### 任务 1：基础设施搭建

**文件：**
- 修改：`nuxt.config.ts`
- 新建：`server/plugins/02.evlog-drain.ts`
- 删除：`server/plugins/02.init-log.ts`

- [ ] **步骤 1：更新 nuxt.config.ts**

添加 `evlog/nuxt` 到模块，在 runtimeConfig 中添加 evlog 环境变量，从 nitro externals 移除 `@logtape/logtape`，移除 `appLogLevel`：

```typescript
// 在 modules 数组中添加：
"evlog/nuxt",

// 在顶层添加 evlog 配置：
evlog: {
  env: { service: "irminsul" },
},

// 在 nitro.externals.external 中，移除 "@logtape/logtape" 并添加 "evlog"：
external: [
  "mongodb",
  "@simplewebauthn/server",
  "nodemailer",
  "evlog",
],

// 在 runtimeConfig 中，移除 appLogLevel 并添加 evlog 配置：
// 移除：appLogLevel: "debug",
// 添加：
evlogSamplingInfo: 100,    // IRMIN_EVLOG_SAMPLING_INFO
evlogSamplingDebug: 10,    // IRMIN_EVLOG_SAMPLING_DEBUG
evlogMaxFiles: 30,         // IRMIN_EVLOG_MAX_FILES
```

- [ ] **步骤 2：创建 evlog drain 插件**

新建 `server/plugins/02.evlog-drain.ts`：

```typescript
import { createFsDrain } from "evlog/fs";
import { createDrainPipeline } from "evlog/pipeline";
import type { DrainContext } from "evlog";

const LOG_DIR = "./irminsul-data/log";

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig();
  const maxFiles = Number(config.evlogMaxFiles) || 30;
  const samplingInfo = Number(config.evlogSamplingInfo) ?? 100;
  const samplingDebug = Number(config.evlogSamplingDebug) ?? 10;

  const fsDrain = createFsDrain({ dir: LOG_DIR, maxFiles });

  const pipeline = createDrainPipeline<DrainContext>({
    batch: { size: 50, intervalMs: 5000 },
    retry: { maxAttempts: 3 },
  });
  const drain = pipeline(fsDrain);

  // 扩展点：未来在此添加外部 drain
  // 例如：const axiomDrain = pipeline(createAxiomDrain());

  nitroApp.hooks.hook("evlog:drain", drain);
  nitroApp.hooks.hook("close", () => drain.flush());

  // 从环境变量应用采样率
  nitroApp.hooks.hook("evlog:emit:keep", (ctx) => {
    const level = ctx.event?.level;
    if (level === "info" && Math.random() * 100 > samplingInfo) ctx.shouldKeep = false;
    if (level === "debug" && Math.random() * 100 > samplingDebug) ctx.shouldKeep = false;
  });
});
```

- [ ] **步骤 3：删除 logtape 初始化插件**

删除 `server/plugins/02.init-log.ts`。

- [ ] **步骤 4：验证开发服务器启动**

运行：`bun run dev`
预期：服务器正常启动，evlog 初始化无报错

- [ ] **步骤 5：提交**

```bash
rtk git add nuxt.config.ts server/plugins/02.evlog-drain.ts && rtk git rm server/plugins/02.init-log.ts
rtk git commit -m "refactor: replace logtape with evlog/nuxt module and fs drain pipeline"
```

---

### 任务 2：迁移启动插件

将 6 个启动插件从 `console.log` 转为 `createLogger` + `emit()`。

**文件：**
- 修改：`server/plugins/00.runtime-check.ts`
- 修改：`server/plugins/01.init-dirs.ts`
- 修改：`server/plugins/03.db.ts`
- 修改：`server/plugins/04.init-indexes.ts`
- 修改：`server/plugins/05.init-settings.ts`
- 修改：`server/plugins/07.init-secrets.ts`

- [ ] **步骤 1：迁移 00.runtime-check.ts**

```typescript
export default defineNitroPlugin(() => {
  const log = createLogger({ category: "startup" });
  log.set({ plugin: "00.runtime-check" });

  if (typeof Bun === "undefined") {
    log.set({ error: "Irminsul requires Bun runtime" });
    log.emit();
    process.exit(1);
  }

  process.on("uncaughtException", (err) => {
    const errLog = createLogger({ category: "error" });
    errLog.set({ type: "uncaughtException", message: String(err) });
    errLog.error(err);
    errLog.emit();
  });
  process.on("unhandledRejection", (reason) => {
    const errLog = createLogger({ category: "error" });
    errLog.set({ type: "unhandledRejection", message: String(reason) });
    errLog.emit();
  });

  log.set({ status: "ok" });
  log.emit();
});
```

- [ ] **步骤 2：迁移 01.init-dirs.ts**

```typescript
import fs from "node:fs";

const DATA_DIR = "./irminsul-data";
const LOG_DIR = `${DATA_DIR}/log`;
const TEXTURES_DIR = `${DATA_DIR}/textures`;
const AUTO_GENERATE_DIR = `${DATA_DIR}/auto-generate`;

export default defineNitroPlugin(() => {
  const log = createLogger({ category: "startup" });
  log.set({ plugin: "01.init-dirs" });
  for (const dir of [DATA_DIR, LOG_DIR, TEXTURES_DIR, AUTO_GENERATE_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  log.set({ status: "ok" });
  log.emit();
});
```

- [ ] **步骤 3：迁移 03.db.ts**

```typescript
export default defineNitroPlugin((nitroApp) => {
  const log = createLogger({ category: "startup" });
  log.set({ plugin: "03.db", action: "connect" });
  getDb();
  getRedisClient();
  log.set({ status: "ok" });
  log.emit();

  nitroApp.hooks.hook("close", async () => {
    await gracefulCloseDB();
    await gracefulCloseRedis();
  });
});
```

- [ ] **步骤 4：迁移 04.init-indexes.ts**

```typescript
export default defineNitroPlugin(async () => {
  const log = createLogger({ category: "startup" });
  log.set({ plugin: "04.init-indexes" });
  await ensureUserIndexes();
  await ensureSettingsIndexes();
  log.set({ status: "ok" });
  log.emit();
});
```

- [ ] **步骤 5：迁移 05.init-settings.ts**

```typescript
export default defineNitroPlugin(async () => {
  const log = createLogger({ category: "startup" });
  log.set({ plugin: "05.init-settings" });
  await initBuiltinSettings();
  await loadSettingsCache();
  log.set({ status: "ok" });
  log.emit();
});
```

- [ ] **步骤 6：迁移 07.init-secrets.ts**

```typescript
export default defineNitroPlugin(() => {
  const log = createLogger({ category: "startup" });
  log.set({ plugin: "07.init-secrets" });
  loadSecrets();
  log.set({ status: "ok" });
  log.emit();
});
```

- [ ] **步骤 7：提交**

```bash
rtk git add server/plugins/00.runtime-check.ts server/plugins/01.init-dirs.ts server/plugins/03.db.ts server/plugins/04.init-indexes.ts server/plugins/05.init-settings.ts server/plugins/07.init-secrets.ts
rtk git commit -m "refactor: convert startup plugin logging to evlog createLogger"
```

---

### 任务 3：迁移启动专用工具函数

这 4 个文件仅在服务器启动时记录日志（由 plugins 04-07 调用）。将 logtape 转为 `createLogger` + `emit()`。

**文件：**
- 修改：`server/utils/settings.repository.ts`
- 修改：`server/utils/user.repository.ts`
- 修改：`server/utils/yggdrasil.crypto.ts`
- 修改：`server/utils/secrets.ts`

- [ ] **步骤 1：迁移 settings.repository.ts**

移除 logtape 导入和 logger。将 3 个日志调用替换为 `createLogger`：
- `ensureSettingsIndexes()`：创建 logger，设置 action，emit
- `loadSettingsCache()`：创建 logger，设置 action + 条目数，emit
- `initBuiltinSettings()`：创建 logger，设置 action，emit

`ensureSettingsIndexes` 示例：
```typescript
export async function ensureSettingsIndexes(): Promise<void> {
  const col = getSettingsCollection();
  await col.createIndex({ key: 1 }, { unique: true });
  const log = createLogger({ category: "db" });
  log.set({ action: "ensureSettingsIndexes", status: "complete" });
  log.emit();
}
```

- [ ] **步骤 2：迁移 user.repository.ts**

移除 logtape 导入和 logger。替换 `ensureUserIndexes()` 中的 1 个日志调用：
```typescript
export async function ensureUserIndexes(): Promise<void> {
  const col = getUserCollection();
  // ... 现有索引创建逻辑 ...
  const log = createLogger({ category: "db" });
  log.set({ action: "ensureUserIndexes", status: "complete" });
  log.emit();
}
```

- [ ] **步骤 3：迁移 yggdrasil.crypto.ts**

移除 logtape 导入和 logger。替换 `loadOrGenerateKeys()` 中的 3 个日志调用：
```typescript
export async function loadOrGenerateKeys(): Promise<void> {
  const log = createLogger({ category: "crypto" });
  // ... 现有逻辑 ...
  if (!privateExists) {
    log.set({ action: "generateRsaKeys" });
    // ... 密钥生成 ...
    log.set({ status: "generated" });
  } else {
    log.set({ action: "loadRsaKeys", status: "loaded" });
  }
  // ... 读取密钥 ...
  log.emit();
}
```

- [ ] **步骤 4：迁移 secrets.ts**

移除 logtape 导入和 logger。替换 `loadSecrets()` 中的 3 个日志调用：
```typescript
export function loadSecrets(): void {
  const log = createLogger({ category: "secrets" });
  if (fs.existsSync(SECRETS_PATH)) {
    const raw = fs.readFileSync(SECRETS_PATH, "utf-8");
    const parsed = Bun.YAML.parse(raw) as Partial<Secrets>;
    if (parsed.altcha_hmac_key_signature_secret && parsed.altcha_hmac_signature_secret) {
      log.set({ action: "loadSecrets", source: SECRETS_PATH, status: "loaded" });
      _secrets = parsed as Secrets;
      log.emit();
      return;
    }
    log.set({ warning: "secrets_file_incomplete" });
  }
  // ... 生成密钥 ...
  log.set({ action: "loadSecrets", source: SECRETS_PATH, status: "generated" });
  log.emit();
  _secrets = generated;
}
```

- [ ] **步骤 5：提交**

```bash
rtk git add server/utils/settings.repository.ts server/utils/user.repository.ts server/utils/yggdrasil.crypto.ts server/utils/secrets.ts
rtk git commit -m "refactor: convert startup-only utils logging to evlog createLogger"
```

---

### 任务 4：迁移请求上下文工具函数

这 8 个文件始终从请求处理器中调用。将 logtape 转为 `useLogger()`（自动导入，使用 Nitro async context）。

**文件：**
- 修改：`server/utils/email.service.ts`
- 修改：`server/utils/email-verification.ts`
- 修改：`server/utils/password-reset.ts`
- 修改：`server/utils/password.ts`
- 修改：`server/utils/rate-limit.ts`
- 修改：`server/utils/texture.service.ts`
- 修改：`server/utils/yggdrasil.service.ts`
- 修改：`server/utils/yggdrasil.handler.ts`

- [ ] **步骤 1：迁移 email.service.ts**

移除 logtape 导入和 logger。转换 3 个日志调用：
- 第 13 行 (warn)：`logger.warn\`SMTP host not configured...\`` → `useLogger().set({ email: { warning: "smtp_not_configured" } });`
- 第 37 行 (info)：`logger.info\`Email sent to ${to}: ${subject}\`` → `useLogger().set({ email: { sent: true, to, subject } });`
- 第 40 行 (error)：`logger.error\`Failed to send email to ${to}: ${err}\`` → `useLogger().error(err as Error, { step: "email_send", to });`

- [ ] **步骤 2：迁移 email-verification.ts**

移除 logtape 导入和 logger。转换 3 个日志调用：
- 第 39 行（info，跳过）：→ `useLogger().set({ emailVerification: { skipped: "token_already_active", userId } });`
- 第 58 行（info）：→ `useLogger().set({ emailVerification: { tokenCreated: true, userId } });`
- 第 89 行（info）：→ `useLogger().set({ emailVerification: { tokenConsumed: true, userId: data.userId } });`

- [ ] **步骤 3：迁移 password-reset.ts**

移除 logtape 导入和 logger。转换 3 个日志调用：
- 第 45 行（info，跳过）：→ `useLogger().set({ passwordReset: { skipped: "token_already_active", userId } });`
- 第 64 行（info）：→ `useLogger().set({ passwordReset: { tokenCreated: true, userId } });`
- 第 95 行（info）：→ `useLogger().set({ passwordReset: { tokenConsumed: true, userId: data.userId } });`

- [ ] **步骤 4：迁移 password.ts**

移除 logtape 导入和 logger。转换 1 个日志调用：
- 第 26 行 (warn)：→ `useLogger().set({ auth: { warning: "unknown_hash_version", hashVersion } });`

- [ ] **步骤 5：迁移 rate-limit.ts**

移除 logtape 导入和 logger。转换 3 个日志调用：
- 第 66 行 (warn)：→ `useLogger().set({ rateLimit: { warning: "store_full", storeSize: store.size, key } });`
- 第 82 行 (warn)：→ `useLogger().set({ rateLimit: { exceeded: true, key } });`
- 第 93 行 (info)：→ `useLogger().set({ rateLimit: { delayed: true, delayMs: delay, key } });`

- [ ] **步骤 6：迁移 texture.service.ts**

移除 logtape 导入和 logger。转换 3 个日志调用：
- 第 58 行 (info)：→ `useLogger().set({ texture: { unusedRemoved: true, hash } });`
- 第 118 行 (info)：→ `useLogger().set({ texture: { action: "upload", type: textureType, userId: uuid, hash } });`
- 第 147 行 (info)：→ `useLogger().set({ texture: { action: "delete", type: textureType, userId: uuid } });`

- [ ] **步骤 7：迁移 yggdrasil.service.ts**

移除 logtape 导入和 logger。转换 5 个日志调用：
- 第 39 行（info，authenticate 中的哈希迁移）：→ `useLogger().set({ auth: { passwordHashMigrated: true, userId: user.email, from: user.hashVersion } });`
- 第 77 行（info，认证）：→ `useLogger().set({ yggdrasil: { action: "authenticate", userId: user.email } });`
- 第 173 行（info，signout 中的哈希迁移）：→ `useLogger().set({ auth: { passwordHashMigrated: true, userId: user.email, from: user.hashVersion } });`
- 第 299 行（info，材质上传）：→ `useLogger().set({ yggdrasil: { textureAction: "upload", type: params.textureType, gameId: user.gameId } });`
- 第 335 行（info，材质删除）：→ `useLogger().set({ yggdrasil: { textureAction: "delete", type: params.textureType, gameId: user.gameId } });`

- [ ] **步骤 8：迁移 yggdrasil.handler.ts**

移除 logtape 导入和 logger。转为使用 `useLogger(event)`：

```typescript
import type { EventHandler, H3Event } from "h3";

export class YggdrasilError extends Error {
  constructor(
    public httpStatus: number,
    public error: string,
    public errorMessage: string,
  ) {
    super(errorMessage);
  }

  toJSON() {
    return { error: this.error, errorMessage: this.errorMessage };
  }
}

export function defineYggdrasilHandler<T>(handler: (event: H3Event) => Promise<T>): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event);
    } catch (err) {
      if (err instanceof YggdrasilError) {
        setResponseStatus(event, err.httpStatus);
        return err.toJSON();
      }
      useLogger(event).error(err as Error, { step: "yggdrasil_handler" });
      setResponseStatus(event, 500);
      return { error: "InternalError", errorMessage: "Internal server error" };
    }
  });
}
```

- [ ] **步骤 9：提交**

```bash
rtk git add server/utils/email.service.ts server/utils/email-verification.ts server/utils/password-reset.ts server/utils/password.ts server/utils/rate-limit.ts server/utils/texture.service.ts server/utils/yggdrasil.service.ts server/utils/yggdrasil.handler.ts
rtk git commit -m "refactor: convert request-context utils logging to evlog wide events"
```

---

### 任务 5：迁移 API 路由

将 8 个 API 路由文件从 logtape 转为 evlog `useLogger(event)`。

**文件：**
- 修改：`server/api/auth/login.post.ts`
- 修改：`server/api/auth/forgot-password.post.ts`
- 修改：`server/api/auth/reset-password.post.ts`
- 修改：`server/api/auth/verify-email.post.ts`
- 修改：`server/api/auth/send-verification-email.post.ts`
- 修改：`server/api/user/change-password.post.ts`
- 修改：`server/api/passkey/auth-verify.post.ts`
- 修改：`server/api/passkey/register-verify.post.ts`

- [ ] **步骤 1：迁移 login.post.ts**

移除 logtape 导入和 logger。在处理器开头添加 `const log = useLogger(event);`。转换 2 个日志调用：
- 第 53 行 (info)：→ `log.set({ auth: { passwordHashUpgraded: true, userId: user.uuid } });`
- 第 55 行 (error)：→ `log.error(err as Error, { step: "password_hash_upgrade", userId: user.uuid });`

- [ ] **步骤 2：迁移 forgot-password.post.ts**

移除 logtape 导入和 logger。在处理器开头添加 `const log = useLogger(event);`。转换 2 个日志调用：
- 第 81 行 (error)：→ `log.set({ passwordReset: { emailSendFailed: true, email: user.email } });`
- 第 85 行 (error)：→ `log.error(err as Error, { step: "password_reset", email });`

- [ ] **步骤 3：迁移 reset-password.post.ts**

移除 logtape 导入和 logger。在处理器开头添加 `const log = useLogger(event);`。转换 1 个日志调用：
- 第 73 行 (info)：→ `log.set({ auth: { action: "password_reset_completed", userId: user.uuid } });`

- [ ] **步骤 4：迁移 verify-email.post.ts**

移除 logtape 导入和 logger。在处理器开头添加 `const log = useLogger(event);`。转换 2 个日志调用：
- 第 25 行 (warn)：→ `log.set({ emailVerification: { warning: "email_mismatch", userId: result.userId, tokenEmail: result.email, currentEmail: user.email } });`
- 第 34 行 (info)：→ `log.set({ emailVerification: { verified: true, userId: result.userId, email: result.email } });`

- [ ] **步骤 5：迁移 send-verification-email.post.ts**

移除 logtape 导入和 logger。在处理器开头添加 `const log = useLogger(event);`。转换 2 个日志调用：
- 第 45 行 (error)：→ `log.set({ emailVerification: { emailSendFailed: true, email: user.email } });`
- 第 49 行 (error)：→ `log.error(err as Error, { step: "send_verification_email", email: user.email });`

- [ ] **步骤 6：迁移 change-password.post.ts**

移除 logtape 导入和 logger。在处理器开头添加 `const log = useLogger(event);`。转换 1 个日志调用：
- 第 80 行 (info)：→ `log.set({ auth: { action: "password_changed", userId: userDoc.uuid } });`

- [ ] **步骤 7：迁移 auth-verify.post.ts**

移除 logtape 导入和 logger。在处理器开头添加 `const log = useLogger(event);`。转换 5 个调试日志调用：
- 第 23 行：→ `log.set({ passkey: { failure: "no_user_found", credentialId } });`
- 第 30 行：→ `log.set({ passkey: { failure: "credential_not_in_user", credentialId, userId: user.uuid } });`
- 第 38 行：→ `log.set({ passkey: { failure: "user_handle_mismatch", userId: user.uuid } });`
- 第 53 行：→ `log.error(e as Error, { step: "passkey_verify", userId: user.uuid });`
- 第 58 行：→ `log.set({ passkey: { failure: "verification_not_passed", userId: user.uuid } });`

- [ ] **步骤 8：迁移 register-verify.post.ts**

移除 logtape 导入和 logger。在处理器开头添加 `const log = useLogger(event);`。转换 2 个调试日志调用：
- 第 27 行：→ `log.error(e as Error, { step: "passkey_register_verify", userId: userDoc.uuid });`
- 第 32 行：→ `log.set({ passkey: { registrationFailure: true, userId: userDoc.uuid, verified: verified.verified } });`

- [ ] **步骤 9：提交**

```bash
rtk git add server/api/auth/login.post.ts server/api/auth/forgot-password.post.ts server/api/auth/reset-password.post.ts server/api/auth/verify-email.post.ts server/api/auth/send-verification-email.post.ts server/api/user/change-password.post.ts server/api/passkey/auth-verify.post.ts server/api/passkey/register-verify.post.ts
rtk git commit -m "refactor: convert API route logging to evlog wide events"
```

---

### 任务 6：清理依赖

**文件：**
- 修改：`package.json`

- [ ] **步骤 1：从 package.json 移除 logtape 依赖**

从 dependencies 中移除：
- `"@logtape/logtape": "^2.0.4"`
- `"@logtape/otel": "^2.0.4"`

- [ ] **步骤 2：运行 bun install**

运行：`bun install`
预期：无 @logtape 相关包的干净安装

- [ ] **步骤 3：验证无残留的 logtape 引用**

运行：`grep -r "@logtape" server/ app/ --include="*.ts" --include="*.vue"`
预期：无匹配结果（覆盖 @logtape/logtape 和 @logtape/otel）

- [ ] **步骤 4：提交**

```bash
rtk git add package.json bun.lock
rtk git commit -m "chore: remove @logtape/logtape and @logtape/otel dependencies"
```

---

### 任务 7：更新 CLAUDE.md

更新 `CLAUDE.md` 的 Environment 部分，记录新环境变量并移除 `IRMIN_APP_LOG_LEVEL`。

**文件：**
- 修改：`CLAUDE.md`

- [ ] **步骤 1：更新环境变量文档**

在 Environment 部分，移除 `IRMIN_APP_LOG_LEVEL` 并添加：
- `IRMIN_EVLOG_SAMPLING_INFO` — info 事件采样率，0-100%（默认：`100`）
- `IRMIN_EVLOG_SAMPLING_DEBUG` — debug 事件采样率，0-100%（默认：`10`）
- `IRMIN_EVLOG_MAX_FILES` — 保留的最大日志文件数（默认：`30`）

- [ ] **步骤 2：提交**

```bash
rtk git add CLAUDE.md
rtk git commit -m "docs: update env vars for evlog migration"
```

---

### 任务 8：构建验证

- [ ] **步骤 1：运行 linter**

运行：`rtk bun run lint`
预期：无新的 lint 错误

- [ ] **步骤 2：运行构建**

运行：`rtk bun run build`
预期：生产构建成功

- [ ] **步骤 3：运行测试**

运行：`rtk bun run test`
预期：所有测试通过

- [ ] **步骤 4：启动开发服务器验证**

运行：`bun run dev`
预期：服务器启动，API 请求时控制台显示 evlog wide events

---

## 备注

### Wide Event 模型

核心概念转变：evlog 不再为每个操作产生一条离散日志行，而是为**每个请求产生一个 wide event**，通过 `log.set()` 累加所有上下文。这使调试更容易，因为所有请求上下文都在一个可搜索的事件中。

### 两种 Logger 类型

- **`useLogger(event)` / `useLogger()`** — 请求级 logger。丰富自动创建的 wide event。请求结束时自动 emit。用于 API 路由和从请求处理器调用的工具函数。
- **`createLogger({ category })`** — 独立 logger，用于非请求代码。需要手动 `emit()`。用于启动插件和启动专用工具函数。

### Async Context

`useLogger()`（无 `event` 参数）依赖 Nitro 的 AsyncLocalStorage 查找当前请求上下文。evlog/nuxt 模块自动启用此功能。因此工具函数可以调用 `useLogger()` 而无需向下传递 H3 event。

### 前置条件

`evlog` v2.9+ 已在 `package.json` 中安装 — 无需额外安装。

### 日志文件格式变化

Logtape 将纯文本日志写入 `./irminsul-data/log/app-YYYY-MM-DD.log`（按日轮转）。evlog/fs 将 NDJSON（每行一个 JSON 对象）写入同一目录。这是格式变化 — 现有日志解析工具可能需要更新。

### 采样

用按级别采样替代 `IRMIN_APP_LOG_LEVEL` 环境变量：`IRMIN_EVLOG_SAMPLING_INFO`（默认 100%）和 `IRMIN_EVLOG_SAMPLING_DEBUG`（默认 10%）。通过 drain 插件中的 `evlog:emit:keep` hook 实现。**行为变化**：日志级别是硬截止（"不显示 info 以下的日志"），采样是概率性过滤（"保留 10% 的 debug 事件"）。

### 安全性

不记录任何敏感数据（密码、令牌、密钥）。迁移仅记录用户 ID、邮箱和操作元数据 — 绝不记录凭证。
