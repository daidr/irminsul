<script setup lang="ts">
const dialogRef = useTemplateRef<HTMLDialogElement>("dialogRef");
const siteConfigRef = ref<InstanceType<typeof AdminSiteConfigTab> | null>(null);
const activeTab = ref<"site-config" | "user-manage">("site-config");
const openKey = ref(0);

function handleClose() {
  if (siteConfigRef.value?.anyDirty) {
    const confirmed = window.confirm("有未保存的修改，确定关闭？");
    if (!confirmed) return;
  }
  dialogRef.value?.close();
}

function onCancel(e: Event) {
  if (siteConfigRef.value?.anyDirty) {
    e.preventDefault();
    const confirmed = window.confirm("有未保存的修改，确定关闭？");
    if (confirmed) {
      dialogRef.value?.close();
    }
  }
}

function open() {
  activeTab.value = "site-config";
  openKey.value++;
  dialogRef.value?.showModal();
}

defineExpose({ open });
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialogRef" class="modal modal-bottom sm:modal-middle" @cancel="onCancel">
      <div class="modal-box sm:max-w-[700px]">
        <!-- 头部 -->
        <div class="flex items-center justify-between">
          <h3 class="text-xl font-bold">管理面板</h3>
          <button class="btn btn-ghost btn-sm" @click="handleClose">
            <Icon name="hugeicons:cancel-01" class="text-xl opacity-40" />
          </button>
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

        <!-- Tab 内容：key 变化时重建组件，重新拉取配置 -->
        <AdminSiteConfigTab
          :key="'sc-' + openKey"
          v-show="activeTab === 'site-config'"
          ref="siteConfigRef"
        />
        <AdminUserManageTab :key="'um-' + openKey" v-show="activeTab === 'user-manage'" />
      </div>
      <!-- 背景点击关闭 -->
      <div class="modal-backdrop" @click="handleClose" />
    </dialog>
  </Teleport>
</template>
