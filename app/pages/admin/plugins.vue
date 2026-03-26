<script setup lang="ts">
definePageMeta({ hideFooter: true });

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
    // 未选中时自动选择第一个
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

const selectedPlugin = computed(
  () => plugins.value.find((p) => p.id === selectedId.value) ?? null,
);

async function handleOrderUpdate(newList: any[]) {
  plugins.value = newList;
  const order = newList.map((p) => p.id);
  await $fetch("/api/admin/plugins/order", { method: "PUT", body: { order } });
}

async function handlePluginAction() {
  await fetchPlugins();
}
</script>

<template>
  <div v-if="user?.isAdmin" class="flex flex-1 min-h-0 mx-4">
    <!-- 左侧面板 -->
    <div class="w-[300px] shrink-0 border-x border-base-300 bg-base-200 flex flex-col">
      <AdminPluginHostStatus class="p-3 border-b border-base-300" @restarted="fetchPlugins" />
      <div class="flex-1 overflow-y-auto">
        <AdminPluginList
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

    <!-- 右侧面板 -->
    <div class="flex-1 border-r border-base-300 bg-base-200">
      <AdminPluginDetail
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
    <AdminPluginSystemSettingsModal ref="settingsRef" />
  </ClientOnly>
</template>
