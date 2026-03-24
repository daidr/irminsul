# 插件管理页面实现计划

> **给 Agent 的说明：** 必须使用子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 来逐任务实现本计划。步骤使用复选框（`- [ ]`）语法进行追踪。

**目标：** 构建 `/admin/plugins` 页面，采用左右主从布局（master-detail），用于管理插件、配置及查看日志。

**架构：** 独立的 Nuxt 页面位于 `app/pages/admin/plugins.vue`，包含 8 个子 component 位于 `app/components/admin/` 下。左面板：可排序的插件列表 + Host 状态。右面板：标签页切换的详情视图（配置/日志/信息）。使用 SortableJS 实现拖拽排序。使用 SSE EventSource 实现实时日志流。

**技术栈：** Vue 3 Composition API、DaisyUI v5、Tailwind CSS v4、SortableJS、EventSource（SSE）

**设计规格：** `docs/superpowers/specs/2026-03-25-plugin-admin-page-design.md`

---

## 文件结构

### 新增文件

```
app/utils/plugin-condition.ts              — evaluateCondition() 移植到前端（不依赖 server 类型）
app/pages/admin/plugins.vue                — 页面入口：权限守卫、布局容器、数据获取
app/components/admin/
  PluginList.vue                           — 左面板：可排序的插件列表，带状态徽标
  PluginHostStatus.vue                     — Host 状态徽标 + dirty 原因 + 重启按钮
  PluginDetail.vue                         — 右面板：标题栏 + 启用/禁用 + 标签页切换器
  PluginConfigTab.vue                      — 基于 configSchema 的动态配置表单
  PluginLogTab.vue                         — SSE 实时日志 + 历史回滚 + 过滤
  PluginInfoTab.vue                        — 插件元数据展示
  PluginSystemSettingsModal.vue            — 系统设置弹窗（监听器、日志缓冲、保留策略）
  SortableList.vue                         — 通用 SortableJS 封装 component
```

### 新增依赖

```
sortablejs
@types/sortablejs (devDependency)
```

---

## 任务 1：安装 SortableJS + 前端条件求值器

**文件：**
- 新建：`app/utils/plugin-condition.ts`

- [ ] **步骤 1：安装 sortablejs**

```bash
bun add sortablejs && bun add -D @types/sortablejs
```

- [ ] **步骤 2：创建前端条件求值器**

将 `server/utils/plugin/condition.ts` 移植到 `app/utils/plugin-condition.ts`。该文件会被 Nuxt 在前端上下文中自动导入。移除 server 类型导入并使用内联类型：

```typescript
// 插件配置表单的条件求值器（前端）。
// 镜像 server/utils/plugin/condition.ts 的逻辑。

type FieldCondition = Record<string, unknown> | unknown;
type Condition =
  | { $or: Condition[] }
  | { $and: Condition[] }
  | { $not: Condition }
  | Record<string, FieldCondition>;

export function evaluateCondition(
  condition: Condition,
  config: Record<string, unknown>,
): boolean {
  if ("$or" in condition) {
    return (condition.$or as Condition[]).some((c) => evaluateCondition(c, config));
  }
  if ("$and" in condition) {
    return (condition.$and as Condition[]).every((c) => evaluateCondition(c, config));
  }
  if ("$not" in condition) {
    return !evaluateCondition(condition.$not as Condition, config);
  }
  const fields = condition as Record<string, FieldCondition>;
  for (const key of Object.keys(fields)) {
    if (!evaluateField(fields[key], config[key])) return false;
  }
  return true;
}

function evaluateField(fieldCondition: FieldCondition, value: unknown): boolean {
  if (!isOperatorObject(fieldCondition)) return value === fieldCondition;
  const op = fieldCondition as Record<string, unknown>;
  if ("eq" in op) return value === op.eq;
  if ("neq" in op) return value !== op.neq;
  if ("in" in op) return (op.in as unknown[]).includes(value);
  if ("nin" in op) return !(op.nin as unknown[]).includes(value);
  if ("gt" in op) return (value as number) > (op.gt as number);
  if ("gte" in op) return (value as number) >= (op.gte as number);
  if ("lt" in op) return (value as number) < (op.lt as number);
  if ("lte" in op) return (value as number) <= (op.lte as number);
  if ("truthy" in op) return op.truthy ? !!value : !value;
  if ("regex" in op) return new RegExp(op.regex as string).test(String(value ?? ""));
  return false;
}

function isOperatorObject(v: unknown): boolean {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v as object);
  if (keys.length !== 1) return false;
  return ["eq", "neq", "in", "nin", "gt", "gte", "lt", "lte", "truthy", "regex"].includes(keys[0]);
}
```

- [ ] **步骤 3：提交**

```bash
git add app/utils/plugin-condition.ts package.json bun.lock
git commit -m "feat(plugin-admin): add sortablejs and frontend condition evaluator"
```

---

## 任务 2：SortableList component

**文件：**
- 新建：`app/components/admin/SortableList.vue`

- [ ] **步骤 1：实现 SortableList**

通用 SortableJS 封装 component。在 `onMounted` 时对容器元素初始化 Sortable，在拖拽结束时 emit 重排后的数组。

```vue
<script setup lang="ts">
import Sortable from "sortablejs";

const props = defineProps<{
  modelValue: unknown[];
  options?: Sortable.Options;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: unknown[]];
}>();

const containerRef = useTemplateRef<HTMLElement>("containerRef");
let sortable: Sortable | null = null;

onMounted(() => {
  if (!containerRef.value) return;
  sortable = Sortable.create(containerRef.value, {
    animation: 150,
    ...props.options,
    onEnd: (evt) => {
      if (evt.oldIndex === undefined || evt.newIndex === undefined) return;
      const newList = [...props.modelValue];
      const [moved] = newList.splice(evt.oldIndex, 1);
      newList.splice(evt.newIndex, 0, moved);
      emit("update:modelValue", newList);
    },
  });
});

onBeforeUnmount(() => {
  sortable?.destroy();
});
</script>

<template>
  <div ref="containerRef">
    <slot />
  </div>
</template>
```

- [ ] **步骤 2：提交**

```bash
git add app/components/admin/SortableList.vue
git commit -m "feat(plugin-admin): add SortableList component wrapping SortableJS"
```

---

## 任务 3：页面入口 + 权限守卫

**文件：**
- 新建：`app/pages/admin/plugins.vue`

- [ ] **步骤 1：创建页面，包含权限守卫和主从布局骨架**

```vue
<script setup lang="ts">
const { data: user } = useUser();
const router = useRouter();

// 权限守卫：非管理员重定向到首页
watch(
  () => user.value,
  (u) => {
    if (!u || !u.isAdmin) router.replace("/");
  },
  { immediate: true },
);

// 插件列表数据
const plugins = ref<any[]>([]);
const loading = ref(true);
const loadError = ref("");
const selectedId = ref<string | null>(null);
const settingsRef = useTemplateRef<{ open: () => void }>("settingsRef");

async function fetchPlugins() {
  loading.value = true;
  loadError.value = "";
  try {
    plugins.value = await $fetch<any[]>("/api/admin/plugins");
    // 如果未选中任何插件，自动选中第一个
    if (!selectedId.value && plugins.value.length > 0) {
      selectedId.value = plugins.value[0].id;
    }
  } catch (err: any) {
    loadError.value = err?.data?.message ?? "加载失败";
  } finally {
    loading.value = false;
  }
}

onMounted(fetchPlugins);

const selectedPlugin = computed(() =>
  plugins.value.find((p) => p.id === selectedId.value) ?? null,
);

async function handleOrderUpdate(newList: any[]) {
  plugins.value = newList;
  const order = newList.map((p) => p.id);
  await $fetch("/api/admin/plugins/order", { method: "PUT", body: { order } });
}

async function handlePluginAction() {
  // 启用/禁用/配置变更后刷新列表
  await fetchPlugins();
}
</script>

<template>
  <div v-if="user?.isAdmin" class="flex gap-0 mx-4 my-6" style="min-height: calc(100dvh - 200px)">
    <!-- 左面板 -->
    <div class="w-[300px] shrink-0 border border-base-300 bg-base-200 flex flex-col">
      <PluginHostStatus class="p-3 border-b border-base-300" />
      <div class="flex-1 overflow-y-auto">
        <PluginList
          v-if="!loading"
          v-model="plugins"
          :selected-id="selectedId"
          @select="selectedId = $event"
          @update:model-value="handleOrderUpdate"
        />
        <div v-else class="flex justify-center p-6">
          <span class="loading loading-spinner loading-md" />
        </div>
      </div>
      <div class="p-3 border-t border-base-300">
        <button class="btn btn-sm btn-ghost w-full justify-start gap-2" @click="settingsRef?.open()">
          <Icon name="hugeicons:settings-02" class="text-base" />
          系统设置
        </button>
      </div>
    </div>

    <!-- 右面板 -->
    <div class="flex-1 border border-l-0 border-base-300 bg-base-200">
      <PluginDetail
        v-if="selectedPlugin"
        :plugin-id="selectedPlugin.id"
        @action="handlePluginAction"
      />
      <div v-else class="flex items-center justify-center h-full text-base-content/40">
        选择一个插件查看详情
      </div>
    </div>
  </div>

  <!-- 系统设置弹窗 -->
  <ClientOnly>
    <PluginSystemSettingsModal ref="settingsRef" />
  </ClientOnly>
</template>
```

- [ ] **步骤 2：提交**

```bash
git add app/pages/admin/plugins.vue
git commit -m "feat(plugin-admin): add plugins page with auth guard and master-detail layout"
```

---

## 任务 4：PluginHostStatus component

**文件：**
- 新建：`app/components/admin/PluginHostStatus.vue`

- [ ] **步骤 1：实现 Host 状态展示**

在挂载时通过 `GET /api/admin/plugins/host/status` 获取数据。显示状态徽标（running=绿色, dirty=警告, crashed=错误, stopped=中性）。当状态为 dirty 时，列出原因并显示重启按钮。

```vue
<script setup lang="ts">
const status = ref<string>("stopped");
const dirtyReasons = ref<any[]>([]);
const restarting = ref(false);

async function fetchStatus() {
  try {
    const data = await $fetch<{ status: string; dirtyReasons: any[] }>("/api/admin/plugins/host/status");
    status.value = data.status;
    dirtyReasons.value = data.dirtyReasons;
  } catch {}
}

onMounted(fetchStatus);

// 定时刷新
const interval = setInterval(fetchStatus, 5000);
onBeforeUnmount(() => clearInterval(interval));

async function restartHost() {
  restarting.value = true;
  try {
    await $fetch("/api/admin/plugins/host/restart", { method: "POST" });
    await fetchStatus();
  } catch {} finally {
    restarting.value = false;
  }
}

const statusColor = computed(() => {
  switch (status.value) {
    case "running": return "badge-success";
    case "dirty": return "badge-warning";
    case "crashed": return "badge-error";
    default: return "badge-neutral";
  }
});

const statusLabel = computed(() => {
  switch (status.value) {
    case "running": return "运行中";
    case "dirty": return "待重启";
    case "crashed": return "已崩溃";
    default: return "已停止";
  }
});

const reasonLabel = (reason: string) => {
  switch (reason) {
    case "disabled": return "已禁用";
    case "file_changed": return "文件已变更";
    case "config_restart": return "配置需重启";
    case "deleted": return "已删除";
    default: return reason;
  }
};
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-xs font-semibold">Plugin Host</span>
        <span class="badge badge-xs" :class="statusColor">{{ statusLabel }}</span>
      </div>
      <button
        v-if="status === 'dirty' || status === 'crashed'"
        class="btn btn-xs btn-warning"
        :disabled="restarting"
        @click="restartHost"
      >
        <span v-if="restarting" class="loading loading-spinner loading-xs" />
        <Icon v-else name="hugeicons:refresh" class="text-sm" />
        重启
      </button>
    </div>
    <div v-if="dirtyReasons.length > 0" class="mt-1.5 space-y-0.5">
      <div
        v-for="r in dirtyReasons"
        :key="r.pluginId + r.reason"
        class="text-xs text-warning"
      >
        · {{ r.pluginId }}（{{ reasonLabel(r.reason) }}）
      </div>
    </div>
  </div>
</template>
```

- [ ] **步骤 2：提交**

```bash
git add app/components/admin/PluginHostStatus.vue
git commit -m "feat(plugin-admin): add PluginHostStatus component with polling and restart"
```

---

## 任务 5：PluginList component

**文件：**
- 新建：`app/components/admin/PluginList.vue`

- [ ] **步骤 1：实现可排序的插件列表**

使用 `SortableList` 实现拖拽排序。每个条目显示名称、版本、状态徽标。点击选中。

```vue
<script setup lang="ts">
const props = defineProps<{
  modelValue: any[];
  selectedId: string | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: any[]];
  select: [id: string];
}>();

const statusBadge = (status: string) => {
  switch (status) {
    case "enabled": return { class: "badge-success", label: "已启用" };
    case "disabled": return { class: "badge-neutral", label: "已禁用" };
    case "error": return { class: "badge-error", label: "错误" };
    case "loading": return { class: "badge-info", label: "加载中" };
    default: return { class: "badge-neutral", label: status };
  }
};
</script>

<template>
  <div v-if="modelValue.length === 0" class="p-4 text-sm text-base-content/40 text-center">
    未发现插件
  </div>
  <SortableList
    v-else
    :model-value="modelValue"
    :options="{ handle: '.drag-handle', ghostClass: 'opacity-30' }"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div
      v-for="plugin in modelValue"
      :key="plugin.id"
      class="flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-base-300 transition-colors"
      :class="selectedId === plugin.id ? 'bg-primary/10' : 'hover:bg-base-300/50'"
      @click="emit('select', plugin.id)"
    >
      <Icon name="hugeicons:drag-drop" class="drag-handle text-base-content/30 cursor-grab text-sm shrink-0" />
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium truncate">{{ plugin.name }}</div>
        <div class="text-xs text-base-content/50">v{{ plugin.version }}</div>
      </div>
      <span class="badge badge-xs" :class="statusBadge(plugin.status).class">
        {{ statusBadge(plugin.status).label }}
      </span>
    </div>
  </SortableList>
</template>
```

- [ ] **步骤 2：提交**

```bash
git add app/components/admin/PluginList.vue
git commit -m "feat(plugin-admin): add PluginList component with drag-to-reorder"
```

---

## 任务 6：PluginDetail + PluginInfoTab

**文件：**
- 新建：`app/components/admin/PluginDetail.vue`
- 新建：`app/components/admin/PluginInfoTab.vue`

- [ ] **步骤 1：实现 PluginDetail（带标签页的容器）**

通过 `GET /api/admin/plugins/:id` 获取插件详情。渲染标题栏和启用/禁用按钮。标签栏在配置/日志/信息之间切换。使用 `v-show` 渲染标签页内容（与 `AdminPanelModal` 相同的模式）。

```vue
<script setup lang="ts">
const props = defineProps<{ pluginId: string }>();
const emit = defineEmits<{ action: [] }>();

const plugin = ref<any>(null);
const loading = ref(true);
const error = ref("");
const activeTab = ref<"config" | "logs" | "info">("config");
const toggling = ref(false);

async function fetchDetail() {
  loading.value = true;
  error.value = "";
  try {
    plugin.value = await $fetch<any>(`/api/admin/plugins/${props.pluginId}`);
  } catch (err: any) {
    error.value = err?.data?.message ?? "加载失败";
  } finally {
    loading.value = false;
  }
}

watch(() => props.pluginId, () => {
  activeTab.value = "config";
  fetchDetail();
}, { immediate: true });

async function toggleEnabled() {
  if (!plugin.value) return;
  toggling.value = true;
  try {
    const action = plugin.value.status === "enabled" ? "disable" : "enable";
    await $fetch(`/api/admin/plugins/${props.pluginId}/${action}`, { method: "POST" });
    await fetchDetail();
    emit("action");
  } catch {} finally {
    toggling.value = false;
  }
}
</script>

<template>
  <div v-if="loading" class="flex justify-center p-10">
    <span class="loading loading-spinner loading-md" />
  </div>
  <div v-else-if="error" class="p-5">
    <div role="alert" class="alert alert-error alert-soft">
      <span>{{ error }}</span>
    </div>
  </div>
  <div v-else-if="plugin" class="flex flex-col h-full">
    <!-- 标题栏 -->
    <div class="flex items-center justify-between p-4 border-b border-base-300">
      <div>
        <h3 class="text-lg font-bold">{{ plugin.name }}</h3>
        <span class="text-xs text-base-content/50">v{{ plugin.version }}</span>
      </div>
      <button
        class="btn btn-sm"
        :class="plugin.status === 'enabled' ? 'btn-warning' : 'btn-success'"
        :disabled="toggling || plugin.status === 'error'"
        @click="toggleEnabled"
      >
        <span v-if="toggling" class="loading loading-spinner loading-xs" />
        {{ plugin.status === "enabled" ? "禁用" : "启用" }}
      </button>
    </div>

    <!-- 错误展示 -->
    <div v-if="plugin.error" class="px-4 pt-3">
      <div role="alert" class="alert alert-error alert-soft text-sm">
        <span>{{ plugin.error }}</span>
      </div>
    </div>

    <!-- 标签栏 -->
    <div class="px-4 pt-3">
      <div class="join w-full">
        <button
          class="btn btn-sm join-item flex-1"
          :class="activeTab === 'config' ? 'btn-active' : ''"
          @click="activeTab = 'config'"
        >配置</button>
        <button
          class="btn btn-sm join-item flex-1"
          :class="activeTab === 'logs' ? 'btn-active' : ''"
          @click="activeTab = 'logs'"
        >日志</button>
        <button
          class="btn btn-sm join-item flex-1"
          :class="activeTab === 'info' ? 'btn-active' : ''"
          @click="activeTab = 'info'"
        >信息</button>
      </div>
    </div>

    <!-- 标签页内容 -->
    <div class="flex-1 overflow-y-auto p-4">
      <PluginConfigTab
        v-show="activeTab === 'config'"
        :plugin-id="plugin.id"
        :config-schema="plugin.configSchema"
        :config="plugin.config"
        @saved="fetchDetail(); emit('action')"
      />
      <PluginLogTab
        v-show="activeTab === 'logs'"
        :plugin-id="plugin.id"
        :active="activeTab === 'logs'"
      />
      <PluginInfoTab
        v-show="activeTab === 'info'"
        :plugin="plugin"
      />
    </div>
  </div>
</template>
```

- [ ] **步骤 2：实现 PluginInfoTab**

简单的元数据展示。

```vue
<script setup lang="ts">
defineProps<{ plugin: any }>();
</script>

<template>
  <div class="space-y-3">
    <div v-if="plugin.description">
      <div class="text-xs text-base-content/50 mb-1">描述</div>
      <div class="text-sm">{{ plugin.description }}</div>
    </div>
    <div v-if="plugin.author">
      <div class="text-xs text-base-content/50 mb-1">作者</div>
      <div class="text-sm">{{ plugin.author }}</div>
    </div>
    <div>
      <div class="text-xs text-base-content/50 mb-1">版本</div>
      <div class="text-sm">{{ plugin.version }}</div>
    </div>
    <div>
      <div class="text-xs text-base-content/50 mb-1">Hooks</div>
      <div class="flex flex-wrap gap-1">
        <span v-for="hook in plugin.hooks" :key="hook" class="badge badge-sm badge-outline">
          {{ hook }}
        </span>
      </div>
    </div>
    <div>
      <div class="text-xs text-base-content/50 mb-1">状态</div>
      <div class="text-sm">{{ plugin.status }}</div>
    </div>
    <div>
      <div class="text-xs text-base-content/50 mb-1">插件目录</div>
      <div class="text-sm font-mono text-base-content/70 break-all">{{ plugin.id }}</div>
    </div>
  </div>
</template>
```

- [ ] **步骤 3：提交**

```bash
git add app/components/admin/PluginDetail.vue app/components/admin/PluginInfoTab.vue
git commit -m "feat(plugin-admin): add PluginDetail container and PluginInfoTab"
```

---

## 任务 7：PluginConfigTab — 动态配置表单

**文件：**
- 新建：`app/components/admin/PluginConfigTab.vue`

- [ ] **步骤 1：实现动态配置表单**

这是最复杂的 component。它根据 `configSchema` 动态渲染表单，实时求值条件，并处理保存和逐字段错误展示。

```vue
<script setup lang="ts">
const props = defineProps<{
  pluginId: string;
  configSchema: any[];
  config: Record<string, unknown>;
}>();

const emit = defineEmits<{ saved: [] }>();

// 表单状态 — 从 config prop 初始化
const formData = ref<Record<string, unknown>>({});
const snapshot = ref<Record<string, unknown>>({});
const saving = ref(false);
const errors = ref<Record<string, string>>({});

// 从 config 初始化表单数据，对缺失字段应用默认值
function resolveDefault(field: any, currentData: Record<string, unknown>): unknown {
  // default_when 优先于静态 default
  if (field.default_when) {
    for (const cond of field.default_when) {
      if (evaluateCondition(cond.when, currentData)) return cond.value;
    }
  }
  return field.default ?? (field.type === "boolean" ? false : "");
}

function initForm() {
  const data: Record<string, unknown> = {};
  // 第一遍：使用配置值或静态默认值填充
  for (const field of props.configSchema) {
    data[field.key] = props.config[field.key] ?? resolveDefault(field, data);
  }
  formData.value = { ...data };
  snapshot.value = { ...data };
  errors.value = {};
}

watch(() => props.pluginId, initForm, { immediate: true });

// 按 group 属性分组字段
const groupedFields = computed(() => {
  const groups = new Map<string, any[]>();
  for (const field of props.configSchema) {
    const group = field.group ?? "";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(field);
  }
  return [...groups.entries()];
});

// 条件求值辅助函数
function isVisible(field: any): boolean {
  if (!field.visible_when) return true;
  return evaluateCondition(field.visible_when, formData.value as Record<string, unknown>);
}

function isDisabled(field: any): boolean {
  if (field.disabled) return true;
  if (!field.disabled_when) return false;
  return evaluateCondition(field.disabled_when, formData.value as Record<string, unknown>);
}

function isRequired(field: any): boolean {
  if (field.required) return true;
  if (!field.required_when) return false;
  return evaluateCondition(field.required_when, formData.value as Record<string, unknown>);
}

function getOptions(field: any): { label: string; value: unknown }[] {
  if (field.options_when) {
    for (const cond of field.options_when) {
      if (evaluateCondition(cond.when, formData.value as Record<string, unknown>)) {
        return cond.options;
      }
    }
  }
  return field.options ?? [];
}

// 脏检查
const dirty = computed(() => {
  for (const field of props.configSchema) {
    if (formData.value[field.key] !== snapshot.value[field.key]) return true;
  }
  return false;
});

// 保存
async function save() {
  saving.value = true;
  errors.value = {};
  try {
    // 跳过值仍为 "****" 的密码字段（未修改）
    const body: Record<string, unknown> = {};
    for (const field of props.configSchema) {
      const val = formData.value[field.key];
      if (field.type === "password" && val === "****") continue;
      body[field.key] = val;
    }
    await $fetch(`/api/admin/plugins/${props.pluginId}/config`, {
      method: "PUT",
      body,
    });
    snapshot.value = { ...formData.value };
    emit("saved");
  } catch (err: any) {
    if (err?.data?.data) {
      errors.value = err.data.data;
    } else {
      errors.value = { _general: err?.data?.message ?? "保存失败" };
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="configSchema.length === 0" class="text-sm text-base-content/40 text-center py-8">
    此插件没有可配置项
  </div>
  <div v-else>
    <template v-for="([group, fields], gi) in groupedFields" :key="group">
      <div v-if="gi > 0" class="divider my-0" />
      <div class="py-4">
        <h4 v-if="group" class="flex items-center gap-1.5 text-sm font-semibold text-primary mb-3">
          {{ group }}
        </h4>
        <div class="grid grid-cols-2 gap-3">
          <template v-for="field in fields" :key="field.key">
            <div v-if="isVisible(field)" :class="field.type === 'textarea' ? 'col-span-2' : ''">
              <!-- 布尔值：复选框 -->
              <label v-if="field.type === 'boolean'" class="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  v-model="formData[field.key]"
                  type="checkbox"
                  class="checkbox checkbox-sm"
                  :disabled="isDisabled(field)"
                />
                {{ field.label }}
                <Icon v-if="field.restart" name="hugeicons:refresh" class="text-warning text-xs" title="修改此项需要重启 Plugin Host" />
              </label>

              <!-- 下拉选择 -->
              <fieldset v-else-if="field.type === 'select'" class="fieldset">
                <legend class="fieldset-legend text-xs">
                  {{ field.label }}
                  <span v-if="isRequired(field)" class="text-error">*</span>
                  <Icon v-if="field.restart" name="hugeicons:refresh" class="text-warning text-xs" title="修改此项需要重启 Plugin Host" />
                </legend>
                <select v-model="formData[field.key]" class="select select-bordered w-full" :disabled="isDisabled(field)">
                  <option v-for="opt in getOptions(field)" :key="String(opt.value)" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
                <p v-if="errors[field.key]" class="text-xs text-error mt-1">{{ errors[field.key] }}</p>
              </fieldset>

              <!-- 多行文本 -->
              <fieldset v-else-if="field.type === 'textarea'" class="fieldset">
                <legend class="fieldset-legend text-xs">
                  {{ field.label }}
                  <span v-if="isRequired(field)" class="text-error">*</span>
                </legend>
                <textarea
                  v-model="formData[field.key]"
                  class="textarea textarea-bordered w-full"
                  :placeholder="field.description ?? ''"
                  :disabled="isDisabled(field)"
                  rows="3"
                />
                <p v-if="errors[field.key]" class="text-xs text-error mt-1">{{ errors[field.key] }}</p>
              </fieldset>

              <!-- 数字 -->
              <fieldset v-else-if="field.type === 'number'" class="fieldset">
                <legend class="fieldset-legend text-xs">
                  {{ field.label }}
                  <span v-if="isRequired(field)" class="text-error">*</span>
                  <Icon v-if="field.restart" name="hugeicons:refresh" class="text-warning text-xs" title="修改此项需要重启 Plugin Host" />
                </legend>
                <input
                  v-model.number="formData[field.key]"
                  type="number"
                  class="input input-bordered w-full"
                  :placeholder="field.description ?? ''"
                  :disabled="isDisabled(field)"
                />
                <p v-if="errors[field.key]" class="text-xs text-error mt-1">{{ errors[field.key] }}</p>
              </fieldset>

              <!-- 文本 / 密码 -->
              <fieldset v-else class="fieldset">
                <legend class="fieldset-legend text-xs">
                  {{ field.label }}
                  <span v-if="isRequired(field)" class="text-error">*</span>
                  <Icon v-if="field.restart" name="hugeicons:refresh" class="text-warning text-xs" title="修改此项需要重启 Plugin Host" />
                </legend>
                <input
                  v-model="formData[field.key]"
                  :type="field.type === 'password' ? 'password' : 'text'"
                  class="input input-bordered w-full"
                  :placeholder="field.description ?? ''"
                  :disabled="isDisabled(field)"
                />
                <p v-if="errors[field.key]" class="text-xs text-error mt-1">{{ errors[field.key] }}</p>
              </fieldset>
            </div>
          </template>
        </div>
      </div>
    </template>

    <div v-if="errors._general" role="alert" class="alert alert-error alert-soft mt-2">
      <span>{{ errors._general }}</span>
    </div>

    <div class="mt-3 flex justify-end">
      <button class="btn btn-primary btn-sm" :disabled="!dirty || saving" @click="save">
        <span v-if="saving" class="loading loading-spinner loading-xs" />
        保存
      </button>
    </div>
  </div>
</template>
```

关键实现细节：
- `evaluateCondition` 从 `app/utils/plugin-condition.ts`（任务 1）自动导入
- 值为 `"****"` 的密码字段在保存时跳过（仅发送已修改的密码）
- 服务端验证错误（`err.data.data`）映射到逐字段的 `errors` 对象，并在每个字段下方内联渲染
- 数字类型输入上的 v-model 正常工作，因为 Vue 通过底层 input 的 `.number` 修饰符自动转换类型
- 没有 `group` 的字段渲染在默认的未命名分组中

- [ ] **步骤 2：提交**

```bash
git add app/components/admin/PluginConfigTab.vue
git commit -m "feat(plugin-admin): add PluginConfigTab with dynamic form rendering and conditions"
```

---

## 任务 8：PluginLogTab — 实时日志查看器

**文件：**
- 新建：`app/components/admin/PluginLogTab.vue`

- [ ] **步骤 1：实现带 SSE + 历史记录的日志查看器**

关键行为：
- 挂载时（当 `active` 变为 true 时）：连接 SSE + 加载初始历史记录
- 通过 `new EventSource('/api/admin/plugins/:id/logs/stream?level=&type=')` 建立 SSE
- 新日志条目追加到列表底部
- 用户在底部时自动滚动到最新
- 滚动到顶部触发历史加载（`GET .../logs/history?before=cursor&limit=50`）
- 级别和类型过滤下拉框 — 更改时重新连接 SSE 并重新加载历史
- 清空日志按钮 + 下载按钮
- 卸载时或 `active` 变为 false 时：关闭 EventSource

日志条目渲染：
- 时间戳使用 `HH:mm:ss.SSS` 格式（悬停时通过 `title` 显示完整 ISO 格式）
- 级别徽标（info=`badge-info`, warn=`badge-warning`, error=`badge-error`, debug=`badge-neutral`）
- 类型标签（event/console）小号文字
- 消息文本
- 数据作为可展开的 `<pre>` 块（如有）

```vue
<script setup lang="ts">
const props = defineProps<{
  pluginId: string;
  active: boolean;
}>();

const logs = ref<any[]>([]);
const levelFilter = ref("");
const typeFilter = ref("");
const loadingHistory = ref(false);
const hasMore = ref(true);
let eventSource: EventSource | null = null;
const logContainerRef = useTemplateRef<HTMLElement>("logContainerRef");

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
}

function disconnectSSE() {
  eventSource?.close();
  eventSource = null;
}

async function loadHistory(before?: string) {
  if (loadingHistory.value || !hasMore.value) return;
  loadingHistory.value = true;
  try {
    const params = new URLSearchParams({ limit: "50" });
    if (before) params.set("before", before);
    if (levelFilter.value) params.set("level", levelFilter.value);
    if (typeFilter.value) params.set("type", typeFilter.value);
    const data = await $fetch<any>(`/api/admin/plugins/${props.pluginId}/logs/history?${params}`);
    logs.value.unshift(...data.logs);
    hasMore.value = data.hasMore;
  } catch {} finally {
    loadingHistory.value = false;
  }
}

function handleScroll() {
  const el = logContainerRef.value;
  if (!el) return;
  if (el.scrollTop === 0 && hasMore.value) {
    const oldestTimestamp = logs.value[0]?.timestamp;
    loadHistory(oldestTimestamp);
  }
}

function scrollToBottomIfNeeded() {
  const el = logContainerRef.value;
  if (!el) return;
  const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  if (isAtBottom) el.scrollTop = el.scrollHeight;
}

function resetAndReload() {
  logs.value = [];
  hasMore.value = true;
  loadHistory();
  connectSSE();
}

watch(() => props.active, (active) => {
  if (active) resetAndReload();
  else disconnectSSE();
});

watch([levelFilter, typeFilter], () => {
  if (props.active) resetAndReload();
});

watch(() => props.pluginId, () => {
  if (props.active) resetAndReload();
});

onMounted(() => { if (props.active) resetAndReload(); });
onBeforeUnmount(disconnectSSE);

const clearing = ref(false);
async function clearLogs() {
  if (!confirm("确定清空所有日志？")) return;
  clearing.value = true;
  try {
    await $fetch(`/api/admin/plugins/${props.pluginId}/logs`, { method: "DELETE" });
    logs.value = [];
  } catch {} finally {
    clearing.value = false;
  }
}

function downloadLogs() {
  const date = new Date().toISOString().slice(0, 10);
  window.open(`/api/admin/plugins/${props.pluginId}/logs/download?date=${date}`, "_blank");
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
}

const levelBadge = (level: string) => {
  switch (level) {
    case "info": return "badge-info";
    case "warn": return "badge-warning";
    case "error": return "badge-error";
    case "debug": return "badge-neutral";
    default: return "badge-neutral";
  }
};
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 工具栏 -->
    <div class="flex items-center gap-2 mb-3">
      <select v-model="levelFilter" class="select select-bordered select-xs">
        <option value="">全部级别</option>
        <option value="info">info</option>
        <option value="warn">warn</option>
        <option value="error">error</option>
        <option value="debug">debug</option>
      </select>
      <select v-model="typeFilter" class="select select-bordered select-xs">
        <option value="">全部类型</option>
        <option value="event">event</option>
        <option value="console">console</option>
      </select>
      <div class="flex-1" />
      <button class="btn btn-xs btn-ghost" :disabled="clearing" @click="clearLogs">
        <Icon name="hugeicons:delete-02" class="text-sm" />
        清空
      </button>
      <button class="btn btn-xs btn-ghost" @click="downloadLogs">
        <Icon name="hugeicons:download-04" class="text-sm" />
        下载
      </button>
    </div>

    <!-- 日志容器 -->
    <div
      ref="logContainerRef"
      class="flex-1 overflow-y-auto border border-base-300 bg-base-100 font-mono text-xs"
      style="min-height: 300px; max-height: calc(100dvh - 400px)"
      @scroll="handleScroll"
    >
      <div v-if="loadingHistory" class="flex justify-center py-2">
        <span class="loading loading-spinner loading-xs" />
      </div>
      <div v-if="logs.length === 0 && !loadingHistory" class="flex items-center justify-center h-full text-base-content/30">
        暂无日志
      </div>
      <div v-for="(entry, i) in logs" :key="i" class="px-2 py-0.5 border-b border-base-200 hover:bg-base-200/50">
        <div class="flex gap-2">
          <span class="text-base-content/40 shrink-0" :title="entry.timestamp">{{ formatTime(entry.timestamp) }}</span>
          <span class="badge badge-xs shrink-0" :class="levelBadge(entry.level)">{{ entry.level }}</span>
          <span class="text-base-content/30 shrink-0">{{ entry.type }}</span>
          <span class="flex-1 break-all">{{ entry.message }}</span>
        </div>
        <details v-if="entry.data && Object.keys(entry.data).length > 0" class="ml-20 mt-0.5">
          <summary class="text-base-content/30 cursor-pointer text-[10px]">data</summary>
          <pre class="text-[10px] text-base-content/50 whitespace-pre-wrap break-all mt-0.5">{{ JSON.stringify(entry.data, null, 2) }}</pre>
        </details>
      </div>
    </div>
  </div>
</template>
```

- [ ] **步骤 2：提交**

```bash
git add app/components/admin/PluginLogTab.vue
git commit -m "feat(plugin-admin): add PluginLogTab with SSE streaming and history scroll-back"
```

---

## 任务 9：PluginSystemSettingsModal

**文件：**
- 新建：`app/components/admin/PluginSystemSettingsModal.vue`

- [ ] **步骤 1：实现系统设置弹窗**

标准 DaisyUI dialog 弹窗。通过 `GET /api/admin/plugins/settings` 获取数据，允许编辑 watcher/logBufferSize/logRetentionDays，通过 `PUT` 保存。

遵循现有弹窗模式：
- `useTemplateRef<HTMLDialogElement>("dialogRef")`
- `defineExpose({ open })`
- `<Teleport to="body">`
- 使用 `hugeicons:cancel-01` 图标的关闭按钮
- 使用 `fieldset`/`fieldset-legend` 模式的表单
- 保存按钮右对齐

```vue
<script setup lang="ts">
const dialogRef = useTemplateRef<HTMLDialogElement>("dialogRef");
const watcher = ref(true);
const logBufferSize = ref(200);
const logRetentionDays = ref(7);
const saving = ref(false);
const error = ref("");
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const data = await $fetch<any>("/api/admin/plugins/settings");
    watcher.value = data.watcher;
    logBufferSize.value = data.logBufferSize;
    logRetentionDays.value = data.logRetentionDays;
  } catch {} finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  error.value = "";
  try {
    await $fetch("/api/admin/plugins/settings", {
      method: "PUT",
      body: {
        watcher: watcher.value,
        logBufferSize: logBufferSize.value,
        logRetentionDays: logRetentionDays.value,
      },
    });
    dialogRef.value?.close();
  } catch (err: any) {
    error.value = err?.data?.message ?? "保存失败";
  } finally {
    saving.value = false;
  }
}

function open() {
  load();
  dialogRef.value?.showModal();
}

defineExpose({ open });
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialogRef" class="modal modal-bottom sm:modal-middle">
      <div class="modal-box sm:max-w-[480px]">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-bold">插件系统设置</h3>
          <form method="dialog">
            <button class="btn btn-ghost btn-sm">
              <Icon name="hugeicons:cancel-01" class="text-xl opacity-40" />
            </button>
          </form>
        </div>

        <div v-if="loading" class="flex justify-center py-8">
          <span class="loading loading-spinner loading-md" />
        </div>
        <div v-else class="mt-4 space-y-4">
          <label class="flex cursor-pointer items-center gap-2 text-sm">
            <input v-model="watcher" type="checkbox" class="checkbox checkbox-sm" />
            文件监听（自动发现新插件和变更）
          </label>

          <fieldset class="fieldset">
            <legend class="fieldset-legend text-xs">内存日志缓冲条数</legend>
            <input v-model.number="logBufferSize" type="number" class="input input-bordered w-full" min="10" max="10000" />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend text-xs">日志文件保留天数</legend>
            <input v-model.number="logRetentionDays" type="number" class="input input-bordered w-full" min="1" max="365" />
          </fieldset>

          <div v-if="error" role="alert" class="alert alert-error alert-soft">
            <span>{{ error }}</span>
          </div>

          <div class="flex justify-end">
            <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
              <span v-if="saving" class="loading loading-spinner loading-xs" />
              保存
            </button>
          </div>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  </Teleport>
</template>
```

- [ ] **步骤 2：验证连接**

设置按钮和 `<ClientOnly><PluginSystemSettingsModal ref="settingsRef" /></ClientOnly>` 已在任务 3 的页面模板中。验证它们正确引用了此 component。

- [ ] **步骤 3：提交**

```bash
git add app/components/admin/PluginSystemSettingsModal.vue app/pages/admin/plugins.vue
git commit -m "feat(plugin-admin): add PluginSystemSettingsModal and wire into page"
```

---

## 任务 10：集成 + 完善

**文件：**
- 修改：`app/pages/admin/plugins.vue`（最终确认）

- [ ] **步骤 1：验证所有 component 正确集成**

确保页面正确渲染：
- 左面板：HostStatus + 可排序 PluginList + 设置按钮
- 右面板：PluginDetail 三个标签页均正常工作
- 权限守卫正确重定向非管理员用户

- [ ] **步骤 2：添加导航链接**

在管理员可访问的位置添加到 `/admin/plugins` 的链接。可选方案：
- 在 `AdminPanelModal.vue` 中添加指向插件页面的按钮（例如 "插件管理 ->"）
- 或在 `ShortcutCard.vue` 中管理面板按钮旁添加链接

在 `AdminPanelModal.vue` 中添加 NuxtLink 作为第三个标签页或醒目链接：

```html
<NuxtLink to="/admin/plugins" class="btn btn-sm btn-ghost gap-1" @click="dialogRef?.close()">
  <Icon name="hugeicons:plug-01" class="text-base" />
  插件管理
  <Icon name="hugeicons:arrow-right-01" class="text-sm" />
</NuxtLink>
```

- [ ] **步骤 3：最终提交**

```bash
git add -A
git commit -m "feat(plugin-admin): finalize plugin admin page with navigation"
```

---

## 总结

| 任务 | component | 描述 |
|------|-----------|------|
| 1 | 初始设置 | SortableJS 依赖 + 前端条件求值器 |
| 2 | SortableList | 通用 SortableJS 封装 component |
| 3 | 页面入口 | `/admin/plugins` 页面，带权限守卫和布局 |
| 4 | HostStatus | Plugin Host 状态徽标 + 重启 |
| 5 | PluginList | 可排序的插件列表，带状态徽标 |
| 6 | Detail + Info | 右面板容器，带标签页 + 信息标签页 |
| 7 | ConfigTab | 带条件求值的动态配置表单 |
| 8 | LogTab | SSE 实时日志 + 历史回滚 |
| 9 | 设置弹窗 | 系统设置弹窗 |
| 10 | 集成 | 整合所有部分 + 导航链接 |

**共计：10 个任务**，每个可独立提交。
