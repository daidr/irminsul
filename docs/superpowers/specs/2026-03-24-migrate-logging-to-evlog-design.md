# 日志迁移至 evlog — 设计文档

## 目标

将 @logtape/logtape 替换为 evlog，采用 wide event 模型（每个请求一个聚合事件）进行结构化请求日志记录，使用 `createLogger` 处理非请求日志（启动、后台任务等）。搭建带文件输出和可扩展结构的 drain 管道，为未来接入外部日志服务预留接口。

## 动机

- **Wide events**：将所有请求上下文聚合到单个可搜索事件中，取代分散的离散日志行
- **Drain 管道**：统一输出通道，支持批处理、重试，可扩展接入外部服务（Axiom、OTLP 等）
- **采样机制**：用 evlog 的采样机制替代日志级别过滤（`IRMIN_APP_LOG_LEVEL`），通过环境变量配置

## 架构

### 请求日志

evlog/nuxt 模块自动为所有服务端路由创建 wide event。每个请求产生一个聚合事件：

```
POST /api/auth/login 200 in 150ms
  +-- auth: action=login userId=xxx passwordHashUpgraded=true
  +-- email: sent=true to=user@example.com
```

- **API 路由**：`useLogger(event)` 返回请求级 logger
- **工具函数（从路由调用）**：`useLogger()`（无参数）通过 Nitro async context 获取当前请求的 logger
- 通过 `log.set({ key: { ... } })` 在请求生命周期内累加字段
- 请求结束时自动 emit wide event

### 非请求日志

启动插件和非请求上下文的工具函数使用 `createLogger`：

```typescript
const log = createLogger({ category: "startup" });
log.set({ plugin: "03.db", action: "connect" });
log.emit(); // 需要手动 emit
```

这确保所有日志（启动 + 请求）都流经同一个 drain 管道。

### Drain 管道

```
[wide event] --> [evlog:drain hook] --> [pipeline (batch + retry)] --> [fsDrain (NDJSON)]
                                                                   \-> [未来: axiomDrain, otlpDrain, ...]
```

- 文件 drain 将 NDJSON 写入 `./irminsul-data/log/`
- Pipeline 包装 drain 提供批处理 + 重试 — 主要为未来的外部 drain 服务，但统一应用以确保添加外部适配器无需改结构
- 服务关闭时调用 `drain.flush()` 防止数据丢失
- 文件保留数量通过 `IRMIN_EVLOG_MAX_FILES` 环境变量控制（默认 30）

### 采样配置

通过环境变量配置按级别的采样率，替代 `IRMIN_APP_LOG_LEVEL`：

| 环境变量 | runtimeConfig 键名 | 默认值 | 说明 |
|---------|-------------------|--------|------|
| `IRMIN_EVLOG_SAMPLING_INFO` | `evlogSamplingInfo` | `100` | info 事件采样率（0-100%） |
| `IRMIN_EVLOG_SAMPLING_DEBUG` | `evlogSamplingDebug` | `10` | debug 事件采样率（0-100%） |
| `IRMIN_EVLOG_MAX_FILES` | `evlogMaxFiles` | `30` | 文件 drain 保留的最大日志文件数 |

**与日志级别的行为差异**：`IRMIN_APP_LOG_LEVEL=info` 表示"不显示 info 以下的日志"，这是硬截止。采样 `debug: 10` 表示"保留 10% 的 debug 事件"，这是概率性过滤。

## 迁移范围

| 类别 | 文件数 | 处理方式 |
|------|--------|----------|
| 基础设施 | nuxt.config.ts（修改）、drain 插件（新建）、logtape 插件（删除） | 添加 evlog/nuxt 模块，创建带 pipeline 的 drain 插件 |
| 启动插件 | 6 个插件（00、01、03、04、05、07） | `console.log` → `createLogger` + `emit()` |
| 启动工具函数 | 4 个文件 | logtape → `createLogger` + `emit()` |
| 请求上下文工具函数 | 8 个文件 | logtape → `useLogger()` + `log.set()` |
| API 路由 | 8 个文件 | logtape → `useLogger(event)` + `log.set()` |
| 依赖清理 | package.json | 移除 @logtape/logtape、@logtape/otel |

总计：约 27 个文件操作。

## Wide Event 字段命名

按领域分组，使用描述性键名，不使用缩写：

| 领域 | 键名 | 示例字段 |
|------|------|---------|
| 认证 | `auth` | `action`、`userId`、`passwordHashUpgraded`、`passwordHashMigrated`、`warning` |
| 邮件 | `email` | `sent`、`to`、`subject`、`warning` |
| 邮箱验证 | `emailVerification` | `tokenCreated`、`tokenConsumed`、`verified`、`warning`、`skipped` |
| 密码重置 | `passwordReset` | `tokenCreated`、`tokenConsumed`、`emailSendFailed`、`skipped` |
| 材质 | `texture` | `action`、`type`、`hash`、`userId`、`unusedRemoved` |
| Yggdrasil | `yggdrasil` | `action`、`textureAction`、`type`、`gameId`、`userId` |
| 通行密钥 | `passkey` | `failure`、`credentialId`、`userId`、`registrationFailure` |
| 速率限制 | `rateLimit` | `exceeded`、`delayed`、`delayMs`、`warning`、`storeSize`、`key` |
| 启动 | `startup` | `plugin`、`action`、`status`、`details` |

### `log.error()` 与 `log.set()` 的错误记录区分

- **`log.error(err, { step })`** — 用于意外异常（try/catch 捕获的错误）。自动将结构化错误数据添加到 wide event。
- **`log.set({ domain: { failure: "reason" } })`** — 用于预期的/已处理的失败条件（如通行密钥验证失败、用户不存在）。这些属于正常控制流，不是异常。

## 安全性

绝不记录：密码、令牌、密钥、会话 cookie、HMAC 密钥。
仅记录：用户 ID、邮箱（用于认证上下文）、操作元数据、错误信息。

## 风险

1. **`useLogger()` 在非请求上下文调用会失败**：启动代码必须使用 `createLogger`。
2. **日志文件格式变化**：NDJSON 替代纯文本。现有日志解析工具需要更新。
3. **`log.set()` 键合并**：同一请求中对同一顶层键多次调用 `log.set()` 会合并/覆盖。当前代码库中控制流阻止了冲突（如 rate-limit.ts 在到达下一个 `log.set()` 前就抛出了异常），但新代码应避免在单个请求内从不同工具函数写入同一领域键。
4. **Async context 依赖**：Nitro async context 必须启用（evlog/nuxt 自动处理）。
5. **`createError` 命名冲突**：Nuxt 自动导入 h3 的 `createError`。如果未来采用 evlog 的 `createError`，会产生命名冲突。目前不使用 evlog 的 `createError`。

## 不在范围内

- 客户端日志（未来可通过 evlog transport 添加）
- 外部 drain 配置（Axiom、OTLP）— 仅搭建扩展点
- 结构化错误迁移（evlog 的 `createError`）— 保持现有错误处理不变
- evlog 配置的管理后台 UI — 通过环境变量配置
