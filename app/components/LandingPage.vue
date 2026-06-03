<script setup lang="ts">
import type { IconArray } from "@hugeicons/vue";
import { HugeiconsIcon } from "@hugeicons/vue";
import {
  ArrowDataTransferVerticalIcon,
  ArrowRight02Icon,
  BackgroundIcon,
  GithubIcon,
  ServerStack03Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import { useWindowScroll } from "@vueuse/core";

// 用 VueUse（已是依赖）实现 hero 视差，替代 122KB 的 motion-v。SSR 时 y=0，安全降级。
const { y: scrollY } = useWindowScroll();
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const heroY = computed(() => {
  const t = Math.min(1, Math.max(0, scrollY.value / 500));
  return easeOut(t) * 150;
});

const features = computed(() => [
  {
    icon: ArrowDataTransferVerticalIcon,
    title: "Yggdrasil 兼容",
    class: "text-primary",
    description: "兼容 Yggdrasil 协议，无缝接入 authlib-injector",
  },
  {
    icon: BackgroundIcon,
    title: "材质管理",
    class: "text-accent",
    description: "轻松上传游戏皮肤或披风，打造个性角色",
  },
  {
    icon: ServerStack03Icon,
    title: "一键部署",
    class: "text-warning",
    description: "基于 MIT 协议开源，Docker 一键部署",
  },
  {
    icon: ZapIcon,
    title: "现代技术栈",
    class: "text-info",
    description: "基于 Bun.js / Nuxt / MongoDB，高性能低延迟",
  },
]);
</script>

<template>
  <section class="h-[calc(100dvh+48px)] -mt-18 overflow-hidden flex items-center justify-center">
    <div
      class="flex flex-col items-center justify-center gap-9 relative"
      :style="{ transform: `translateY(${heroY}px)` }"
    >
      <div
        class="backdrop-blur-sm bg-black/2 border-black/7 dark:bg-white/5 dark:border-white/17 border px-4 py-1.5 text-sm flex gap-2 items-center"
      >
        <div class="w-1.5 h-1.5 bg-primary"></div>
        <span class="opacity-60">开源 · 安全 · 自托管</span>
      </div>
      <h1 class="text-7xl font-semibold tracking-tighter">Irminsul</h1>
      <p class="opacity-60">轻量的 Minecraft 服务器 yggdrasil 验证</p>
      <div class="flex gap-4">
        <NuxtLink class="btn btn-primary" to="/login"
          >开始使用
          <HugeiconsIcon :icon="ArrowRight02Icon" :size="18" />
        </NuxtLink>
        <a class="btn btn-soft" href="https://github.com/daidr/irminsul" target="_blank">
          <HugeiconsIcon :icon="GithubIcon" :size="18" />GitHub
        </a>
      </div>
    </div>
  </section>
  <section class="px-5 pb-25 flex justify-center">
    <div class="grid gap-8 md:grid-cols-2 max-w-300">
      <div
        v-for="feature in features"
        :key="feature.title"
        class="flex flex-col gap-5 p-8 border border-black/6 bg-base-200"
      >
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 flex items-center justify-center relative" :class="feature.class">
            <div class="absolute inset-0 bg-current opacity-7"></div>
            <HugeiconsIcon :icon="feature.icon" />
          </div>
          <div class="text-lg">{{ feature.title }}</div>
        </div>
        <div class="opacity-60">{{ feature.description }}</div>
      </div>
    </div>
  </section>
</template>
