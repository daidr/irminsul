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

    <!-- 错误显示 -->
    <div v-if="plugin.error" class="px-4 pt-3">
      <div role="alert" class="alert alert-error alert-soft text-sm">
        <span>{{ plugin.error }}</span>
      </div>
    </div>

    <!-- Tab 栏 -->
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

    <!-- Tab 内容 -->
    <div class="flex-1 overflow-y-auto p-4">
      <AdminPluginConfigTab
        v-show="activeTab === 'config'"
        :plugin-id="plugin.id"
        :config-schema="plugin.configSchema"
        :config="plugin.config"
        @saved="fetchDetail(); emit('action')"
      />
      <AdminPluginLogTab
        v-show="activeTab === 'logs'"
        :plugin-id="plugin.id"
        :active="activeTab === 'logs'"
      />
      <AdminPluginInfoTab
        v-show="activeTab === 'info'"
        :plugin="plugin"
      />
    </div>
  </div>
</template>
