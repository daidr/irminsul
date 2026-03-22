<script setup lang="ts">
const profileStore = useProfileStore();
const { skinUrl } = storeToRefs(profileStore);

const renderCanvasRef = ref<HTMLCanvasElement | null>(null);
const renderGraph = useRenderGraph(renderCanvasRef, skinUrl);
</script>

<template>
  <div
    class="mt-4 relative border border-base-300 bg-base-100 overflow-hidden"
    style="min-height: 200px"
  >
    <template v-if="skinUrl && renderGraph.scenes.value.length > 0">
      <div class="relative w-full">
        <canvas
          ref="renderCanvasRef"
          class="w-full h-auto"
          :style="
            renderGraph.currentAspectRatio.value
              ? { aspectRatio: renderGraph.currentAspectRatio.value }
              : {}
          "
        />

        <div
          v-if="renderGraph.isLoading.value"
          class="absolute inset-0 flex items-center justify-center bg-base-100/80"
        >
          <span class="loading loading-spinner loading-md" />
        </div>
      </div>
      <div class="flex items-center justify-between p-3">
        <button
          class="btn btn-sm btn-ghost"
          :disabled="!renderGraph.canGoPrev.value"
          @click="renderGraph.goPrev()"
        >
          <Icon name="hugeicons:arrow-left-01" class="h-4 w-4" />
        </button>
        <span
          v-if="renderGraph.scenes.value[renderGraph.currentIndex.value]?.copyright"
          class="text-xs text-base-content/40"
        >
          {{ renderGraph.scenes.value[renderGraph.currentIndex.value].copyright }}
        </span>
        <button
          class="btn btn-sm btn-ghost"
          :disabled="!renderGraph.canGoNext.value"
          @click="renderGraph.goNext()"
        >
          <Icon name="hugeicons:arrow-right-01" class="h-4 w-4" />
        </button>
      </div>
    </template>
    <div
      v-else
      class="flex flex-col items-center justify-center gap-2 text-base-content/30 py-16"
    >
      <Icon name="hugeicons:user" class="h-20 w-20" />
      <span class="text-sm">暂无皮肤</span>
    </div>
  </div>
</template>

<style scoped lang="scss"></style>
