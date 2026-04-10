# OAuth 应用自定义图标 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 OAuth 应用添加可选的自定义图标（Built-in Icon + hue 色相），替换所有页面中的通用 PuzzleIcon 占位符。

**Architecture:** 图标标识名和 hue 值存储在 `OAuthAppDocument.icon` 字段中。图标 SVG 通过 Nuxt Island Component 在服务端渲染（避免客户端引入 HugeIcon 体积），颜色由客户端 CSS 变量控制。开发者通过 Popover 选择器在创建/编辑页面配置图标。

**Tech Stack:** Nuxt 4 Islands, HugeIcons, oklch 色彩系统, Zod, HTML Popover API

---

## File Structure

**新建：**
| 文件 | 职责 |
|------|------|
| `shared/builtin-icon-names.ts` | 图标标识名列表 + 默认值常量（客户端 & 服务端共用） |
| `server/utils/builtin-icons.ts` | 图标注册表，静态导入 HugeIcon 组件（仅服务端） |
| `components/islands/BuiltInIcon.vue` | Island 服务端组件，渲染 SVG 图标形状 |
| `app/components/OAuthAppIcon.vue` | 客户端包装组件，计算 oklch CSS 变量 + 包裹 Island |
| `app/components/IconPicker.vue` | 图标选择器 Popover（v-model 绑定） |

**修改：**
| 文件 | 变更 |
|------|------|
| `nuxt.config.ts` | 启用 `experimental.componentIslands` |
| `server/types/oauth-app.schema.ts` | 新增 `icon` 字段 |
| `server/api/oauth-provider/apps/index.post.ts` | body 接受 `icon` |
| `server/api/oauth-provider/apps/[clientId].patch.ts` | body 接受 `icon` |
| `server/api/oauth-provider/authorizations/index.get.ts` | 返回 `appIcon` |
| `app/pages/developer/apps/new.vue` | 集成 IconPicker |
| `app/pages/developer/apps/[clientId].vue` | 集成 IconPicker |
| `app/pages/developer/apps/index.vue` | 替换 PuzzleIcon 为 OAuthAppIcon |
| `app/pages/oauth/authorize.vue` | 替换 PuzzleIcon 为 OAuthAppIcon |
| `app/pages/settings/authorizations.vue` | 替换 PuzzleIcon 为 OAuthAppIcon |

---

### Task 1: 启用 Islands 并创建共享常量

**Files:**
- Modify: `nuxt.config.ts`
- Create: `shared/builtin-icon-names.ts`

- [ ] **Step 1: 在 nuxt.config.ts 中启用 Islands**

在 `defineNuxtConfig` 中添加 `experimental` 配置：

```ts
// nuxt.config.ts — 在 future: { compatibilityVersion: 4 } 之后添加
experimental: {
  componentIslands: true,
},
```

- [ ] **Step 2: 创建共享常量文件**

```ts
// shared/builtin-icon-names.ts
export const BUILTIN_ICON_NAMES = [
  "link",
  "ai-brain",
  "robot",
  "ranking",
  "honor",
  "star-honor",
  "bookmark",
  "star",
  "tag",
  "lighthouse",
  "anvil",
  "firepit",
  "activity",
  "balance",
  "analytics",
  "calculate",
  "id-card",
  "support",
  "fireworks",
  "git-merge",
  "discover",
  "dashboard",
  "timer",
  "cable",
  "gamepad",
  "globe",
  "flag",
  "map",
  "saturn",
  "chat",
  "image",
] as const;

export type BuiltInIconName = (typeof BUILTIN_ICON_NAMES)[number];

export const DEFAULT_ICON = { name: "link" as const, hue: 240 };
```

- [ ] **Step 3: Commit**

```bash
rtk git add nuxt.config.ts shared/builtin-icon-names.ts
rtk git commit -m "feat(oauth): enable islands and add builtin icon name constants"
```

---

### Task 2: 创建服务端图标注册表

**Files:**
- Create: `server/utils/builtin-icons.ts`

- [ ] **Step 1: 创建注册表文件**

```ts
// server/utils/builtin-icons.ts
import {
  Link01Icon,
  AiBrain01Icon,
  RoboticIcon,
  RankingIcon,
  HonorIcon,
  HonourStarIcon,
  Bookmark02Icon,
  StarIcon,
  Tag01Icon,
  LighthouseIcon,
  AnvilIcon,
  FirePitIcon,
  Activity03Icon,
  BalanceScaleIcon,
  Analytics01Icon,
  CalculateIcon,
  IdCardLanyardIcon,
  CustomerService01Icon,
  FireworksIcon,
  GitMergeIcon,
  DiscoverSquareIcon,
  DashboardSpeed01Icon,
  Timer01Icon,
  CableIcon,
  GameController03Icon,
  GlobalIcon,
  Flag03Icon,
  MapingIcon,
  SaturnIcon,
  Chat01Icon,
  Image03Icon,
} from "@hugeicons/core-free-icons";
import { DEFAULT_ICON } from "~/shared/builtin-icon-names";

export const BUILTIN_ICONS: Record<string, any> = {
  "link": Link01Icon,
  "ai-brain": AiBrain01Icon,
  "robot": RoboticIcon,
  "ranking": RankingIcon,
  "honor": HonorIcon,
  "star-honor": HonourStarIcon,
  "bookmark": Bookmark02Icon,
  "star": StarIcon,
  "tag": Tag01Icon,
  "lighthouse": LighthouseIcon,
  "anvil": AnvilIcon,
  "firepit": FirePitIcon,
  "activity": Activity03Icon,
  "balance": BalanceScaleIcon,
  "analytics": Analytics01Icon,
  "calculate": CalculateIcon,
  "id-card": IdCardLanyardIcon,
  "support": CustomerService01Icon,
  "fireworks": FireworksIcon,
  "git-merge": GitMergeIcon,
  "discover": DiscoverSquareIcon,
  "dashboard": DashboardSpeed01Icon,
  "timer": Timer01Icon,
  "cable": CableIcon,
  "gamepad": GameController03Icon,
  "globe": GlobalIcon,
  "flag": Flag03Icon,
  "map": MapingIcon,
  "saturn": SaturnIcon,
  "chat": Chat01Icon,
  "image": Image03Icon,
};

export function resolveBuiltInIcon(name: string) {
  return BUILTIN_ICONS[name] ?? BUILTIN_ICONS[DEFAULT_ICON.name];
}
```

- [ ] **Step 2: Commit**

```bash
rtk git add server/utils/builtin-icons.ts
rtk git commit -m "feat(oauth): add server-side builtin icon registry"
```

---

### Task 3: 创建 Island 组件 BuiltInIcon

**Files:**
- Create: `components/islands/BuiltInIcon.vue`

- [ ] **Step 1: 创建 Island 组件**

```vue
<!-- components/islands/BuiltInIcon.vue -->
<script setup lang="ts">
import { HugeiconsIcon } from "@hugeicons/vue";

const props = defineProps<{
  name: string;
  size?: number;
}>();

const icon = resolveBuiltInIcon(props.name);
</script>

<template>
  <HugeiconsIcon :icon="icon" :size="size ?? 24" style="color: var(--theme-fg)" />
</template>
```

注意：`resolveBuiltInIcon` 来自 `server/utils/builtin-icons.ts`，在服务端上下文自动导入。Island 组件在服务端渲染，可以使用服务端 auto-import。

- [ ] **Step 2: 验证 dev server 启动正常**

```bash
bun run dev
```

在浏览器中访问 `/__nuxt_island/BuiltInIcon?props={"name":"link","size":24}` 确认返回 SVG HTML。

- [ ] **Step 3: Commit**

```bash
rtk git add components/islands/BuiltInIcon.vue
rtk git commit -m "feat(oauth): add BuiltInIcon island server component"
```

---

### Task 4: 创建客户端包装组件 OAuthAppIcon

**Files:**
- Create: `app/components/OAuthAppIcon.vue`

- [ ] **Step 1: 创建组件**

```vue
<!-- app/components/OAuthAppIcon.vue -->
<script setup lang="ts">
import { DEFAULT_ICON } from "~/shared/builtin-icon-names";

const props = defineProps<{
  name?: string | null;
  hue?: number | null;
  size?: number;
}>();

const iconName = computed(() => props.name ?? DEFAULT_ICON.name);
const iconHue = computed(() => props.hue ?? DEFAULT_ICON.hue);

const colorVars = computed(() => ({
  "--theme-bg": `oklch(0.75 0.08 ${iconHue.value} / 0.20)`,
  "--theme-border": `oklch(0.62 0.10 ${iconHue.value} / 0.30)`,
  "--theme-fg": `oklch(0.40 0.12 ${iconHue.value} / 0.80)`,
}));
</script>

<template>
  <div
    class="inline-flex items-center justify-center w-full h-full"
    :style="colorVars"
    style="background: var(--theme-bg); border: 1px solid var(--theme-border)"
  >
    <NuxtIsland name="BuiltInIcon" :props="{ name: iconName, size }" />
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
rtk git add app/components/OAuthAppIcon.vue
rtk git commit -m "feat(oauth): add OAuthAppIcon client wrapper component"
```

---

### Task 5: 数据模型 + API 变更

**Files:**
- Modify: `server/types/oauth-app.schema.ts`
- Modify: `server/api/oauth-provider/apps/index.post.ts`
- Modify: `server/api/oauth-provider/apps/[clientId].patch.ts`
- Modify: `server/api/oauth-provider/authorizations/index.get.ts`

- [ ] **Step 1: 更新 OAuthAppDocument 类型**

在 `server/types/oauth-app.schema.ts` 的 `OAuthAppDocument` 接口中，在 `description` 之后添加：

```ts
icon: { name: string; hue: number } | null;
```

完整接口变为：

```ts
export interface OAuthAppDocument {
  _id: ObjectId;
  clientId: string;
  clientSecretHash: string | null;
  type: OAuthClientType;
  name: string;
  description: string;
  icon: { name: string; hue: number } | null;
  redirectUris: string[];
  scopes: OAuthScope[];
  ownerId: string;
  approved: boolean;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 2: 修改创建 API**

在 `server/api/oauth-provider/apps/index.post.ts` 中：

1. 在文件顶部 import 之后添加：
```ts
import { BUILTIN_ICON_NAMES } from "~/shared/builtin-icon-names";
```

2. 在 `bodySchema` 中添加 `icon` 字段：
```ts
const bodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
  type: z.enum(["confidential", "public"]),
  redirectUris: z.array(z.string().url()).min(1).max(10),
  scopes: z.array(z.enum(VALID_SCOPES as [string, ...string[]])).min(1),
  icon: z
    .object({
      name: z.enum(BUILTIN_ICON_NAMES as unknown as [string, ...string[]]),
      hue: z.number().int().min(0).max(360),
    })
    .nullable()
    .optional(),
});
```

3. 在解构 `parsed.data` 时添加 `icon`：
```ts
const { name, description, type, redirectUris, scopes, icon } = parsed.data;
```

4. 在 `insertOAuthApp` 调用中，在 `description` 之后添加：
```ts
icon: icon ?? null,
```

- [ ] **Step 3: 修改编辑 API**

在 `server/api/oauth-provider/apps/[clientId].patch.ts` 中：

1. 在文件顶部 import 之后添加：
```ts
import { BUILTIN_ICON_NAMES } from "~/shared/builtin-icon-names";
```

2. 在 `bodySchema` 中添加 `icon` 字段：
```ts
const bodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  redirectUris: z.array(z.string().url()).min(1).max(10).optional(),
  scopes: z.array(z.enum(VALID_SCOPES as [string, ...string[]])).min(1).optional(),
  icon: z
    .object({
      name: z.enum(BUILTIN_ICON_NAMES as unknown as [string, ...string[]]),
      hue: z.number().int().min(0).max(360),
    })
    .nullable()
    .optional(),
});
```

无需其他修改——`data` 直接传给 `updateOAuthApp(clientId, data)`，新字段自动包含。

- [ ] **Step 4: 修改授权列表 API，返回 appIcon**

在 `server/api/oauth-provider/authorizations/index.get.ts` 中，在 `map` 回调的返回对象中添加 `appIcon`：

```ts
return {
  clientId: auth.clientId,
  appName: app?.name ?? null,
  appDescription: app?.description ?? null,
  appIcon: app?.icon ?? null,
  scopes: auth.scopes,
  grantedAt: auth.grantedAt,
  updatedAt: auth.updatedAt,
};
```

- [ ] **Step 5: Commit**

```bash
rtk git add server/types/oauth-app.schema.ts server/api/oauth-provider/apps/index.post.ts server/api/oauth-provider/apps/\[clientId\].patch.ts server/api/oauth-provider/authorizations/index.get.ts
rtk git commit -m "feat(oauth): add icon field to OAuth app schema and APIs"
```

---

### Task 6: 创建 IconPicker 组件

**Files:**
- Create: `app/components/IconPicker.vue`

- [ ] **Step 1: 创建选择器组件**

```vue
<!-- app/components/IconPicker.vue -->
<script setup lang="ts">
import { BUILTIN_ICON_NAMES, DEFAULT_ICON } from "~/shared/builtin-icon-names";

const props = defineProps<{
  modelValue: { name: string; hue: number } | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: { name: string; hue: number }];
}>();

const currentName = computed(() => props.modelValue?.name ?? DEFAULT_ICON.name);
const currentHue = computed(() => props.modelValue?.hue ?? DEFAULT_ICON.hue);

const popoverRef = useTemplateRef<HTMLDivElement>("popoverRef");

function selectIcon(name: string) {
  emit("update:modelValue", { name, hue: currentHue.value });
}

function updateHue(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  emit("update:modelValue", { name: currentName.value, hue: value });
}

const colorVars = computed(() => ({
  "--theme-bg": `oklch(0.75 0.08 ${currentHue.value} / 0.20)`,
  "--theme-border": `oklch(0.62 0.10 ${currentHue.value} / 0.30)`,
  "--theme-fg": `oklch(0.40 0.12 ${currentHue.value} / 0.80)`,
}));
</script>

<template>
  <div class="flex flex-col gap-2">
    <span class="fieldset-legend text-sm font-semibold">应用图标</span>
    <div class="flex items-center gap-3">
      <!-- Preview trigger -->
      <button
        type="button"
        class="w-14 h-14 shrink-0 cursor-pointer"
        :popovertarget="'icon-picker-popover'"
      >
        <OAuthAppIcon :name="currentName" :hue="currentHue" :size="24" />
      </button>
      <span class="text-sm text-base-content/60">点击选择图标和颜色</span>
    </div>

    <!-- Popover -->
    <div
      id="icon-picker-popover"
      ref="popoverRef"
      popover
      class="bg-base-100 border border-base-300 shadow-lg p-4 w-80"
    >
      <!-- Icon grid -->
      <div class="grid grid-cols-6 gap-1.5 mb-4" :style="colorVars">
        <button
          v-for="iconName in BUILTIN_ICON_NAMES"
          :key="iconName"
          type="button"
          class="w-10 h-10 flex items-center justify-center cursor-pointer transition-colors"
          :style="{
            background: currentName === iconName ? 'var(--theme-bg)' : undefined,
            border: currentName === iconName
              ? '1px solid var(--theme-border)'
              : '1px solid transparent',
          }"
          @click="selectIcon(iconName)"
        >
          <NuxtIsland name="BuiltInIcon" :props="{ name: iconName, size: 18 }" />
        </button>
      </div>

      <!-- Hue slider -->
      <div class="flex flex-col gap-1.5">
        <label class="text-xs text-base-content/60">色相</label>
        <input
          type="range"
          min="0"
          max="360"
          :value="currentHue"
          class="w-full h-2 appearance-none cursor-pointer hue-slider"
          @input="updateHue"
        />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.hue-slider {
  background: linear-gradient(
    to right,
    oklch(0.65 0.10 0),
    oklch(0.65 0.10 60),
    oklch(0.65 0.10 120),
    oklch(0.65 0.10 180),
    oklch(0.65 0.10 240),
    oklch(0.65 0.10 300),
    oklch(0.65 0.10 360)
  );
  border-radius: 0;
  outline: none;

  &::-webkit-slider-thumb {
    appearance: none;
    width: 14px;
    height: 14px;
    background: white;
    border: 2px solid oklch(0.50 0 0);
    border-radius: 0;
    cursor: pointer;
  }

  &::-moz-range-thumb {
    width: 14px;
    height: 14px;
    background: white;
    border: 2px solid oklch(0.50 0 0);
    border-radius: 0;
    cursor: pointer;
  }
}
</style>
```

- [ ] **Step 2: Commit**

```bash
rtk git add app/components/IconPicker.vue
rtk git commit -m "feat(oauth): add IconPicker popover component"
```

---

### Task 7: 集成 IconPicker 到创建页面

**Files:**
- Modify: `app/pages/developer/apps/new.vue`

- [ ] **Step 1: 添加 icon ref**

在 `app/pages/developer/apps/new.vue` 的 `<script setup>` 中，在 `const scopes = ref<string[]>(["profile:read"]);` 之后添加：

```ts
const icon = ref<{ name: string; hue: number } | null>(null);
```

- [ ] **Step 2: 在提交 body 中加入 icon**

在 `handleSubmit` 函数中，将 `$fetch` 调用的 `body` 修改为：

```ts
body: {
  name: name.value.trim(),
  description: description.value.trim(),
  type: type.value,
  redirectUris: validUris,
  scopes: scopes.value,
  icon: icon.value,
},
```

- [ ] **Step 3: 在模板中添加 IconPicker**

在 `<template>` 中，在 `<!-- Name -->` 注释之前添加：

```vue
<!-- Icon -->
<IconPicker v-model="icon" />
```

- [ ] **Step 4: 移除不再需要的 PuzzleIcon import（如果有的话）**

检查 `new.vue` 的 import 列表，此文件不使用 PuzzleIcon，无需修改 import。

- [ ] **Step 5: Commit**

```bash
rtk git add app/pages/developer/apps/new.vue
rtk git commit -m "feat(oauth): integrate IconPicker into app creation page"
```

---

### Task 8: 集成 IconPicker 到编辑页面

**Files:**
- Modify: `app/pages/developer/apps/[clientId].vue`

- [ ] **Step 1: 扩展 AppDetail 接口**

在 `app/pages/developer/apps/[clientId].vue` 的 `AppDetail` 接口中添加：

```ts
interface AppDetail {
  clientId: string;
  name: string;
  description: string;
  icon: { name: string; hue: number } | null;
  type: string;
  redirectUris: string[];
  scopes: string[];
  approved: boolean;
  createdAt: string;
}
```

- [ ] **Step 2: 添加 editIcon ref**

在 `const editScopes = ref<string[]>([]);` 之后添加：

```ts
const editIcon = ref<{ name: string; hue: number } | null>(null);
```

- [ ] **Step 3: 在 fetchApp 中初始化 editIcon**

在 `fetchApp` 函数中，在 `editScopes.value = [...data.scopes];` 之后添加：

```ts
editIcon.value = data.icon ? { ...data.icon } : null;
```

- [ ] **Step 4: 在 handleSave 的 body 中加入 icon**

在 `handleSave` 函数的 `$fetch` body 中添加 `icon`:

```ts
body: {
  name: editName.value.trim(),
  description: editDescription.value.trim(),
  redirectUris: validUris,
  scopes: editScopes.value,
  icon: editIcon.value,
},
```

- [ ] **Step 5: 在模板中添加 IconPicker**

在表单中 `<!-- Client ID (readonly) -->` 之前添加：

```vue
<!-- Icon -->
<IconPicker v-model="editIcon" />
```

- [ ] **Step 6: Commit**

```bash
rtk git add app/pages/developer/apps/\[clientId\].vue
rtk git commit -m "feat(oauth): integrate IconPicker into app edit page"
```

---

### Task 9: 替换开发者应用列表中的 PuzzleIcon

**Files:**
- Modify: `app/pages/developer/apps/index.vue`

- [ ] **Step 1: 扩展 AppItem 接口**

在 `app/pages/developer/apps/index.vue` 的 `AppItem` 接口中添加：

```ts
interface AppItem {
  clientId: string;
  name: string;
  description: string;
  icon: { name: string; hue: number } | null;
  type: string;
  approved: boolean;
  createdAt: string;
}
```

- [ ] **Step 2: 替换模板中的图标**

将模板中的：

```vue
<div class="w-10 h-10 shrink-0 bg-base-300 border border-base-300 flex items-center justify-center">
  <HugeiconsIcon :icon="PuzzleIcon" :size="16" class="text-base-content/40" />
</div>
```

替换为：

```vue
<div class="w-10 h-10 shrink-0">
  <OAuthAppIcon :name="app.icon?.name" :hue="app.icon?.hue" :size="16" />
</div>
```

- [ ] **Step 3: 清理无用 import**

从 import 语句中移除 `PuzzleIcon`：

```ts
// 之前
import { PlusSignIcon, PuzzleIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
// 之后
import { PlusSignIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
```

同时检查空状态（`apps.length === 0`）中是否还使用 PuzzleIcon。空状态中的 PuzzleIcon 保留——它表示"还没有应用"的占位状态，与具体 OAuth 应用图标无关。

- [ ] **Step 4: Commit**

```bash
rtk git add app/pages/developer/apps/index.vue
rtk git commit -m "feat(oauth): replace PuzzleIcon with OAuthAppIcon in app list"
```

---

### Task 10: 替换授权确认页面中的 PuzzleIcon

**Files:**
- Modify: `app/pages/oauth/authorize.vue`

- [ ] **Step 1: 扩展 appInfo 类型，在 fetchApp 中获取 icon**

在 `app/pages/oauth/authorize.vue` 中，修改 `appInfo` 的类型：

```ts
const appInfo = ref<{
  name: string;
  description: string;
  icon: { name: string; hue: number } | null;
} | null>(null);
```

`fetchApp` 不需要修改——`$fetch` 返回的数据已包含 `icon` 字段。

- [ ] **Step 2: 替换模板中的图标**

将：

```vue
<div class="w-16 h-16 bg-base-200 border border-base-300 flex items-center justify-center">
  <HugeiconsIcon :icon="PuzzleIcon" class="text-base-content/40" />
</div>
```

替换为：

```vue
<div class="w-16 h-16">
  <OAuthAppIcon :name="appInfo.icon?.name" :hue="appInfo.icon?.hue" :size="24" />
</div>
```

- [ ] **Step 3: 清理 import**

从 import 中移除 `PuzzleIcon`：

```ts
// 之前
import { PuzzleIcon, ShieldKeyIcon } from "@hugeicons/core-free-icons";
// 之后
import { ShieldKeyIcon } from "@hugeicons/core-free-icons";
```

如果 `HugeiconsIcon` 仅被 PuzzleIcon 使用且 ShieldKeyIcon 仍在使用，保留 `HugeiconsIcon` import。

- [ ] **Step 4: Commit**

```bash
rtk git add app/pages/oauth/authorize.vue
rtk git commit -m "feat(oauth): replace PuzzleIcon with OAuthAppIcon in authorize page"
```

---

### Task 11: 替换用户授权列表中的 PuzzleIcon

**Files:**
- Modify: `app/pages/settings/authorizations.vue`

- [ ] **Step 1: 扩展 AuthorizationItem 接口**

在 `app/pages/settings/authorizations.vue` 中，修改 `AuthorizationItem`：

```ts
interface AuthorizationItem {
  clientId: string;
  appName: string | null;
  appDescription: string | null;
  appIcon: { name: string; hue: number } | null;
  scopes: string[];
  grantedAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: 替换模板中的图标**

将列表项中的：

```vue
<div class="w-10 h-10 shrink-0 bg-base-300 border border-base-300 flex items-center justify-center">
  <HugeiconsIcon :icon="PuzzleIcon" :size="16" class="text-base-content/40" />
</div>
```

替换为：

```vue
<div class="w-10 h-10 shrink-0">
  <OAuthAppIcon :name="auth.appIcon?.name" :hue="auth.appIcon?.hue" :size="16" />
</div>
```

- [ ] **Step 3: 清理 import**

从 import 中移除 `PuzzleIcon`：

```ts
// 之前
import { ShieldKeyIcon, PuzzleIcon } from "@hugeicons/core-free-icons";
// 之后
import { ShieldKeyIcon } from "@hugeicons/core-free-icons";
```

检查是否还有其他使用 `PuzzleIcon` 的地方（空状态）。此文件空状态使用 `ShieldKeyIcon`，可以安全移除 PuzzleIcon。

同时检查 `HugeiconsIcon` 是否仍被使用（ShieldKeyIcon 在空状态中使用），保留 `import { HugeiconsIcon } from "@hugeicons/vue";`。

- [ ] **Step 4: Commit**

```bash
rtk git add app/pages/settings/authorizations.vue
rtk git commit -m "feat(oauth): replace PuzzleIcon with OAuthAppIcon in authorizations page"
```

---

### Task 12: 端到端验证

- [ ] **Step 1: 启动 dev server**

```bash
bun run dev
```

- [ ] **Step 2: 验证功能**

手动验证以下流程：

1. 访问 `/developer/apps/new`，确认 IconPicker 可见，可选择图标和调整 hue 滑块
2. 创建应用时带图标，确认创建成功
3. 访问 `/developer/apps`，确认列表中显示自定义图标而非 PuzzleIcon
4. 进入编辑页面 `/developer/apps/:clientId`，确认 IconPicker 显示已保存的图标
5. 修改图标并保存，确认更新成功
6. 创建一个不选择图标的应用，确认列表中显示默认图标（link + hue 240）
7. 访问 `/settings/authorizations`（需要先授权一个应用），确认显示应用图标

- [ ] **Step 3: 运行 lint**

```bash
rtk bun run lint
```

修复所有 lint 问题。

- [ ] **Step 4: 运行现有测试**

```bash
rtk bun run test
```

确认现有测试不受影响。
