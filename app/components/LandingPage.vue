<script setup lang="ts">
import { useScroll, useTransform, useSpring, motion } from "motion-v";

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const { scrollY } = useScroll();
const rawY = useTransform(scrollY, [0, 500], [0, 150], { ease: easeOut });
const heroY = useSpring(rawY, { stiffness: 100, damping: 10 });

const features = computed(() => [
  {
    icon: "hugeicons:arrow-data-transfer-vertical",
    title: "Yggdrasil 兼容",
    class: "text-primary",
    description: "兼容 Yggdrasil 协议，无缝接入 authlib-injector",
  },
  {
    icon: "hugeicons:background",
    title: "材质管理",
    class: "text-accent",
    description: "轻松上传游戏皮肤或披风，打造个性角色",
  },
  {
    icon: "hugeicons:server-stack-03",
    title: "一键部署",
    class: "text-warning",
    description: "基于 MIT 协议开源，Docker 一键部署",
  },
  {
    icon: "hugeicons:zap",
    title: "现代技术栈",
    class: "text-info",
    description: "基于 Bun.js / Nuxt / MongoDB，高性能低延迟",
  },
]);
</script>

<template>
  <section class="h-dvh -mt-18 overflow-hidden flex items-center justify-center">
    <motion.div
      class="flex flex-col items-center justify-center gap-9 relative"
      :style="{ y: heroY }"
    >
      <div
        class="backdrop-blur-sm bg-black/2 border-black/7 border px-4 py-1.5 text-[#6B7280] text-sm flex gap-2 items-center"
      >
        <div class="w-1.5 h-1.5 bg-primary"></div>
        开源 · 安全 · 自托管
      </div>
      <h1 class="text-7xl font-semibold tracking-tighter">Irminsul</h1>
      <p class="opacity-60">轻量的 Minecraft 服务器 yggdrasil 验证</p>
      <div class="flex gap-4">
        <NuxtLink class="btn btn-primary" to="/login"
          >开始使用<Icon name="hugeicons:arrow-right-02"
        /></NuxtLink>
        <a class="btn btn-soft" href="https://github.com/daidr/irminsul" target="_blank"
          ><Icon name="hugeicons:github" />GitHub</a
        >
      </div>
    </motion.div>
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
            <Icon :name="feature.icon" class="text-2xl" />
          </div>
          <div class="text-lg">{{ feature.title }}</div>
        </div>
        <div class="opacity-60">{{ feature.description }}</div>
      </div>
    </div>
  </section>
</template>
