# Plugin System Design

## Overview

Irminsul 的通用插件系统，允许用户通过 ESM 插件扩展服务器功能。插件存放在 `irminsul-data/plugins/<pluginId>/` 目录下，每个插件包含一个 `plugin.yaml` 元数据文件和一个 `index.js` ESM 入口。

首批支持的 hook 点为 evlog enricher 和 drain adapter，系统设计为可扩展的 hook 体系，未来可添加更多 hook 点。

## Architecture

### Directory Layout

```
irminsul-data/plugins/
  <pluginId>/
    plugin.yaml          # 元数据 + 配置 schema 声明
    index.js             # ESM 入口，导出 setup(ctx)
    logs/
      <date>.jsonl       # 插件日志持久化（按天滚动）
```

### Core Components

```
PluginManager (server/utils/plugin-manager.ts)
  ├── PluginLoader      — 加载/卸载插件（Bun Worker 生命周期管理）
  ├── PluginWatcher     — 监听 irminsul-data/plugins/ 目录变化
  ├── HookRegistry      — hook → handler[] 映射，支持排序
  ├── PluginBridge      — 主线程 ↔ Worker 消息协议
  └── PluginWorker      — Worker 端运行时（构造 ctx、执行 setup）
```

### Worker 架构

每个启用的插件运行在独立的 Bun Worker 线程中，通过 `postMessage` 与主线程通信：

```
Main Thread                          Worker Thread (per plugin)
┌──────────────┐                    ┌──────────────────────┐
│ PluginManager│                    │ PluginWorker Runtime │
│              │  postMessage       │                      │
│  HookRegistry├───────────────────►│  index.js (plugin)   │
│              │◄───────────────────┤  ctx proxy           │
│  PluginBridge│  postMessage       │  console interception│
└──────────────┘                    └──────────────────────┘
```

**优势：**
- **真正隔离** — 插件无法访问主线程的全局对象、数据库连接、请求上下文
- **干净卸载** — `worker.terminate()` 完全释放资源，无模块缓存问题
- **稳定性** — 插件崩溃不影响主进程
- **console 天然隔离** — Worker 内的 console 输出自然与主线程分离

### Plugin State Machine

```
[未发现] → 文件监听/手动扫描 → [已发现/已禁用]
[已发现/已禁用] → 管理面板启用 → [加载中] → setup() 成功 → 调用 app:started → [已启用]
                                            → setup() 失败 → [错误] (保持禁用，记录错误)
[已启用] → 管理面板禁用 → 调用 app:shutdown → [卸载中] → worker.terminate() → [已禁用]
[已启用] → 文件变更检测 → 调用 app:shutdown → [卸载中] → worker.terminate() → [加载中] → [已启用] (热重载)
[任意状态] → 插件目录被删除 → 调用 app:shutdown → [卸载中] → worker.terminate() → 从 registry 移除
```

## Plugin Metadata — plugin.yaml

```yaml
name: my-axiom-drain
version: 1.0.0
description: 将日志发送到 Axiom
author: daidr
hooks:
  - evlog:drain
config:
  - key: apiKey
    label: API Key
    description: Axiom API 密钥
    type: password
    required: true
    group: 基础设置
  - key: dataset
    label: Dataset
    description: 目标 dataset 名称
    type: text
    visible_when: { provider: "axiom" }
    required_when: { provider: "axiom" }
```

### Metadata Validation

加载时校验 `plugin.yaml`，不合法则拒绝加载并记录错误：

- `name` — 必填，字符串
- `version` — 必填，semver 格式
- `hooks` — 必填，非空数组，值必须是已注册的 hook 名称
- `config` — 可选，数组，每项的 `key`/`label`/`type` 必填，`type` 必须是支持的类型
- 条件表达式中引用的 key 必须在同一 config 中存在

### Config Field Types

| type | 渲染 | 说明 |
|------|------|------|
| `text` | 文本输入框 | 默认类型 |
| `password` | 密码输入框 | 值脱敏存储/显示 |
| `number` | 数字输入框 | |
| `boolean` | 开关 | |
| `select` | 下拉选择 | 需额外 `options: [{label, value}]` |
| `textarea` | 多行文本 | |

### Config Field Properties

| 属性 | 类型 | 说明 |
|------|------|------|
| `key` | `string` | 必填，配置键名 |
| `label` | `string` | 必填，UI 显示标签 |
| `description` | `string` | 可选，字段描述 |
| `type` | `string` | 必填，UI 类型 |
| `group` | `string` | 可选，UI 分组标题 |
| `default` | `any` | 可选，静态默认值 |
| `default_when` | `ConditionalValue[]` | 可选，条件默认值（优先于 `default`） |
| `required` | `boolean` | 可选，静态必填 |
| `required_when` | `Condition` | 可选，条件必填 |
| `visible_when` | `Condition` | 可选，条件显示 |
| `disabled` | `boolean` | 可选，静态禁用 |
| `disabled_when` | `Condition` | 可选，条件禁用 |
| `options` | `Option[]` | 可选，静态选项列表（select 类型） |
| `options_when` | `ConditionalOptions[]` | 可选，条件选项覆盖 |
| `validation` | `Validation` | 可选，校验规则 |

### Condition System

**简写（相等匹配）：**

```yaml
visible_when: { provider: "axiom" }
```

**完整语法（操作符）：**

```yaml
visible_when:
  provider: { eq: "axiom" }
  batchSize: { gt: 100 }
```

**操作符列表：**

| 操作符 | 说明 | 示例 |
|--------|------|------|
| `eq` | 等于 | `{ eq: "axiom" }` |
| `neq` | 不等于 | `{ neq: "custom" }` |
| `in` | 在列表中 | `{ in: ["axiom", "betterstack"] }` |
| `nin` | 不在列表中 | `{ nin: ["custom"] }` |
| `gt` | 大于 | `{ gt: 100 }` |
| `gte` | 大于等于 | `{ gte: 1 }` |
| `lt` | 小于 | `{ lt: 1000 }` |
| `lte` | 小于等于 | `{ lte: 50 }` |
| `truthy` | 真值判断 | `{ truthy: true }` |
| `regex` | 正则匹配 | `{ regex: "^https?://" }` |

**逻辑组合：**

同一对象内的多个字段默认 AND。支持显式 `$or`、`$and`、`$not`：

```yaml
# AND（默认）
visible_when:
  provider: { eq: "axiom" }
  batchSize: { gt: 100 }

# OR
visible_when:
  $or:
    - provider: { eq: "axiom" }
    - provider: { eq: "betterstack" }

# NOT
visible_when:
  $not:
    provider: { eq: "custom" }

# 嵌套
visible_when:
  $or:
    - provider: { eq: "axiom" }
      batchSize: { gt: 50 }
    - provider: { eq: "betterstack" }
```

**TypeScript 类型：**

```typescript
type Operator =
  | { eq: any }
  | { neq: any }
  | { in: any[] }
  | { nin: any[] }
  | { gt: number }
  | { gte: number }
  | { lt: number }
  | { lte: number }
  | { truthy: boolean }
  | { regex: string };

type FieldCondition = Operator | any; // 裸值视为 eq

type Condition =
  | Record<string, FieldCondition>    // 隐式 AND
  | { $or: Condition[] }
  | { $and: Condition[] }
  | { $not: Condition };

type ConditionalValue = { when: Condition; value: any };
type ConditionalOptions = { when: Condition; options: Option[] };
type Option = { label: string; value: any };
type Validation = {
  pattern?: string;
  message?: string;
  min?: number;
  max?: number;
};
```

### Comprehensive Config Example

```yaml
name: my-observability-drain
version: 1.0.0
description: 将日志发送到可观测性平台
author: daidr
hooks:
  - evlog:drain
config:
  - key: provider
    label: 平台
    type: select
    required: true
    group: 基础设置
    options:
      - label: Axiom
        value: axiom
      - label: Better Stack
        value: betterstack
      - label: 自定义
        value: custom

  - key: apiKey
    label: API Key
    type: password
    required: true
    group: 基础设置

  - key: dataset
    label: Dataset
    type: text
    group: 基础设置
    visible_when: { provider: "axiom" }
    required_when: { provider: "axiom" }

  - key: sourceToken
    label: Source Token
    type: password
    group: 基础设置
    visible_when: { provider: "betterstack" }
    required_when: { provider: "betterstack" }

  - key: endpoint
    label: 自定义端点
    type: text
    group: 基础设置
    visible_when: { provider: "custom" }
    required_when: { provider: "custom" }
    validation:
      pattern: "^https?://"
      message: 必须是有效的 HTTP(S) URL

  - key: batchSize
    label: 批量大小
    type: number
    default: 50
    group: 高级设置
    validation:
      min: 1
      max: 1000

  - key: flushInterval
    label: 刷新间隔 (ms)
    type: number
    default: 5000
    default_when:
      - when: { provider: "axiom" }
        value: 3000
      - when: { provider: "betterstack" }
        value: 10000
    group: 高级设置

  - key: retryEnabled
    label: 启用重试
    type: boolean
    default: true
    group: 高级设置

  - key: maxRetries
    label: 最大重试次数
    type: number
    default: 3
    group: 高级设置
    disabled_when: { retryEnabled: false }
    validation:
      min: 1
      max: 10

  - key: format
    label: 日志格式
    type: select
    default: json
    group: 高级设置
    options:
      - label: JSON
        value: json
      - label: NDJSON
        value: ndjson
      - label: Logfmt
        value: logfmt
    options_when:
      - when: { provider: "axiom" }
        options:
          - label: NDJSON
            value: ndjson
      - when: { provider: "betterstack" }
        options:
          - label: JSON
            value: json
          - label: NDJSON
            value: ndjson
```

## Plugin API — setup(ctx)

### Entry Point

`index.js` 必须导出一个 `setup` 函数：

```js
export function setup(ctx) {
  // 使用 ctx 注册 hook、读取配置、记录日志
}
```

### PluginContext Interface

```typescript
interface PluginContext {
  // 插件元数据（只读）
  meta: {
    id: string;          // 插件目录名
    name: string;        // plugin.yaml 中的 name
    version: string;
    dir: string;         // 插件目录绝对路径
  };

  // 已存储的用户配置（只读）
  config: Record<string, any>;

  // 注册 hook（仅限 plugin.yaml 中声明的 hook）
  hook(name: string, handler: Function): void;

  // 结构化日志（evlog 风格）
  log: {
    set(fields: Record<string, any>): void;
    emit(): void;
    error(error: Error, context?: Record<string, any>): void;
    info(message: string, data?: Record<string, any>): void;
    warn(message: string, data?: Record<string, any>): void;
    debug(message: string, data?: Record<string, any>): void;
  };

  // HTTP 请求（Worker 内原生 fetch，无需代理）
  fetch(url: string, options?: RequestInit): Promise<Response>;
}
```

### Plugin Examples

**Drain 插件：**

```js
// irminsul-data/plugins/axiom-drain/index.js
export function setup(ctx) {
  const { apiKey, dataset } = ctx.config;

  ctx.hook('evlog:drain', async (events) => {
    ctx.log.set({ drain: 'axiom', count: events.length });
    try {
      await ctx.fetch(`https://api.axiom.co/v1/datasets/${dataset}/ingest`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(events),
      });
      ctx.log.set({ status: 'ok' });
    } catch (err) {
      ctx.log.error(err, { step: 'flush' });
    }
    ctx.log.emit();
  });

  ctx.hook('app:shutdown', async () => {
    ctx.log.info('Axiom drain shutting down');
  });
}
```

**Enricher 插件：**

```js
// irminsul-data/plugins/geo-enricher/index.js
export function setup(ctx) {
  ctx.hook('evlog:enricher', (events) => {
    // 返回 patch 数组：每项是要合并到对应事件上的字段
    return events.map(event => ({
      geo: { region: 'asia', datacenter: 'tokyo' },
    }));
  });
}
```

## Hook System

### Initial Hook Points

| Hook | 参数 | 返回 | 说明 |
|------|------|------|------|
| `evlog:enricher` | `(events: WideEvent[])` | `Patch[]` | 接收一批事件，返回每个事件要追加的字段（增量 patch） |
| `evlog:drain` | `(events: WideEvent[])` | `Promise<void>` | 消费一批 wide event |
| `app:started` | `()` | `void` | 服务启动完成 |
| `app:shutdown` | `()` | `Promise<void>` | 服务关闭前 |

> **enricher 数据流说明：** 由于插件运行在 Worker 中，事件通过 structured clone 传递。为减少序列化开销，enricher 不返回完整事件，而是返回一个 `Patch[]` 数组（与输入事件等长），每项是要浅合并到对应事件上的字段对象。主线程收到 patch 后执行 `Object.assign(events[i], patches[i])` 原地合并，再传给下一个 enricher 或 drain。这样返回数据只包含新增字段，而非完整事件副本。

未来可扩展更多 hook 点（如 `auth:login`、`user:created` 等），只需在主程序相应位置调用 `hookRegistry.call(hookName, ...args)` 即可。

### Lifecycle Hooks

`app:started` 和 `app:shutdown` 是生命周期 hook，**隐式对所有插件可用**，无需在 `plugin.yaml` 的 `hooks` 数组中声明。只有功能性 hook（如 `evlog:enricher`、`evlog:drain`）需要显式声明。

### Execution Order

同一 hook 下的多个插件按 `order` 排序执行。`order` 是**单一全局顺序号**（每个插件一个），决定该插件在所有 hook 中的相对执行位置。通过管理面板拖拽排序更新。例如：Plugin A (order=1) 和 Plugin B (order=2) 同时注册了 `evlog:drain`，则 A 始终先于 B 执行。

### Hook Registration Validation

`ctx.hook()` 调用时校验 hook 名称：生命周期 hook（`app:started`、`app:shutdown`）始终允许；功能性 hook 必须在 `plugin.yaml` 的 `hooks` 数组中声明，未声明的注册会被拒绝并记录错误日志。

### Bridge to Nitro Hooks

PluginManager 在 Nitro hook 中通过 IPC 调用 Worker 中的插件 handler：

```typescript
nitroApp.hooks.hook('evlog:drain', async (events) => {

  // 先执行 enricher 插件（按 order，串行）
  for (const plugin of hookRegistry.get('evlog:enricher')) {
    try {
      // enricher 返回 patch 数组，主线程原地合并到事件上
      const patches = await pluginBridge.callHook(plugin.id, 'evlog:enricher', events);
      for (let i = 0; i < events.length; i++) {
        if (patches[i]) Object.assign(events[i], patches[i]);
      }
    } catch (e) { /* 记录到插件日志 */ }
  }

  // 再执行 drain 插件（按 order，串行）
  for (const plugin of hookRegistry.get('evlog:drain')) {
    try {
      await pluginBridge.callHook(plugin.id, 'evlog:drain', events);
    } catch (e) { /* 记录到插件日志 */ }
  }
});
```

### IPC Message Protocol

主线程与 Worker 之间使用结构化消息通信：

**主线程 → Worker：**

```typescript
// 初始化（Worker 创建后首条消息）
{ type: 'init', pluginId: string, pluginDir: string, entryPath: string,
  config: Record<string, any>, meta: PluginMeta, allowedHooks: string[] }

// 调用 hook
{ type: 'hook:call', hookName: string, args: any[], callId: string }

// 通知关闭
{ type: 'shutdown' }
```

**Worker → 主线程：**

```typescript
// hook 调用完成
{ type: 'hook:result', callId: string, ok: true, result?: any }
{ type: 'hook:result', callId: string, ok: false, error: string }

// hook 注册（setup 阶段）
{ type: 'hook:register', hookName: string }

// 日志
{ type: 'log', level: string, logType: 'event' | 'console', message?: string, data?: any }

// setup 完成
{ type: 'setup:done', ok: true }
{ type: 'setup:done', ok: false, error: string }
```

Bun 的 `postMessage` 对简单对象有优化的快速路径（绕过 structured clone），性能开销极小。

## Plugin State Persistence

复用现有 `settings` 集合：

| key | value | 说明 |
|-----|-------|------|
| `plugin.system.registry` | `[{id, enabled, order}]` | 已发现插件的状态与排序 |
| `plugin.system.watcher` | `true` | 文件监听开关 |
| `plugin.system.logBufferSize` | `200` | 每个插件的内存日志缓冲条数 |
| `plugin.system.logRetentionDays` | `7` | 日志文件保留天数 |
| `plugin.custom.<pluginId>.config` | `{...}` | 插件的用户配置 |

## Sandbox — Bun Worker 隔离

### Strategy

每个插件运行在独立的 Bun Worker 线程中（`new Worker()`），提供**进程级隔离**。插件代码天然无法访问主线程的内存空间，所有通信必须通过 `postMessage` 序列化消息。

### Isolation Guarantees

| 能力 | 状态 | 说明 |
|------|------|------|
| `ctx.hook()` | 允许 | 通过 IPC 注册到主线程 HookRegistry |
| `ctx.log` | 允许 | 通过 IPC 发送到主线程日志管道 |
| `ctx.config` | 允许 | Worker 启动时由主线程注入（只读副本） |
| `ctx.fetch()` | 允许 | Worker 内原生 `fetch`，无需代理 |
| `ctx.meta` | 允许 | Worker 启动时由主线程注入（只读副本） |
| `console.*` | 拦截 | Worker 内全局替换，通过 IPC 收集 |
| `import` 第三方包 | 允许 | 插件目录下自带的 node_modules |
| 主线程内存 | 不可访问 | Worker 天然隔离 |
| 数据库连接 | 不可访问 | 主线程对象无法跨 Worker 传递 |
| 请求上下文 | 不可访问 | session/user 等不跨 Worker |

**注意：** Worker 内仍可使用 Node 内置模块（如 `node:fs`）和 `Bun` 全局对象，这是 Bun Worker 的特性。但插件无法通过这些模块访问主线程的状态（数据库、请求上下文等），隔离边界在于**数据**而非**能力**。

### Worker Lifecycle

每个插件对应一个 Worker 实例：

```typescript
// 主线程创建 Worker
const worker = new Worker('./server/utils/plugin-worker.ts', {
  smol: true,  // 减少内存占用
});

// 通过 postMessage 传入初始化数据
worker.postMessage({
  type: 'init',
  pluginId: 'my-axiom-drain',
  pluginDir: '/path/to/irminsul-data/plugins/my-axiom-drain',
  entryPath: '/path/to/irminsul-data/plugins/my-axiom-drain/index.js',
  config: { apiKey: '...', dataset: '...' },
  meta: { id: 'my-axiom-drain', name: 'My Axiom Drain', version: '1.0.0' },
  allowedHooks: ['evlog:drain'],  // plugin.yaml 声明的 hooks
});
```

Worker 端 (`plugin-worker.ts`) 是一个通用的运行时，负责：

1. 接收 `init` 消息，构造 `ctx` 对象
2. 全局替换 `console.*` 为 IPC 日志收集
3. 动态 `import()` 插件的 `index.js`，调用 `setup(ctx)`
4. 监听 `hook:call` 消息，执行对应 handler 并返回结果
5. 监听 `shutdown` 消息，执行 `app:shutdown` handler

### Console Interception

Worker 启动时**全局替换** `console` 对象，所有 `console.log/warn/error/debug` 调用通过 IPC 发送到主线程：

```typescript
// plugin-worker.ts 中
const originalConsole = globalThis.console;
globalThis.console = {
  log:   (...args) => postMessage({ type: 'log', level: 'info',  logType: 'console', message: formatArgs(args) }),
  warn:  (...args) => postMessage({ type: 'log', level: 'warn',  logType: 'console', message: formatArgs(args) }),
  error: (...args) => postMessage({ type: 'log', level: 'error', logType: 'console', message: formatArgs(args) }),
  debug: (...args) => postMessage({ type: 'log', level: 'debug', logType: 'console', message: formatArgs(args) }),
};
```

由于是 Worker 全局替换，异步代码中的 `console` 调用也能被正确捕获，没有之前软沙箱的局限性。

## Plugin Logging

### Dual Log Pipeline

| 来源 | type | 格式 |
|------|------|------|
| `ctx.log.*` | `"event"` | 结构化 wide event 字段 |
| `console.*` | `"console"` | 纯文本 message |

### Log Entry Format

```json
{
  "timestamp": "2026-03-25T10:30:00.000Z",
  "level": "info",
  "type": "event",
  "message": "Flushed events",
  "data": { "drain": "axiom", "count": 50, "status": "ok" },
  "pluginId": "my-axiom-drain"
}
```

### Storage

- **内存层：** 每个插件一个环形缓冲区（容量由 `plugin.system.logBufferSize` 控制，默认 200 条）。管理面板实时查看直接读内存。
- **持久化层：** 写入 `irminsul-data/plugins/<pluginId>/logs/<date>.jsonl`，按天滚动，保留天数由 `plugin.system.logRetentionDays` 控制（默认 7 天）。启动时清理过期文件。

## Lifecycle & Hot-Reload

### Startup Sequence

新增 Nitro 插件 `08.plugins.ts`（在所有基础设施初始化之后）：

1. 扫描 `irminsul-data/plugins/` 下所有子目录
2. 读取每个目录的 `plugin.yaml`，校验格式
3. 与数据库 `plugin.system.registry` 对比：
   - 新插件 → 加入 registry，默认 `enabled: false`
   - 已有插件 → 保持原状态
   - 目录已删除的插件 → 从 registry 移除
4. 按 `order` 排序，依次加载所有 `enabled` 的插件（每个插件创建一个 Bun Worker）
5. 所有插件 `setup()` 完成后，调用各插件的 `app:started` hook
6. 如果 `plugin.system.watcher` 为 `true` → 启动文件监听

### Hot-Reload Triggers

**文件监听（可在管理面板关闭）：**

- 新增子目录 → 发现新插件，加入 registry（`enabled: false`）
- 已启用插件的文件变更 → 卸载后重新加载（防抖 500ms）
- 子目录删除 → 卸载并从 registry 移除
- 忽略：node_modules、.git、临时文件

**管理 API：**

- `POST /api/admin/plugins/:id/enable` → 加载插件
- `POST /api/admin/plugins/:id/disable` → 卸载插件
- `POST /api/admin/plugins/:id/reload` → 卸载后重新加载
- `PUT /api/admin/plugins/:id/config` → 更新配置，已启用的插件自动重载

### Load Procedure (启用插件)

1. 创建 Bun Worker（`smol: true` 减少内存）
2. 通过 `postMessage` 发送 `init` 消息（pluginId、config、meta、allowedHooks）
3. Worker 构造 `ctx`，替换 `console`，`import()` 插件 `index.js`，调用 `setup(ctx)`
4. 等待 Worker 返回 `setup:done` 消息
5. 成功 → 将 Worker 中注册的 hook handler 记录到主线程 HookRegistry
6. 成功 → 通过 IPC 调用插件的 `app:started` hook
7. 失败 → 记录错误日志，`worker.terminate()`，插件状态设为错误

### Unload Procedure (禁用/卸载插件)

1. 通过 IPC 调用插件的 `app:shutdown` hook（设超时，防止插件不响应）
2. 从主线程 HookRegistry 移除该插件的所有 hook 记录
3. `worker.terminate()` — 完全释放 Worker 线程及其模块缓存
4. 清除主线程对该 Worker 的引用

## Admin API

### Plugin Management

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/admin/plugins` | 列出所有已发现的插件 |
| `GET` | `/api/admin/plugins/:id` | 获取单个插件详情 |
| `POST` | `/api/admin/plugins/:id/enable` | 启用插件 |
| `POST` | `/api/admin/plugins/:id/disable` | 禁用插件 |
| `POST` | `/api/admin/plugins/:id/reload` | 热重载插件 |
| `PUT` | `/api/admin/plugins/:id/config` | 更新插件配置 |
| `PUT` | `/api/admin/plugins/order` | 更新排序，请求体：`{ "order": ["pluginId-a", "pluginId-b", ...] }`（数组顺序即排序） |

### Plugin Logs

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/admin/plugins/:id/logs/stream` | SSE 实时推送，支持 `?level=&type=` |
| `GET` | `/api/admin/plugins/:id/logs/history` | 游标分页，支持 `?before=&limit=&level=&type=` |
| `DELETE` | `/api/admin/plugins/:id/logs` | 清空日志 |
| `GET` | `/api/admin/plugins/:id/logs/download` | 下载 JSONL，支持 `?date=` |

### System Settings

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/admin/plugins/settings` | 获取插件系统设置 |
| `PUT` | `/api/admin/plugins/settings` | 更新插件系统设置 |

### Log History Response

```json
{
  "logs": [
    { "timestamp": "2026-03-25T10:29:58.000Z", "level": "info", "type": "event", "..." : "..." }
  ],
  "nextCursor": "2026-03-25T10:29:55.000Z",
  "hasMore": true
}
```

游标分页在后端自动跨越 JSONL 文件的天边界，前端无需感知文件分割细节。

### Response Examples

**`GET /api/admin/plugins`**

```json
[
  {
    "id": "my-axiom-drain",
    "name": "My Axiom Drain",
    "version": "1.0.0",
    "description": "将日志发送到 Axiom",
    "author": "daidr",
    "hooks": ["evlog:drain"],
    "status": "enabled",
    "order": 1,
    "configSchema": [],
    "hasConfig": true
  }
]
```

**`GET /api/admin/plugins/:id`**

```json
{
  "id": "my-axiom-drain",
  "name": "My Axiom Drain",
  "version": "1.0.0",
  "description": "将日志发送到 Axiom",
  "author": "daidr",
  "hooks": ["evlog:drain"],
  "status": "enabled",
  "order": 1,
  "error": null,
  "configSchema": [
    { "key": "apiKey", "label": "API Key", "type": "password", "required": true, "group": "基础设置" }
  ],
  "config": {
    "apiKey": "****",
    "dataset": "irminsul-logs"
  }
}
```

所有 `/api/admin/plugins/*` 端点需要管理员权限。

## Error Handling

- 每个 hook 调用通过 IPC 发送到 Worker，设置超时（默认 30 秒），超时视为失败
- hook 调用失败（异常或超时）记录到插件日志，不影响其他插件执行，也不影响内置 fsDrain
- 插件保持启用状态，下次 hook 触发时继续调用
- 多个插件注册同一 hook 时，按 order 依次调用，互不干扰
- **Worker 崩溃**（`error` 事件或意外退出）：记录错误日志，主线程从 HookRegistry 移除该插件的 hook 记录，插件状态设为错误，管理面板可见。管理员可手动重新启用（会创建新 Worker）

## Config Validation

`PUT /api/admin/plugins/:id/config` 时根据 `plugin.yaml` 的 config schema 校验：

- `required` / `required_when` — 条件满足时字段必填
- `validation.pattern` — 正则校验
- `validation.min` / `validation.max` — 数值范围
- `type` — 类型匹配
- 未声明的 key 被丢弃
- 校验不通过返回 400，包含各字段的具体错误信息
