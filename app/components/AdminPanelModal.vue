<script setup lang="ts">
import { HugeiconsIcon } from "@hugeicons/vue";
import { Plug01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

const siteConfigRef = ref<InstanceType<typeof AdminSiteConfigTab> | null>(null);
const activeTab = ref<"site-config" | "user-manage">("site-config");
const emit = defineEmits<{ close: [] }>();

function canClose(): boolean {
  if (siteConfigRef.value?.anyDirty) {
    return window.confirm("有未保存的修改，确定关闭？");
  }
  return true;
}

function handleClose() {
  if (!canClose()) return;
  emit("close");
}

defineExpose({ canClose });
</script>

<template>
  <!-- 头部 -->
  <div class="flex items-center justify-between">
    <h3 class="text-xl font-bold">管理面板</h3>
  </div>

  <!-- Tab 栏 -->
  <div class="join w-full mt-5">
    <button
      class="btn btn-sm join-item flex-1"
      :class="activeTab === 'site-config' ? 'btn-active' : ''"
      @click="activeTab = 'site-config'"
    >
      站点配置
    </button>
    <button
      class="btn btn-sm join-item flex-1"
      :class="activeTab === 'user-manage' ? 'btn-active' : ''"
      @click="activeTab = 'user-manage'"
    >
      用户管理
    </button>
  </div>

  <!-- 插件管理入口 -->
  <div class="mt-3 flex justify-end">
    <NuxtLink to="/admin/plugins" class="btn btn-sm btn-ghost gap-1" @click="emit('close')">
      <HugeiconsIcon :icon="Plug01Icon" :size="16" />
      插件管理
      <HugeiconsIcon :icon="ArrowRight01Icon" :size="14" />
    </NuxtLink>
  </div>

  <!-- Tab 内容 -->
  <AdminSiteConfigTab
    v-show="activeTab === 'site-config'"
    ref="siteConfigRef"
  />
  <AdminUserManageTab v-show="activeTab === 'user-manage'" />
</template>
