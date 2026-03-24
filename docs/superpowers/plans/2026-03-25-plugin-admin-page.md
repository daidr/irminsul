# Plugin Admin Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/admin/plugins` page with left-right master-detail layout for managing plugins, their configuration, and viewing logs.

**Architecture:** Standalone Nuxt page at `app/pages/admin/plugins.vue` with 8 child components under `app/components/admin/`. Left panel: sortable plugin list + Host status. Right panel: tab-switched detail view (config/logs/info). SortableJS for drag reorder. SSE EventSource for real-time log streaming.

**Tech Stack:** Vue 3 Composition API, DaisyUI v5, Tailwind CSS v4, SortableJS, EventSource (SSE)

**Spec:** `docs/superpowers/specs/2026-03-25-plugin-admin-page-design.md`

---

## File Structure

### New Files

```
app/utils/plugin-condition.ts              — evaluateCondition() ported to frontend (no server type deps)
app/pages/admin/plugins.vue                — Page entry: auth guard, layout container, data fetching
app/components/admin/
  PluginList.vue                           — Left panel: sortable plugin list with status badges
  PluginHostStatus.vue                     — Host status badge + dirty reasons + restart button
  PluginDetail.vue                         — Right panel: title bar + enable/disable + tab switcher
  PluginConfigTab.vue                      — Dynamic config form from configSchema
  PluginLogTab.vue                         — SSE real-time logs + history scroll-back + filters
  PluginInfoTab.vue                        — Plugin metadata display
  PluginSystemSettingsModal.vue            — System settings modal (watcher, log buffer, retention)
  SortableList.vue                         — Generic SortableJS wrapper component
```

### New Dependencies

```
sortablejs
@types/sortablejs (devDependency)
```

---

## Task 1: Install SortableJS + Frontend Condition Evaluator

**Files:**
- Create: `app/utils/plugin-condition.ts`

- [ ] **Step 1: Install sortablejs**

```bash
bun add sortablejs && bun add -D @types/sortablejs
```

- [ ] **Step 2: Create frontend condition evaluator**

Port `server/utils/plugin/condition.ts` to `app/utils/plugin-condition.ts`. This file will be auto-imported by Nuxt in the frontend context. Remove the server type imports and use inline types:

```typescript
// Condition evaluator for plugin config form (frontend).
// Mirrors server/utils/plugin/condition.ts logic.

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

- [ ] **Step 3: Commit**

```bash
git add app/utils/plugin-condition.ts package.json bun.lock
git commit -m "feat(plugin-admin): add sortablejs and frontend condition evaluator"
```

---

## Task 2: SortableList Component

**Files:**
- Create: `app/components/admin/SortableList.vue`

- [ ] **Step 1: Implement SortableList**

Generic SortableJS wrapper component. Uses `onMounted` to initialize Sortable on the container element, emits reordered array on drag end.

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

- [ ] **Step 2: Commit**

```bash
git add app/components/admin/SortableList.vue
git commit -m "feat(plugin-admin): add SortableList component wrapping SortableJS"
```

---

## Task 3: Page Entry + Auth Guard

**Files:**
- Create: `app/pages/admin/plugins.vue`

- [ ] **Step 1: Create the page with auth guard and master-detail layout shell**

```vue
<script setup lang="ts">
const { data: user } = useUser();
const router = useRouter();

// Auth guard: redirect non-admins to home
watch(
  () => user.value,
  (u) => {
    if (!u || !u.isAdmin) router.replace("/");
  },
  { immediate: true },
);

// Plugin list data
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
    // Auto-select first plugin if none selected
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
  // Refresh list after enable/disable/config change
  await fetchPlugins();
}
</script>

<template>
  <div v-if="user?.isAdmin" class="flex gap-0 mx-4 my-6" style="min-height: calc(100dvh - 200px)">
    <!-- Left Panel -->
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

    <!-- Right Panel -->
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

  <!-- System Settings Modal -->
  <ClientOnly>
    <PluginSystemSettingsModal ref="settingsRef" />
  </ClientOnly>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add app/pages/admin/plugins.vue
git commit -m "feat(plugin-admin): add plugins page with auth guard and master-detail layout"
```

---

## Task 4: PluginHostStatus Component

**Files:**
- Create: `app/components/admin/PluginHostStatus.vue`

- [ ] **Step 1: Implement Host status display**

Fetches `GET /api/admin/plugins/host/status` on mount. Shows status badge (running=green, dirty=warning, crashed=error, stopped=neutral). When dirty, lists reasons and shows restart button.

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

// Refresh periodically
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

- [ ] **Step 2: Commit**

```bash
git add app/components/admin/PluginHostStatus.vue
git commit -m "feat(plugin-admin): add PluginHostStatus component with polling and restart"
```

---

## Task 5: PluginList Component

**Files:**
- Create: `app/components/admin/PluginList.vue`

- [ ] **Step 1: Implement sortable plugin list**

Uses `SortableList` for drag reorder. Each item shows name, version, status badge. Click selects.

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

- [ ] **Step 2: Commit**

```bash
git add app/components/admin/PluginList.vue
git commit -m "feat(plugin-admin): add PluginList component with drag-to-reorder"
```

---

## Task 6: PluginDetail + PluginInfoTab

**Files:**
- Create: `app/components/admin/PluginDetail.vue`
- Create: `app/components/admin/PluginInfoTab.vue`

- [ ] **Step 1: Implement PluginDetail (container with tabs)**

Fetches plugin detail via `GET /api/admin/plugins/:id`. Renders title bar with enable/disable button. Tab bar switches between config/logs/info. Uses `v-show` for tab content (same pattern as `AdminPanelModal`).

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
    <!-- Title bar -->
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

    <!-- Error display -->
    <div v-if="plugin.error" class="px-4 pt-3">
      <div role="alert" class="alert alert-error alert-soft text-sm">
        <span>{{ plugin.error }}</span>
      </div>
    </div>

    <!-- Tab bar -->
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

    <!-- Tab content -->
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

- [ ] **Step 2: Implement PluginInfoTab**

Simple metadata display.

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
  </div>
</template>
```

- [ ] **Step 3: Commit**

```bash
git add app/components/admin/PluginDetail.vue app/components/admin/PluginInfoTab.vue
git commit -m "feat(plugin-admin): add PluginDetail container and PluginInfoTab"
```

---

## Task 7: PluginConfigTab — Dynamic Config Form

**Files:**
- Create: `app/components/admin/PluginConfigTab.vue`

- [ ] **Step 1: Implement dynamic config form**

This is the most complex component. It dynamically renders a form from `configSchema`, evaluates conditions in real-time, and handles save with per-field error display.

```vue
<script setup lang="ts">
const props = defineProps<{
  pluginId: string;
  configSchema: any[];
  config: Record<string, unknown>;
}>();

const emit = defineEmits<{ saved: [] }>();

// Form state — initialized from config prop
const formData = ref<Record<string, unknown>>({});
const snapshot = ref<Record<string, unknown>>({});
const saving = ref(false);
const errors = ref<Record<string, string>>({});

// Initialize form data from config, applying defaults for missing fields
function resolveDefault(field: any, currentData: Record<string, unknown>): unknown {
  // default_when takes priority over static default
  if (field.default_when) {
    for (const cond of field.default_when) {
      if (evaluateCondition(cond.when, currentData)) return cond.value;
    }
  }
  return field.default ?? (field.type === "boolean" ? false : "");
}

function initForm() {
  const data: Record<string, unknown> = {};
  // First pass: populate with config values or static defaults
  for (const field of props.configSchema) {
    data[field.key] = props.config[field.key] ?? resolveDefault(field, data);
  }
  formData.value = { ...data };
  snapshot.value = { ...data };
  errors.value = {};
}

watch(() => props.pluginId, initForm, { immediate: true });

// Group fields by group property
const groupedFields = computed(() => {
  const groups = new Map<string, any[]>();
  for (const field of props.configSchema) {
    const group = field.group ?? "";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(field);
  }
  return [...groups.entries()];
});

// Condition evaluation helpers
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

// Dirty checking
const dirty = computed(() => {
  for (const field of props.configSchema) {
    if (formData.value[field.key] !== snapshot.value[field.key]) return true;
  }
  return false;
});

// Save
async function save() {
  saving.value = true;
  errors.value = {};
  try {
    // Don't send password fields that are still "****" (unchanged)
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
              <!-- Boolean: checkbox -->
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

              <!-- Select -->
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

              <!-- Textarea -->
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

              <!-- Text / Password / Number -->
              <fieldset v-else class="fieldset">
                <legend class="fieldset-legend text-xs">
                  {{ field.label }}
                  <span v-if="isRequired(field)" class="text-error">*</span>
                  <Icon v-if="field.restart" name="hugeicons:refresh" class="text-warning text-xs" title="修改此项需要重启 Plugin Host" />
                </legend>
                <input
                  v-model="formData[field.key]"
                  :type="field.type === 'number' ? 'number' : field.type === 'password' ? 'password' : 'text'"
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

Key implementation details:
- `evaluateCondition` is auto-imported from `app/utils/plugin-condition.ts` (Task 1)
- Password fields with value `"****"` are skipped in save body (only changed passwords are sent)
- Server validation errors (`err.data.data`) are mapped to per-field `errors` object and rendered inline below each field
- `v-model` with number type inputs works because Vue auto-coerces via `.number` modifier on the underlying input
- Fields without a `group` are rendered in a default unnamed group

- [ ] **Step 2: Commit**

```bash
git add app/components/admin/PluginConfigTab.vue
git commit -m "feat(plugin-admin): add PluginConfigTab with dynamic form rendering and conditions"
```

---

## Task 8: PluginLogTab — Real-time Log Viewer

**Files:**
- Create: `app/components/admin/PluginLogTab.vue`

- [ ] **Step 1: Implement log viewer with SSE + history**

Key behaviors:
- On mount (when `active` becomes true): connect SSE + load initial history
- SSE via `new EventSource('/api/admin/plugins/:id/logs/stream?level=&type=')`
- New log entries appended to bottom of list
- Auto-scroll to bottom when user is at bottom
- Scroll to top triggers history loading (`GET .../logs/history?before=cursor&limit=50`)
- Level and type filter dropdowns — changing reconnects SSE and reloads history
- Clear logs button + download button
- On unmount or `active` becomes false: close EventSource

Log entry rendering:
- Timestamp in `HH:mm:ss.SSS` format (full ISO on hover via `title`)
- Level badge (info=`badge-info`, warn=`badge-warning`, error=`badge-error`, debug=`badge-neutral`)
- Type tag (event/console) in small text
- Message text
- Data as expandable `<pre>` block (if present)

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
    <!-- Toolbar -->
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

    <!-- Log container -->
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
      <div v-for="(entry, i) in logs" :key="i" class="flex gap-2 px-2 py-0.5 border-b border-base-200 hover:bg-base-200/50">
        <span class="text-base-content/40 shrink-0" :title="entry.timestamp">{{ formatTime(entry.timestamp) }}</span>
        <span class="badge badge-xs shrink-0" :class="levelBadge(entry.level)">{{ entry.level }}</span>
        <span class="text-base-content/30 shrink-0">{{ entry.type }}</span>
        <span class="flex-1 break-all">{{ entry.message }}</span>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/admin/PluginLogTab.vue
git commit -m "feat(plugin-admin): add PluginLogTab with SSE streaming and history scroll-back"
```

---

## Task 9: PluginSystemSettingsModal

**Files:**
- Create: `app/components/admin/PluginSystemSettingsModal.vue`

- [ ] **Step 1: Implement system settings modal**

Standard DaisyUI dialog modal. Fetches `GET /api/admin/plugins/settings`, allows editing watcher/logBufferSize/logRetentionDays, saves via `PUT`.

Follows the existing modal pattern:
- `useTemplateRef<HTMLDialogElement>("dialogRef")`
- `defineExpose({ open })`
- `<Teleport to="body">`
- Close button with `hugeicons:cancel-01` icon
- Form with `fieldset`/`fieldset-legend` pattern
- Save button right-aligned

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

- [ ] **Step 2: Verify wiring**

The settings button and `<ClientOnly><PluginSystemSettingsModal ref="settingsRef" /></ClientOnly>` are already in the page template from Task 3. Verify they reference this component correctly.

- [ ] **Step 3: Commit**

```bash
git add app/components/admin/PluginSystemSettingsModal.vue app/pages/admin/plugins.vue
git commit -m "feat(plugin-admin): add PluginSystemSettingsModal and wire into page"
```

---

## Task 10: Integration + Polish

**Files:**
- Modify: `app/pages/admin/plugins.vue` (finalize)

- [ ] **Step 1: Verify all components integrate**

Ensure the page renders correctly with:
- Left panel: HostStatus + sortable PluginList + settings button
- Right panel: PluginDetail with all three tabs working
- Auth guard redirects non-admin users

- [ ] **Step 2: Add a navigation link**

Add a link to `/admin/plugins` somewhere accessible to admins. Options:
- Add a button in `AdminPanelModal.vue` that links to the plugins page (e.g., "插件管理 →")
- Or add a link in `ShortcutCard.vue` next to the admin panel button

Add a NuxtLink in `AdminPanelModal.vue` as a third tab or a prominent link:

```html
<NuxtLink to="/admin/plugins" class="btn btn-sm btn-ghost gap-1" @click="dialogRef?.close()">
  <Icon name="hugeicons:plug-01" class="text-base" />
  插件管理
  <Icon name="hugeicons:arrow-right-01" class="text-sm" />
</NuxtLink>
```

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(plugin-admin): finalize plugin admin page with navigation"
```

---

## Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | Setup | SortableJS dependency + frontend condition evaluator |
| 2 | SortableList | Generic SortableJS wrapper component |
| 3 | Page Entry | `/admin/plugins` page with auth guard and layout |
| 4 | HostStatus | Plugin Host status badge + restart |
| 5 | PluginList | Sortable plugin list with status badges |
| 6 | Detail + Info | Right panel container with tabs + info tab |
| 7 | ConfigTab | Dynamic config form with conditions |
| 8 | LogTab | SSE real-time logs + history scroll-back |
| 9 | Settings Modal | System settings modal |
| 10 | Integration | Wire everything together + navigation link |

**Total: 10 tasks**, each independently committable.
