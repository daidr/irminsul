<script setup lang="ts">
import { useRenderAvatar } from "@daidr/minecraft-skin-renderer/vue3";

const props = defineProps<{
  hash: string;
  slim?: boolean;
  scale?: number;
}>();

const canvasRef = useTemplateRef<HTMLCanvasElement>("canvasRef");

const renderOptions = computed(() => ({
  skin: `/textures/${props.hash}`,
  slim: props.slim ?? false,
  scale: props.scale ?? 3,
  overlayInflated: true,
}));

useRenderAvatar(canvasRef, renderOptions);
</script>

<template>
  <canvas ref="canvasRef" />
</template>

<style scoped lang="scss">
canvas {
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.2));
}
</style>
