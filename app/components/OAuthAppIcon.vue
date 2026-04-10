<script setup lang="ts">
import { DEFAULT_ICON } from "~~/shared/builtin-icon-names";

const props = defineProps<{
  name?: string | null;
  hue?: number | null;
  size?: number;
}>();

const iconName = computed(() => props.name ?? DEFAULT_ICON.name);
const iconHue = computed(() => props.hue ?? DEFAULT_ICON.hue);

const colorVars = useIconColorVars(iconHue);

const islandProps = computed(() => ({ name: iconName.value, size: props.size }));
</script>

<template>
  <div
    class="inline-flex items-center justify-center w-full h-full"
    :style="colorVars"
    style="background: var(--theme-bg); border: 1px solid var(--theme-border)"
  >
    <NuxtIsland name="BuiltInIcon" :props="islandProps" />
  </div>
</template>
