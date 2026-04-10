<script setup lang="ts">
import { HugeiconsIcon } from "@hugeicons/vue";
import { ThreeDViewIcon } from "@hugeicons/core-free-icons";

type ViewTab = "model" | "orthographic" | "raw" | "render";

const activeTab = ref<ViewTab>("model");
</script>

<template>
  <div class="border border-base-300 bg-base-200 p-5">
    <div class="flex flex-wrap items-center gap-2.5 text-lg">
      <HugeiconsIcon :icon="ThreeDViewIcon" :size="20" />
      <h2>皮肤预览</h2>
      <!-- 标签页切换 -->
      <div class="basis-full md:basis-auto"></div>
      <div class="join">
        <button class="btn btn-xs join-item" :class="activeTab === 'model' ? 'btn-active' : ''"
          @click="activeTab = 'model'">
          3D 模型
        </button>
        <button class="btn btn-xs join-item" :class="activeTab === 'orthographic' ? 'btn-active' : ''"
          @click="activeTab = 'orthographic'">
          多面视图
        </button>
        <button class="btn btn-xs join-item" :class="activeTab === 'raw' ? 'btn-active' : ''"
          @click="activeTab = 'raw'">
          原始图片
        </button>
        <button class="btn btn-xs join-item" :class="activeTab === 'render' ? 'btn-active' : ''"
          @click="activeTab = 'render'">
          渲染图
        </button>
      </div>
    </div>

    <SkinPreviewModel v-if="activeTab === 'model'" />
    <ClientOnly>
      <LazySkinPreviewOrtho v-if="activeTab === 'orthographic'" />
      <LazySkinPreviewRaw v-if="activeTab === 'raw'" />
      <LazySkinPreviewRender v-if="activeTab === 'render'" />
    </ClientOnly>
  </div>
</template>

<style scoped lang="scss"></style>
