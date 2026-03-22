<script setup lang="ts">
defineProps<{
  announcement?: string;
}>();
</script>

<template>
  <div class="border border-base-300 bg-base-200 p-5">
    <h2 class="text-lg">欢迎来到 Irminsul</h2>
    <div v-if="announcement" class="announcement-content mt-3 text-sm opacity-60" v-html="announcement"></div>
  </div>
</template>

<style scoped>
@reference "~/assets/css/tailwind.css";

.announcement-content :deep(p) {
  @apply mb-2 last:mb-0;
}

.announcement-content :deep(a) {
  @apply underline;
}

.announcement-content :deep(ul) {
  @apply mb-2 list-disc pl-5 last:mb-0;
}

.announcement-content :deep(ol) {
  @apply mb-2 list-decimal pl-5 last:mb-0;
}

.announcement-content :deep(code) {
  @apply bg-base-300 px-1 py-0.5;
}

.announcement-content :deep(pre) {
  @apply mb-2 overflow-x-auto bg-base-300 p-3 last:mb-0;
}

.announcement-content :deep(blockquote) {
  @apply mb-2 border-l-2 border-base-content/30 pl-3 last:mb-0;
}
</style>
