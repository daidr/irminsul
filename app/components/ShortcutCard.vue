<script setup lang="ts">
import { HugeiconsIcon } from "@hugeicons/vue";
import { ParagraphBulletsPoint01Icon, SquareLockPasswordIcon, GameController03Icon, Key01Icon, CalendarRemove01Icon, LinkCircle02Icon, DashboardSquareSettingIcon, Plug01Icon, SourceCodeIcon, AuthorizedIcon, ApiIcon } from "@hugeicons/core-free-icons";

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
      <HugeiconsIcon :icon="ParagraphBulletsPoint01Icon" :size="20" />
      <h2>快捷入口</h2>
    </div>
    <div class="mt-4 grid grid-cols-2 gap-3">
      <button v-for="item in shortcuts" :key="item.label" class="btn border border-base-300" @click="handleClick(item)">
        <HugeiconsIcon v-if="item.icon === 'lock'" :icon="SquareLockPasswordIcon" :size="18" class="shrink-0" />
        <HugeiconsIcon v-else-if="item.icon === 'game'" :icon="GameController03Icon" :size="18" class="shrink-0" />
        <HugeiconsIcon v-else-if="item.icon === 'passkeys'" :icon="Key01Icon" :size="18" class="shrink-0" />
        <HugeiconsIcon v-else-if="item.icon === 'ban'" :icon="CalendarRemove01Icon" :size="18" class="shrink-0" />
        <HugeiconsIcon v-else-if="item.icon === 'oauth'" :icon="LinkCircle02Icon" :size="18" class="shrink-0" />
        <span class="text-[13px] font-medium">{{ item.label }}</span>
      </button>
      <!-- Admin panel (admin only) -->
      <button v-if="isAdmin" class="btn border border-base-300" @click="emit('admin-panel')">
        <HugeiconsIcon :icon="DashboardSquareSettingIcon" :size="18" class="shrink-0" />
        <span class="text-[13px] font-medium">管理面板</span>
      </button>
      <!-- Plugin management (admin only) -->
      <NuxtLink v-if="isAdmin" to="/admin/plugins" class="btn border border-base-300">
        <HugeiconsIcon :icon="Plug01Icon" :size="18" class="shrink-0" />
        <span class="text-[13px] font-medium">插件管理</span>
      </NuxtLink>
      <!-- Developer apps (developer or admin) -->
      <NuxtLink v-if="isDeveloper || isAdmin" to="/developer/apps" class="btn border border-base-300">
        <HugeiconsIcon :icon="SourceCodeIcon" :size="18" class="shrink-0" />
        <span class="text-[13px] font-medium">开发者</span>
      </NuxtLink>
      <!-- OAuth authorizations (all logged-in users) -->
      <NuxtLink to="/settings/authorizations" class="btn border border-base-300">
        <HugeiconsIcon :icon="AuthorizedIcon" :size="18" class="shrink-0" />
        <span class="text-[13px] font-medium">第三方应用</span>
      </NuxtLink>
      <!-- OAuth apps admin (admin only) -->
      <NuxtLink v-if="isAdmin" to="/admin/oauth-apps" class="btn border border-base-300">
        <HugeiconsIcon :icon="ApiIcon" :size="18" class="shrink-0" />
        <span class="text-[13px] font-medium">OAuth 应用</span>
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped lang="scss"></style>
