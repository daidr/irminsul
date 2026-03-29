# 用户管理功能设计

## 概述

新增独立全屏管理页面 `/admin/users`，提供分页用户列表（支持搜索和筛选），以及封禁记录的完整 CRUD 管理。

## 数据模型

### BanRecord 扩展

在 `server/types/user.schema.ts` 中扩展现有 `BanRecord` 接口：

```typescript
export interface BanRecord {
  id: string;            // nanoid 短 ID，用于定位操作
  start: Date;           // 封禁开始时间
  end?: Date;            // 截止时间（undefined = 永久）
  reason?: string;       // 封禁理由
  operatorId: string;    // 执行封禁的管理员 userId
  revokedAt?: Date;      // 撤销时间（存在则表示已撤销）
  revokedBy?: string;    // 撤销操作的管理员 userId
}
```

### 封禁状态判断

- **生效中**：`!revokedAt && (!end || end > now)`
- **已撤销**：`revokedAt` 存在
- **已过期**：`!revokedAt && end && end <= now`

现有 `hasActiveBan()` 函数需同步更新，加入 `revokedAt` 判断。

### 向下兼容

现有 `BanRecord` 数据缺少新增字段（`id`、`operatorId` 等）。代码需容忍这些字段缺失，旧记录显示时将操作者显示为"未知"，`id` 缺失的旧记录不支持 edit/revoke/remove 操作（或在首次读取时自动补上 id）。

## API 设计

所有接口使用 `requireAdmin(event)` 鉴权，返回 `{ success: boolean, error?: string, ...data }` 格式。

### GET /api/admin/users

分页获取用户列表。

查询参数：
- `page: number`（默认 1）
- `pageSize: number`（默认 20，上限 100）
- `search?: string`（模糊匹配 gameId 或 email）
- `filter?: "banned" | "admin"`（状态筛选）

返回：
```typescript
{
  success: true,
  users: Array<{
    id: string;          // ObjectId 字符串
    gameId: string;
    email: string;
    isAdmin: boolean;
    hasBan: boolean;     // 是否有生效中的封禁
    registerAt: number;  // 时间戳
  }>,
  total: number,
  page: number,
  pageSize: number
}
```

MongoDB 查询使用 `skip/limit` 分页，`search` 使用正则匹配，`filter=banned` 通过 `hasActiveBan` 逻辑构造查询条件，`filter=admin` 通过 `isAdmin: true` 筛选。

### GET /api/admin/users/[userId]/bans

获取某用户的全部封禁记录，按 `start` 倒序返回。

### POST /api/admin/users/[userId]/bans

新建封禁。

Body：
```typescript
{ end?: string; reason?: string }
// end 为 ISO 日期字符串，不传则永久
```

服务端自动填充 `id`（nanoid）、`start`（当前时间）、`operatorId`（当前管理员 userId）。使用 MongoDB `$push` 将新记录追加到用户的 `bans` 数组。

### PATCH /api/admin/users/[userId]/bans/[banId]

编辑封禁记录（修改截止时间和/或理由）。

Body：
```typescript
{ end?: string | null; reason?: string }
// end 为 null 表示改为永久，为 ISO 字符串表示设置截止时间
```

使用 MongoDB positional operator `$set` 更新匹配 `bans.id` 的数组元素。

### POST /api/admin/users/[userId]/bans/[banId]/revoke

撤销封禁。服务端设置该记录的 `revokedAt` 为当前时间，`revokedBy` 为当前管理员 userId。仅对生效中的封禁有效。

### DELETE /api/admin/users/[userId]/bans/[banId]

移除封禁记录。使用 MongoDB `$pull` 从 `bans` 数组中删除匹配 `bans.id` 的元素。

## 前端设计

### 页面：/app/pages/admin/users.vue

独立全屏页面，`definePageMeta({ hideFooter: true })`。客户端管理员守卫（与 plugins.vue 一致）。

布局结构：
- 顶部：页面标题 + 搜索输入框 + 状态筛选下拉
- 中部：用户表格（列：用户名、邮箱、注册时间、状态、操作）
- 底部：分页控件（总数显示 + 页码按钮）

### 组件：AdminUserTable.vue

用户表格组件，接收 props：
- `users: UserItem[]` — 用户列表数据
- `loading: boolean` — 加载状态

Emit 事件：
- `open-bans(userId: string)` — 点击封禁信息按钮

操作列使用下拉菜单（DaisyUI dropdown），目前仅包含"封禁信息"按钮。

### 组件：AdminBanModal.vue

封禁详情弹窗，使用 `<dialog>` + `ClientOnly` + `Teleport to="body"` 模式。

通过 `defineExpose({ open(userId: string) })` 暴露打开方法。

弹窗内部结构：
1. **新建封禁区域**（顶部）
   - 快捷时长按钮组：1天、7天、30天、永久、自定义
   - 点击"自定义"展开日期时间选择器
   - 理由输入框（可选）
   - 确认封禁按钮
2. **封禁历史列表**（下方，按 start 倒序）
   - 每条记录显示：状态标签、时间信息、理由、操作者
   - 生效中：红色高亮背景，提供撤销/编辑/移除
   - 已撤销/已过期：半透明，提供编辑/移除
   - 编辑：点击后该条目内联展开编辑表单
   - 移除：按钮变为"确认移除？"二次确认模式

### 数据流

1. 页面加载 → `$fetch('/api/admin/users', { query })` 获取分页数据
2. 搜索/筛选/翻页 → 更新 query 参数重新请求
3. 点击"封禁信息" → 打开 `AdminBanModal`，传入 userId
4. 弹窗内部 `$fetch` 加载该用户封禁列表
5. 封禁操作（新建/撤销/编辑/移除）→ 调用对应 API → 刷新封禁列表 + emit 事件刷新用户表格

### AdminUserManageTab.vue 处理

现有 stub 改为显示跳转链接，引导用户前往 `/admin/users` 页面。

## 不在范围内

- 用户创建/删除功能
- 管理员权限分级
- 封禁记录的跨用户搜索/导出
- 批量操作
