<script setup lang="ts">
import { HugeiconsIcon } from "@hugeicons/vue";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
</script>

<template>
  <div class="flex flex-col items-center justify-center py-16 gap-3 text-base-content/40">
    <p>用户管理已移至独立页面</p>
    <NuxtLink to="/admin/users" class="btn btn-sm btn-ghost">
      前往用户管理
      <HugeiconsIcon :icon="ArrowRight01Icon" :size="16" />
    </NuxtLink>
  </div>
</template>
