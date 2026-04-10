# OAuth 应用自定义图标

## 概述

为 OAuth 应用添加自定义图标能力。图标由矩形背景 + HugeIcon 组成，颜色通过 hue 值（0–360）映射到 oklch 色彩空间。图标集称为 Built-in Icons，使用 Nuxt Island Component 在服务端渲染，避免客户端体积增长。

## 数据模型

### OAuthAppDocument 新增字段

```ts
icon: { name: string; hue: number } | null;
```

- `name` — 自定义标识名（如 `"link"`、`"ai-brain"`），不使用 HugeIcon 原始名称
- `hue` — 0–360 整数，用于 oklch 颜色映射
- `null` — 前端视为默认值 `{ name: "link", hue: 240 }`

无需数据库 migration，新字段为 `null`，现有文档无此字段等同 `null`。

## 图标注册表

### 共享常量 `shared/builtin-icon-names.ts`

客户端和服务端共用，不引入任何 HugeIcon 依赖：

```ts
export const BUILTIN_ICON_NAMES = [
  "link", "ai-brain", "robot", "ranking", "honor", "star-honor",
  "bookmark", "star", "tag", "lighthouse", "anvil", "firepit",
  "activity", "balance", "analytics", "calculate", "id-card",
  "support", "fireworks", "git-merge", "discover", "dashboard",
  "timer", "cable", "gamepad", "globe", "flag", "map", "saturn",
  "chat", "image",
] as const;

export type BuiltInIconName = (typeof BUILTIN_ICON_NAMES)[number];

export const DEFAULT_ICON = { name: "link" as const, hue: 240 };
```

### 服务端注册表 `server/utils/builtin-icons.ts`

静态导入 HugeIcon 组件，支持 tree-shaking：

```ts
import { Link01Icon, AiBrain01Icon, RoboticIcon, ... } from "@hugeicons/core-free-icons";
import { BUILTIN_ICON_NAMES } from "~/shared/builtin-icon-names";

export const BUILTIN_ICONS: Record<string, any> = {
  "link":       Link01Icon,
  "ai-brain":   AiBrain01Icon,
  "robot":      RoboticIcon,
  // ... 全部 30 个图标
};
```

仅在服务端上下文使用（Island 组件 + API 校验）。

## 颜色系统

基于 hue 值通过 oklch 映射颜色，预留亮色/暗色模式：

| CSS 变量 | 亮色模式 | 暗色模式（预留） |
|----------|---------|--------------|
| `--theme-bg` | `oklch(0.75 0.08 <hue> / 0.20)` | `oklch(0.55 0.06 <hue> / 0.15)` |
| `--theme-border` | `oklch(0.62 0.10 <hue> / 0.30)` | `oklch(0.65 0.08 <hue> / 0.25)` |
| `--theme-fg` | `oklch(0.40 0.12 <hue> / 0.80)` | `oklch(0.82 0.09 <hue> / 0.85)` |

颜色由客户端包装组件计算并注入为 CSS 变量，Island 组件通过 `var()` 引用。hue 变化时只更新 CSS 变量，不触发 Island 重新请求。

## 组件架构

### BuiltInIcon Island 组件

`components/islands/BuiltInIcon.vue` — Nuxt Server Component。

- Props：`name: string`、`size?: number`
- 不接收 `hue`，颜色通过 CSS 变量 `var(--theme-fg)` 引用
- 根据 `name` 从 `BUILTIN_ICONS` 注册表查找图标，找不到时 fallback 到默认图标
- 渲染 `<HugeiconsIcon>` SVG

### OAuthAppIcon 客户端包装组件

`app/components/OAuthAppIcon.vue` — 客户端组件，负责颜色和布局。

- Props：`name?: string | null`、`hue?: number | null`、`size?: number`
- 计算 oklch CSS 变量并注入到容器 style
- 内部使用 `<NuxtIsland name="BuiltInIcon">` 渲染图标形状
- 容器设置 `width: 100%; height: 100%` 填满父元素

### IconPicker 图标选择器

`app/components/IconPicker.vue` — 客户端组件，用于开发者创建/编辑页面。

**Props & Events：**

```ts
defineProps<{
  modelValue: { name: string; hue: number } | null;
}>();
defineEmits<{
  "update:modelValue": [value: { name: string; hue: number }];
}>();
```

**交互：**

1. 展示图标预览区（`<OAuthAppIcon>` 渲染当前选中值或默认值）
2. 点击预览区弹出 Popover（HTML `popover` 属性）
3. Popover 上方：5×6 图标网格，每格用 `<NuxtIsland>` 渲染图标形状，选中态用 `--theme-border` 高亮
4. Popover 下方：`<input type="range" min="0" max="360">` hue 滑块，轨道用 CSS 线性渐变覆盖全色相谱

**性能：** 网格内 Island 只渲染图标形状（与 hue 无关），首次打开时请求一次。hue 滑块拖动只更新 CSS 变量，无 Island 重新请求。

**默认值行为：** `modelValue` 为 `null` 时显示默认值预览（link + hue 240），不主动写入默认值。用户操作选择器后才产生非 null 值。

## API 层变更

### Zod 校验

创建和编辑 API 的 body 新增可选 `icon` 字段：

```ts
icon: z.object({
  name: z.enum(BUILTIN_ICON_NAMES),
  hue: z.number().int().min(0).max(360),
}).nullable().optional(),
```

### 受影响端点

| 端点 | 变更 |
|------|------|
| `POST /api/oauth-provider/apps` | body 接受 `icon`，存入文档 |
| `PATCH /api/oauth-provider/apps/[clientId]` | body 接受 `icon`，更新文档 |
| `GET /api/oauth-provider/apps` | 返回中自动包含 `icon` |
| `GET /api/oauth-provider/apps/[clientId]` | 同上 |
| `GET /api/oauth-provider/admin/apps` | 同上 |
| `GET /api/oauth-provider/authorizations` | 返回中附带 `appIcon` 字段 |

## 前端变更

### 替换 PuzzleIcon 的页面

| 页面 | 当前 | 替换为 |
|------|------|--------|
| `app/pages/developer/apps/index.vue` | 40×40 灰色方块 + PuzzleIcon | `<OAuthAppIcon>` |
| `app/pages/oauth/authorize.vue` | 64×64 灰色方块 + PuzzleIcon | `<OAuthAppIcon>` |
| `app/pages/settings/authorizations.vue` | 40×40 灰色方块 + PuzzleIcon | `<OAuthAppIcon>` |

### 新增 IconPicker 的页面

| 页面 | 位置 |
|------|------|
| `app/pages/developer/apps/new.vue` | 表单中新增 `<IconPicker v-model="icon" />` |
| `app/pages/developer/apps/[clientId].vue` | 表单中新增 `<IconPicker v-model="icon" />` |

### AuthorizationItem 接口扩展

```ts
appIcon: { name: string; hue: number } | null;
```

## 文件清单

**新建：**
- `shared/builtin-icon-names.ts`
- `server/utils/builtin-icons.ts`
- `components/islands/BuiltInIcon.vue`
- `app/components/OAuthAppIcon.vue`
- `app/components/IconPicker.vue`

**修改：**
- `server/types/oauth-app.schema.ts`
- `server/api/oauth-provider/apps.post.ts`
- `server/api/oauth-provider/apps/[clientId].patch.ts`
- `server/api/oauth-provider/authorizations.get.ts`
- `app/pages/developer/apps/new.vue`
- `app/pages/developer/apps/[clientId].vue`
- `app/pages/developer/apps/index.vue`
- `app/pages/oauth/authorize.vue`
- `app/pages/settings/authorizations.vue`
