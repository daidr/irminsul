# Plugin Admin Page Design

## Overview

插件管理的前端页面，位于 `/admin/plugins`，采用左右分栏（Master-Detail）布局。左侧为可拖拽排序的插件列表 + Host 状态，右侧为选中插件的详情（配置/日志/信息 Tab 切换）。

## Page Route & Access Control

- **路径：** `/admin/plugins`
- **权限：** 非管理员或未登录用户访问时重定向到首页 `/`
- **实现：** Nuxt route middleware 检查 `useUser()` 返回的用户是否为 admin

## Layout — Master-Detail

```
┌─────────────────────────────────────────────────────────┐
│ ← 返回                                    /admin/plugins│
├──────────────┬──────────────────────────────────────────┤
│ Host Status  │  Plugin Name v1.0.0      [启用/禁用]     │
│ [重启 Host]  │  ┌──────┬──────┬──────┐                  │
│──────────────│  │ 配置 │ 日志 │ 信息 │                  │
│ ▦ axiom-drain│  └──────┴──────┴──────┘                  │
│   geo-enrich │  ┌──────────────────────────────────────┐│
│   my-plugin  │  │                                      ││
│              │  │   Tab 内容区域                         ││
│              │  │                                      ││
│              │  │                                      ││
│              │  └──────────────────────────────────────┘│
│──────────────│                                          │
│ ⚙ 系统设置   │                                          │
└──────────────┴──────────────────────────────────────────┘
```

### Left Panel (~300px fixed width)

**顶部：Host 状态区**
- 显示 Host 运行状态徽章：`running`（绿色）/ `dirty`（警告色）/ `crashed`（错误色）/ `stopped`（灰色）
- `dirty` 时展开显示原因列表（"xxx 已禁用"、"yyy 文件已变更"等），以及"重启 Plugin Host"按钮
- 使用 `GET /api/admin/plugins/host/status` 获取状态，轮询或手动刷新

**中间：插件列表**
- 使用 `GET /api/admin/plugins` 获取列表
- 每项显示：插件名称、版本号、状态徽章（enabled=绿色、disabled=灰色、error=红色、loading=旋转）
- 选中项高亮
- 支持 SortableJS 拖拽排序，拖拽结束后调用 `PUT /api/admin/plugins/order`
- 空状态：显示"未发现插件"提示

**底部：系统设置入口**
- 齿轮图标按钮 + "系统设置" 文字
- 点击打开 `PluginSystemSettingsModal`

### Right Panel (flex: 1)

**顶部：插件标题栏**
- 插件名称（大字）+ 版本号
- 启用/禁用切换按钮
- 错误状态时显示错误信息

**Tab 栏**
- DaisyUI `join` 按钮组，与项目现有 tab 风格一致
- 三个 tab：配置 / 日志 / 信息

**未选中任何插件时：** 右侧显示空状态提示"选择一个插件查看详情"

## Components

```
app/pages/admin/plugins.vue               — 页面入口，权限检查，布局容器
app/components/admin/
  PluginList.vue                           — 左侧插件列表（含拖拽排序）
  PluginHostStatus.vue                     — Host 状态徽章 + 重启按钮 + dirty 原因
  PluginDetail.vue                         — 右侧详情容器（tab 切换 + 标题栏）
  PluginConfigTab.vue                      — 配置表单（动态渲染 configSchema）
  PluginLogTab.vue                         — 日志查看（SSE + 历史分页）
  PluginInfoTab.vue                        — 插件元信息展示
  PluginSystemSettingsModal.vue            — 系统设置弹窗（watcher/logBufferSize/logRetentionDays）
  SortableList.vue                         — SortableJS 通用拖拽封装组件
```

## Config Tab — Dynamic Form Rendering

根据插件的 `configSchema`（`PluginConfigField[]`）动态渲染配置表单。

### Field Type Mapping

| configSchema type | UI 组件 |
|-------------------|---------|
| `text` | `<input type="text">` |
| `password` | `<input type="password">` |
| `number` | `<input type="number">` |
| `boolean` | `<input type="checkbox">` |
| `select` | `<select>` |
| `textarea` | `<textarea>` |

### Grouping

按 `group` 字段分组显示。每组有标题（`h4`），组间用 divider 分隔。无 `group` 的字段归入默认组。

### Conditional Properties

前端实时评估条件原语，控制字段的显示/禁用/必填/选项：

- `visible_when` — 条件不满足时隐藏字段
- `disabled_when` — 条件满足时禁用字段
- `required_when` — 条件满足时标记为必填
- `options_when` — 条件满足时覆盖 select 选项
- `default_when` — 条件满足时使用条件默认值

使用 `evaluateCondition()` 函数（从 `server/utils/plugin/condition.ts` 移植到前端，或作为共享工具函数）。

### Restart Indicator

`restart: true` 的配置字段旁显示重启标记图标（如 `hugeicons:refresh`），hover 提示"修改此项需要重启 Plugin Host"。

### Save Flow

1. 用户修改配置，dirty 检测（与快照对比）
2. 点击保存 → `PUT /api/admin/plugins/:id/config`
3. 服务端校验（required, pattern, min/max, type），失败返回 per-field 错误
4. 成功后更新快照，如果包含 restart 字段的变更，Host 状态变为 dirty

### Empty Config

没有 configSchema 的插件在配置 tab 显示"此插件没有可配置项"。

## Log Tab — Real-time Log Viewer

### SSE Connection

- 选中日志 tab 时建立 `EventSource` 连接：`GET /api/admin/plugins/:id/logs/stream?level=&type=`
- 新日志以 `event: log` 推送，解析后追加到日志列表底部
- 用户在底部时自动滚动到最新日志

### History Loading

- 首次加载：`GET /api/admin/plugins/:id/logs/history?limit=50` 获取最近 50 条
- 滚动到顶部时：使用最早一条的 timestamp 作为 `before` 参数加载更多
- `hasMore: false` 时停止

### Filters

- Level 筛选：下拉框（All / info / warn / error / debug）
- Type 筛选：下拉框（All / event / console）
- 筛选变更时重新建立 SSE 连接 + 重新加载历史

### Log Entry Display

每条日志显示：
- 时间戳（HH:mm:ss.SSS 格式，hover 显示完整 ISO 时间）
- Level 徽章（info=蓝、warn=黄、error=红、debug=灰）
- Type 标签（event/console，小字灰色）
- Message 文本
- Data 字段（如有，可展开的 JSON 查看器或 `<pre>` 块）

### Log Controls

- 清空日志按钮（`DELETE /api/admin/plugins/:id/logs`）
- 下载日志按钮（`GET /api/admin/plugins/:id/logs/download?date=today`）

## Info Tab

展示插件元数据：
- 名称、版本、描述、作者
- 声明的 hooks 列表
- 插件目录路径
- 当前状态

## System Settings Modal

DaisyUI `<dialog>` modal，按照项目现有 modal 模式实现：

- **文件监听开关** — checkbox + 描述文字
- **日志缓冲大小** — number input
- **日志保留天数** — number input
- 保存按钮

数据源：`GET /api/admin/plugins/settings`
保存：`PUT /api/admin/plugins/settings`

## SortableList Component

通用的 SortableJS 封装组件：

```typescript
interface Props {
  modelValue: unknown[];     // 列表数据
  options?: Sortable.Options; // SortableJS 配置
}

interface Emits {
  'update:modelValue': [value: unknown[]];
}
```

- 使用 default slot 渲染每项
- 接收 SortableJS options（handle、animation、ghostClass 等）
- 拖拽结束后 emit 新排序的数组

## Data Fetching

所有数据获取使用 `$fetch`（不用 `useAsyncData`，因为页面是管理页面，不需要 SSR 数据）：

- 页面加载：`$fetch('/api/admin/plugins')` + `$fetch('/api/admin/plugins/host/status')`
- 选中插件：`$fetch('/api/admin/plugins/:id')` 获取详情
- 配置保存：`$fetch('/api/admin/plugins/:id/config', { method: 'PUT', body })`
- 排序更新：`$fetch('/api/admin/plugins/order', { method: 'PUT', body })`
- Host 重启：`$fetch('/api/admin/plugins/host/restart', { method: 'POST' })`
- 启用/禁用：`$fetch('/api/admin/plugins/:id/enable|disable', { method: 'POST' })`

## Styling

遵循项目现有风格：
- Sharp corners（所有 radius 为 0）
- `border border-base-300` 分隔区域
- `bg-base-200` 面板背景
- DaisyUI v5 组件类
- `fieldset` + `fieldset-legend` 表单模式
- 错误使用 `alert alert-error alert-soft`
- Loading 使用 `loading loading-spinner`

## New Dependency

- `sortablejs` + `@types/sortablejs`（拖拽排序）

## Shared Code

`evaluateCondition` 函数需要在前端使用（配置表单的条件渲染）。选择以下方式之一：

- **推荐：** 将条件评估逻辑放入 `app/utils/condition.ts`（Nuxt auto-import 到前端），与服务端实现保持独立但逻辑一致。前端版本不需要完整的服务端类型依赖。
