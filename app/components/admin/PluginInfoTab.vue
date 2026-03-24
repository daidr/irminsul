<script setup lang="ts">
defineProps<{ plugin: any }>();
</script>

<template>
  <div class="space-y-3">
    <div v-if="plugin.description">
      <div class="text-xs text-base-content/50 mb-1">描述</div>
      <div class="text-sm">{{ plugin.description }}</div>
    </div>
    <div v-if="plugin.author">
      <div class="text-xs text-base-content/50 mb-1">作者</div>
      <div class="text-sm">{{ plugin.author }}</div>
    </div>
    <div>
      <div class="text-xs text-base-content/50 mb-1">版本</div>
      <div class="text-sm">{{ plugin.version }}</div>
    </div>
    <div>
      <div class="text-xs text-base-content/50 mb-1">Hooks</div>
      <div class="flex flex-wrap gap-1">
        <span v-for="hook in plugin.hooks" :key="hook" class="badge badge-sm badge-outline">
          {{ hook }}
        </span>
      </div>
    </div>
    <div>
      <div class="text-xs text-base-content/50 mb-1">状态</div>
      <div class="text-sm">{{ plugin.status }}</div>
    </div>
    <div>
      <div class="text-xs text-base-content/50 mb-1">插件目录</div>
      <div class="text-sm font-mono text-base-content/70 break-all">{{ plugin.id }}</div>
    </div>
  </div>
</template>
