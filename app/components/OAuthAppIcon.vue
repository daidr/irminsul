<script setup lang="ts">
import { DEFAULT_ICON } from "~/shared/builtin-icon-names";

const props = defineProps<{
  name?: string | null;
  hue?: number | null;
  size?: number;
}>();

const iconName = computed(() => props.name ?? DEFAULT_ICON.name);
const iconHue = computed(() => props.hue ?? DEFAULT_ICON.hue);

const colorVars = computed(() => ({
  "--theme-bg": `oklch(0.75 0.08 ${iconHue.value} / 0.20)`,
  "--theme-border": `oklch(0.62 0.10 ${iconHue.value} / 0.30)`,
  "--theme-fg": `oklch(0.40 0.12 ${iconHue.value} / 0.80)`,
}));
</script>

<template>
  <div
    class="inline-flex items-center justify-center w-full h-full"
    :style="colorVars"
    style="background: var(--theme-bg); border: 1px solid var(--theme-border)"
  >
    <NuxtIsland name="BuiltInIcon" :props="{ name: iconName, size }" />
  </div>
</template>
