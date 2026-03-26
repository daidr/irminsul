<script setup lang="ts">
const dialogRef = useTemplateRef<HTMLDialogElement>("dialogRef");
const watcher = ref(true);
const logBufferSize = ref(200);
const logRetentionDays = ref(7);
const saving = ref(false);
const toast = useToast();
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
    toast.error(err?.data?.message ?? "保存失败");
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
