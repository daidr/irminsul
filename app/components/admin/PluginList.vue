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
    case "pending_disable": return { class: "badge-warning", label: "待重启" };
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
  <AdminSortableList v-else :model-value="modelValue" :options="{ handle: '.drag-handle', ghostClass: 'opacity-30' }"
    @update:model-value="emit('update:modelValue', $event)">
    <div v-for="plugin in modelValue" :key="plugin.id"
      class="flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-base-300 transition-colors"
      :class="selectedId === plugin.id ? 'bg-primary/10' : 'hover:bg-base-300/50'" @click="emit('select', plugin.id)">
      <Icon name="hugeicons:drag-drop" class="drag-handle text-base-content/30 cursor-grab text-sm shrink-0" />
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium truncate">{{ plugin.name }}</div>
        <div class="text-xs text-base-content/50">v{{ plugin.version }}</div>
      </div>
      <span class="badge badge-sm" :class="statusBadge(plugin.status).class">
        {{ statusBadge(plugin.status).label }}
      </span>
    </div>
  </AdminSortableList>
</template>
