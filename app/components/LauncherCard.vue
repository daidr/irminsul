<script setup lang="ts">
const props = defineProps<{
  apiUrl: string;
}>();

const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | undefined;

onBeforeUnmount(() => {
  clearTimeout(copyTimer);
});

async function copyApiUrl() {
  try {
    await navigator.clipboard.writeText(props.apiUrl);
    copied.value = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    // fallback: select the url text
  }
}

function onDragStart(e: DragEvent) {
  if (!e.dataTransfer) return;
  const uri = `authlib-injector:yggdrasil-server:${encodeURIComponent(props.apiUrl)}`;
  e.dataTransfer.setData("text/plain", uri);
  e.dataTransfer.dropEffect = "copy";
}
</script>

<template>
  <div class="border border-base-300 bg-base-200 p-5">
    <div class="flex items-center gap-2.5 text-lg">
      <Icon name="hugeicons:cursor-magic-selection-03" />
      <h2>快速配置启动器</h2>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span class="opacity-60">Yggdrasil API 认证地址：</span>
      <span class="font-medium text-primary select-all">{{ apiUrl }}</span>
    </div>

    <p class="mt-3 text-[13px] leading-relaxed opacity-60">
      点击下方按钮复制 API 地址，或者将按钮拖动至启动器的任意界面即可快速添加认证服务器。
    </p>

    <div class="mt-4 flex gap-3">
      <button
        class="btn cursor-grab btn-primary text-primary-content active:cursor-grabbing"
        draggable="true"
        @dragstart="onDragStart"
        @click="copyApiUrl"
      >
        <Icon v-if="!copied" name="hugeicons:drag-drop" class="text-base" />
        <Icon v-else name="hugeicons:checkmark-square-04" class="text-base" />
        <span>{{ copied ? "已复制" : "将此按钮拖至启动器" }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss"></style>
