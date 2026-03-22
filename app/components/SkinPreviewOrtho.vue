<script setup lang="ts">
import {
  useRenderSkinFront,
  useRenderSkinBack,
  useRenderSkinLeftSide,
  useRenderSkinRightSide,
} from "@daidr/minecraft-skin-renderer/vue3";

const profileStore = useProfileStore();
const { skinUrl, effectiveSkinSlim } = storeToRefs(profileStore);

const showOverlay = ref(true);
const overlayInflated = ref(true);

const orthoScale = 10;

const backCanvasRef = useTemplateRef<HTMLCanvasElement>("backCanvasRef");
const rightCanvasRef = useTemplateRef<HTMLCanvasElement>("rightCanvasRef");
const frontCanvasRef = useTemplateRef<HTMLCanvasElement>("frontCanvasRef");
const leftCanvasRef = useTemplateRef<HTMLCanvasElement>("leftCanvasRef");

const renderOptions = computed(() => ({
  skin: skinUrl.value ?? "",
  slim: effectiveSkinSlim.value ?? false,
  scale: orthoScale,
  showOverlay: showOverlay.value,
  overlayInflated: overlayInflated.value,
}));

useRenderSkinBack(backCanvasRef, renderOptions);
useRenderSkinRightSide(rightCanvasRef, renderOptions);
useRenderSkinFront(frontCanvasRef, renderOptions);
useRenderSkinLeftSide(leftCanvasRef, renderOptions);
</script>

<template>
  <div
    class="mt-4 overflow-x-auto border border-base-300 bg-base-100 p-4"
    style="min-height: 320px"
  >
    <ClientOnly>
      <div v-if="skinUrl" class="flex items-end justify-center gap-8 min-w-max mx-auto">
        <div class="flex flex-col items-center">
          <div class="h-[330px] w-[170px] flex items-center justify-center">
            <canvas ref="backCanvasRef" style="image-rendering: pixelated" />
          </div>
          <span class="mt-3 text-xs text-base-content/40">背面</span>
        </div>
        <div class="flex flex-col items-center">
          <div class="h-[330px] w-[90px] flex items-center justify-center">
            <canvas ref="rightCanvasRef" style="image-rendering: pixelated" />
          </div>
          <span class="mt-3 text-xs text-base-content/40">右面</span>
        </div>
        <div class="flex flex-col items-center">
          <div class="h-[330px] w-[170px] flex items-center justify-center">
            <canvas ref="frontCanvasRef" style="image-rendering: pixelated" />
          </div>
          <span class="mt-3 text-xs text-base-content/40">前面</span>
        </div>
        <div class="flex flex-col items-center">
          <div class="h-[330px] w-[90px] flex items-center justify-center">
            <canvas ref="leftCanvasRef" style="image-rendering: pixelated" />
          </div>
          <span class="mt-3 text-xs text-base-content/40">左面</span>
        </div>
      </div>
      <div v-else class="flex flex-col items-center gap-2 text-base-content/30">
        <span class="text-sm">暂无皮肤</span>
      </div>
    </ClientOnly>
  </div>

  <div class="mt-4 flex gap-3">
    <button
      class="btn btn-sm"
      :class="showOverlay ? 'btn-active' : ''"
      @click="showOverlay = !showOverlay"
    >
      覆盖层
    </button>
    <button
      v-if="showOverlay"
      class="btn btn-sm"
      :class="overlayInflated ? 'btn-active' : ''"
      @click="overlayInflated = !overlayInflated"
    >
      覆盖层交错
    </button>
  </div>
</template>

<style scoped lang="scss"></style>
