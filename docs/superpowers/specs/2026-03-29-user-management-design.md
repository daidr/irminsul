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
  reason?: string;       // 封禁理由（最大 500 字符）
  operatorId: string;    // 执行封禁的管理员 uuid
  revokedAt?: Date;      // 撤销时间（存在则表示已撤销）
  revokedBy?: string;    // 撤销操作的管理员 uuid
}
```

**标识符约定**：`operatorId`、`revokedBy` 以及所有 API 路径中的 `userId` 统一使用用户的 `uuid`（带连字符格式），与 session 中的 `userId` 一致。用户列表返回的 `id` 也使用 `uuid`。

### 封禁状态判断

- **生效中**：`!revokedAt && start <= now && (!end || end > now)`
- **已撤销**：`revokedAt` 存在
- **已过期**：`!revokedAt && end && end <= now`

**`hasActiveBan()` 必须同步更新**：新逻辑为 `!ban.revokedAt && ban.start <= now && (!ban.end || ban.end > now)`。调用点包括：
- `server/utils/yggdrasil.service.ts`（`validateAccessToken`）
- `server/api/auth/forgot-password.post.ts`
- `server/api/auth/reset-password.post.ts`

### Session 中间件同步

`server/middleware/01.session.ts` 构造 `event.context.user.bans` 时需新增传递 `id`、`revokedAt`、`operatorId` 字段，使前端 `BanHistoryModal.vue`（用户侧）能区分"已撤销"和"生效中"状态。

### 旧数据迁移

使用服务器启动时的一次性迁移逻辑（server plugin），为所有缺少 `id` 的旧 `BanRecord` 补上 nanoid，`operatorId` 默认设为 `"system"`。避免在读取路径中产生写操作副作用。

## API 设计

所有接口使用 `requireAdmin(event)` 鉴权，返回 `{ success: boolean, error?: string, ...data }` 格式。

### 输入校验规范

所有 API 输入使用以下校验规则：
- `reason`：最大 500 字符
- `search`：最大 100 字符，**必须转义正则特殊字符**（`escapeRegExp`）防止 ReDoS
- `end`：必须是合法的 ISO 日期字符串，且必须是未来时间
- `page`：正整数，默认 1
- `pageSize`：正整数，范围 1-100，默认 20
- `userId` 路径参数：必须是合法 UUID 格式，用户不存在时返回 `{ success: false, error: "用户不存在" }`
- `banId` 路径参数：封禁记录不存在时返回 `{ success: false, error: "封禁记录不存在" }`

### GET /api/admin/users

分页获取用户列表。

查询参数：
- `page: number`（默认 1）
- `pageSize: number`（默认 20，上限 100）
- `search?: string`（模糊匹配 gameId 或 email，转义后使用正则）
- `filter?: "banned" | "admin"`（状态筛选）

返回：
```typescript
{
  success: true,
  users: Array<{
    id: string;          // 用户 uuid
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

MongoDB 查询使用 `skip/limit` 分页。`search` 对用户输入进行 `escapeRegExp` 转义后使用 `$regex` 匹配。`filter=banned` 使用 `$elemMatch` 构造复合条件：

```javascript
{
  bans: {
    $elemMatch: {
      revokedAt: { $exists: false },
      start: { $lte: now },
      $or: [{ end: { $exists: false } }, { end: { $gt: now } }]
    }
  }
}
```

`filter=admin` 通过 `isAdmin: true` 筛选。

**已知限制**：`filter=banned` 和 `search` 正则匹配均需扫描文档，万级用户以下性能可接受。`skip/limit` 分页在数据变化时可能出现重复/遗漏，管理后台场景可接受。

### GET /api/admin/users/[userId]/bans

获取某用户的全部封禁记录，按 `start` 倒序返回。上限 200 条。

### POST /api/admin/users/[userId]/bans

新建封禁。

Body：
```typescript
{ end?: string; reason?: string }
// end 为 ISO 日期字符串（必须为未来时间），不传则永久
// reason 最大 500 字符
```

服务端自动填充 `id`（nanoid）、`start`（当前时间）、`operatorId`（当前管理员 uuid）。使用 MongoDB `$push` 将新记录追加到用户的 `bans` 数组。

**约束**：禁止管理员封禁自己，返回 `{ success: false, error: "不能封禁自己" }`。

### PATCH /api/admin/users/[userId]/bans/[banId]

编辑封禁记录（修改截止时间和/或理由）。

Body：
```typescript
{ end?: string | null; reason?: string }
// end 为 null 表示改为永久，为 ISO 字符串表示设置截止时间
// reason 最大 500 字符
```

使用 MongoDB positional operator `$set` 更新匹配 `bans.id` 的数组元素。

**约束**：编辑操作不会清除 `revokedAt`。编辑已撤销的记录仅修改历史信息（`end`、`reason`），不影响其撤销状态。

### POST /api/admin/users/[userId]/bans/[banId]/revoke

撤销封禁。服务端设置该记录的 `revokedAt` 为当前时间，`revokedBy` 为当前管理员 uuid。

**幂等性保证**：使用条件更新 `{ "bans.id": banId, "bans.revokedAt": { $exists: false } }`，匹配不到则返回 `{ success: false, error: "该封禁已被撤销或不存在" }`。仅对生效中的封禁有效，已过期的封禁不可撤销。

### DELETE /api/admin/users/[userId]/bans/[banId]

移除封禁记录。使用 MongoDB `$pull` 从 `bans` 数组中删除匹配 `bans.id` 的元素。

**审计**：删除操作通过 evlog 记录审计日志，包含：操作者 uuid、目标用户 uuid、被删除的封禁记录快照。

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
   - 理由输入框（可选，最大 500 字符）
   - 确认封禁按钮
2. **封禁历史列表**（下方，按 start 倒序）
   - 每条记录显示：状态标签、时间信息、理由、操作者
   - 生效中：红色高亮背景，提供撤销/编辑/移除
   - 已撤销/已过期：半透明，提供编辑/移除
   - 编辑：点击后该条目内联展开编辑表单
   - 移除：按钮变为"确认移除？"二次确认模式

### 用户侧 BanHistoryModal.vue 更新

同步更新现有的 `BanHistoryModal.vue` 和 `ClientBanRecord` 类型，支持 `revokedAt` 字段，增加"已撤销"状态展示。

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
- `isBanned` 冗余字段优化（当前性能可接受，未来视用户量增长情况决定）
- cursor-based 分页（当前 skip/limit 满足需求）
