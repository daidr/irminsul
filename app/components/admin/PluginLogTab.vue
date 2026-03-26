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
    <div class="flex flex-wrap items-center gap-2 mb-3">
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
      class="flex-1 min-h-0 overflow-y-auto border border-base-300 bg-base-100 font-mono text-xs"
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
