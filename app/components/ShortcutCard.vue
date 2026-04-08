<script setup lang="ts">
defineProps<{
  isAdmin?: boolean;
  isDeveloper?: boolean;
}>();

const emit = defineEmits<{
  "change-password": [];
  "session-manage": [];
  "passkey-manage": [];
  "ban-history": [];
  "oauth-bindings": [];
  "admin-panel": [];
}>();

const shortcuts = [
  { icon: "lock", label: "修改密码", action: "change-password" },
  { icon: "game", label: "会话管理", action: "session-manage" },
  { icon: "passkeys", label: "通行密钥", action: "passkey-manage" },
  { icon: "ban", label: "封禁记录", action: "ban-history" },
  { icon: "oauth", label: "账号绑定", action: "oauth-bindings" },
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
        <Icon
          v-else-if="item.icon === 'oauth'"
          name="hugeicons:link-circle-02"
          class="h-[18px] w-[18px] shrink-0"
        />
        <span class="text-[13px] font-medium">{{ item.label }}</span>
      </button>
      <!-- Admin panel (admin only) -->
      <button v-if="isAdmin" class="btn border border-base-300" @click="emit('admin-panel')">
        <Icon name="hugeicons:dashboard-square-setting" class="h-[18px] w-[18px] shrink-0" />
        <span class="text-[13px] font-medium">管理面板</span>
      </button>
      <!-- Plugin management (admin only) -->
      <NuxtLink v-if="isAdmin" to="/admin/plugins" class="btn border border-base-300">
        <Icon name="hugeicons:plug-01" class="h-[18px] w-[18px] shrink-0" />
        <span class="text-[13px] font-medium">插件管理</span>
      </NuxtLink>
      <!-- Developer apps (developer or admin) -->
      <NuxtLink v-if="isDeveloper || isAdmin" to="/developer/apps" class="btn border border-base-300">
        <Icon name="hugeicons:code" class="h-[18px] w-[18px] shrink-0" />
        <span class="text-[13px] font-medium">开发者</span>
      </NuxtLink>
      <!-- OAuth authorizations (all logged-in users) -->
      <NuxtLink to="/settings/authorizations" class="btn border border-base-300">
        <Icon name="hugeicons:authorize" class="h-[18px] w-[18px] shrink-0" />
        <span class="text-[13px] font-medium">第三方应用授权</span>
      </NuxtLink>
      <!-- OAuth apps admin (admin only) -->
      <NuxtLink v-if="isAdmin" to="/admin/oauth-apps" class="btn border border-base-300">
        <Icon name="hugeicons:api" class="h-[18px] w-[18px] shrink-0" />
        <span class="text-[13px] font-medium">OAuth 应用</span>
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped lang="scss"></style>
