<script setup lang="ts">
defineProps<{
  isAdmin?: boolean;
}>();

const emit = defineEmits<{
  "change-password": [];
  "session-manage": [];
  "passkey-manage": [];
  "ban-history": [];
  "admin-panel": [];
}>();

const shortcuts = [
  { icon: "lock", label: "修改密码", action: "change-password" },
  { icon: "game", label: "会话管理", action: "session-manage" },
  { icon: "passkeys", label: "通行密钥", action: "passkey-manage" },
  { icon: "ban", label: "封禁记录", action: "ban-history" },
] as const;

function handleClick(item: (typeof shortcuts)[number]) {
  emit(item.action);
}
</script>

<template>
  <div class="border border-base-300 bg-base-200 p-5">
    <div class="flex items-center gap-2.5 text-lg">
      <Icon name="hugeicons:paragraph-bullets-point-01" />
      <h2>快捷入口</h2>
    </div>
    <div class="mt-4 grid grid-cols-2 gap-3">
      <button
        v-for="item in shortcuts"
        :key="item.label"
        class="btn border border-base-300"
        @click="handleClick(item)"
      >
        <Icon
          v-if="item.icon === 'lock'"
          name="hugeicons:square-lock-password"
          class="h-[18px] w-[18px] shrink-0"
        />
        <Icon
          v-else-if="item.icon === 'game'"
          name="hugeicons:game-controller-03"
          class="h-[18px] w-[18px] shrink-0"
        />
        <Icon
          v-else-if="item.icon === 'passkeys'"
          name="hugeicons:key-01"
          class="h-[18px] w-[18px] shrink-0"
        />
        <Icon
          v-else-if="item.icon === 'ban'"
          name="hugeicons:calendar-remove-01"
          class="h-[18px] w-[18px] shrink-0"
        />
        <span class="text-[13px] font-medium">{{ item.label }}</span>
      </button>
      <!-- Admin panel (admin only) -->
      <button v-if="isAdmin" class="btn border border-base-300" @click="emit('admin-panel')">
        <Icon name="hugeicons:dashboard-square-setting" class="h-[18px] w-[18px] shrink-0" />
        <span class="text-[13px] font-medium">管理面板</span>
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss"></style>
