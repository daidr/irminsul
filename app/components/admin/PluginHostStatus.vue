<script setup lang="ts">
const emit = defineEmits<{ restarted: [] }>();

const status = ref<string | null>(null);
const dirtyReasons = ref<any[]>([]);
const restarting = ref(false);
let eventSource: EventSource | null = null;

function connectSSE() {
  disconnectSSE();
  eventSource = new EventSource("/api/admin/plugins/host/status-stream");
  eventSource.addEventListener("status", (e) => {
    const data = JSON.parse(e.data);
    status.value = data.status;
    dirtyReasons.value = data.dirtyReasons;
  });
  eventSource.onerror = () => {
    // Reconnect after 3 seconds on error
    disconnectSSE();
    setTimeout(connectSSE, 3000);
  };
}

function disconnectSSE() {
  eventSource?.close();
  eventSource = null;
}

onMounted(connectSSE);
onBeforeUnmount(disconnectSSE);

async function restartHost() {
  restarting.value = true;
  try {
    await $fetch("/api/admin/plugins/host/restart", { method: "POST" });
    emit("restarted");
  } catch { } finally {
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
        <span class="text-sm font-semibold">Plugin Host</span>
        <span v-if="status === null" class="loading loading-spinner loading-xs" />
        <span v-else class="badge badge-sm" :class="statusColor">{{ statusLabel }}</span>
      </div>
      <button v-if="status === 'dirty' || status === 'crashed'" class="btn btn-xs btn-warning" :disabled="restarting"
        @click="restartHost">
        <span v-if="restarting" class="loading loading-spinner loading-xs" />
        <Icon v-else name="hugeicons:refresh" class="text-sm" />
        重启
      </button>
    </div>
    <div v-if="dirtyReasons.length > 0" class="mt-1.5 space-y-0.5">
      <div v-for="r in dirtyReasons" :key="r.pluginId + r.reason" class="text-xs text-warning">
        · {{ r.pluginId }}（{{ reasonLabel(r.reason) }}）
      </div>
    </div>
  </div>
</template>
