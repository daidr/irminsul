<script setup lang="ts">
import { HugeiconsIcon } from "@hugeicons/vue";
import { resolveBuiltInIcon } from "~~/server/utils/builtin-icons";

const props = defineProps<{
  name: string;
  size?: number;
}>();

const icon = resolveBuiltInIcon(props.name);
</script>

<template>
  <HugeiconsIcon :icon="icon" :size="size ?? 24" style="color: var(--theme-fg)" />
</template>
