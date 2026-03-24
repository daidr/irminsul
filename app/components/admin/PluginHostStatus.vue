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
