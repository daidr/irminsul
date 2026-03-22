<script setup lang="ts">
import { SkinViewer } from "@daidr/minecraft-skin-renderer/vue3";
import { WebGLRendererPlugin } from "@daidr/minecraft-skin-renderer/webgl";
import type { UseSkinViewerOptions } from "@daidr/minecraft-skin-renderer/vue3";

type Props = Omit<UseSkinViewerOptions, "plugins">;

defineOptions({ inheritAttrs: false });

defineProps<Props>();

const plugins = [WebGLRendererPlugin];
</script>

<template>
  <SkinViewer v-bind="{ ...$props, ...$attrs, plugins }" />
</template>
