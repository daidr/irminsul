<script setup lang="ts">
import { AnimatePresence, motion } from "motion-v";

const props = defineProps<{
  user: any;
}>();

const toast = useToast();
const show = ref(false);
const loggingOut = ref(false);
let closeTimer: ReturnType<typeof setTimeout> | null = null;

onBeforeUnmount(() => {
  if (closeTimer) clearTimeout(closeTimer);
});

function onEnter() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  show.value = true;
}

function onLeave() {
  closeTimer = setTimeout(() => {
    show.value = false;
  }, 150);
}

async function handleLogout() {
  loggingOut.value = true;
  try {
    await $fetch("/api/auth/logout", { method: "POST" });
    await refreshNuxtData("current-user");
    await navigateTo("/");
  } catch {
    toast.error("退出登录失败，请稍后重试");
  } finally {
    loggingOut.value = false;
  }
}

const registerDate = computed(() => {
  if (!props.user.registerAt) return null;
  const d = new Date(props.user.registerAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
});

const isBanned = computed(() => {
  const now = Date.now();
  return props.user.bans?.some((ban: any) => ban.start <= now && (!ban.end || ban.end > now));
});
</script>

<template>
  <div class="relative flex items-center" @mouseenter="onEnter" @mouseleave="onLeave">
    <!-- Trigger -->
    <div class="flex gap-2.5 items-center cursor-pointer">
      <motion.div v-if="!show" layout class="pointer-events-none w-5 h-5 relative z-10"
        layoutId="user-avatar" :exit="{ opacity: 1 }">
        <img :src="`/avatar/${props.user.gameId}?scale=2`" class="w-full h-full" style="image-rendering: pixelated">
      </motion.div>
      <motion.p class="text-sm whitespace-nowrap font-mono" layout layoutId="user-game-id">{{
        user.gameId
      }}</motion.p>
    </div>

    <!-- Popover -->
    <AnimatePresence>
      <div v-show="show" class="popover-anchor" @mouseenter="onEnter" @mouseleave="onLeave">
        <div class="h-[27px] shrink-0" />

        <motion.div layout class="pointer-events-none w-16 h-16 -mt-16 translate-y-1/2 relative z-10"
          layoutId="user-avatar" :initial="{ opacity: 1 }">
          <img :src="`/avatar/${props.user.gameId}?scale=4`" class="w-full h-full" style="image-rendering: pixelated">
        </motion.div>
        <!-- Card -->
        <motion.div class="w-full bg-base-100 shadow-lg border border-base-300 relative"
          :initial="{ opacity: 0, y: -20 }" :animate="{ opacity: 1, y: 0 }" :exit="{ opacity: 0, y: -20 }">
          <div class="card-body items-center text-center pt-8">
            <motion.p class="text-xl whitespace-nowrap font-mono" layout layoutId="user-game-id">{{
              user.gameId
            }}</motion.p>
            <span v-if="isBanned" class="badge badge-soft badge-error badge-sm">封禁中</span>
            <span v-else-if="user.isAdmin" class="badge badge-soft badge-primary badge-sm">管理员</span>
            <span v-else class="badge badge-soft badge-sm">普通玩家</span>

            <div class="divider my-0" />

            <div class="info-section">
              <div class="info-row">
                <Icon name="hugeicons:mail-01" class="info-icon" />
                <span class="truncate">{{ user.email }}</span>
              </div>
              <div v-if="registerDate" class="info-row">
                <Icon name="hugeicons:calendar-03" class="info-icon" />
                <span>注册于 {{ registerDate }}</span>
              </div>
            </div>

            <div class="tooltip absolute right-2 top-2" data-tip="退出登录">
              <button class="btn btn-error btn-soft btn-sm btn-square" :class="{ 'btn-disabled': loggingOut }"
                :disabled="loggingOut" @click="handleLogout">
                <Icon v-if="!loggingOut" name="hugeicons:logout-05" class="action-icon" />
                <span v-if="loggingOut" class="loading loading-spinner loading-xs" />
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  </div>
</template>

<style scoped>
@reference "~/assets/css/tailwind.css";

.avatar-expanded {
  top: 0;
  left: 0;
  width: 54px;
  height: 54px;
}

/* --- Popover --- */
.popover-anchor {
  @apply absolute right-0 top-0 w-60 flex flex-col items-center;
  animation: popover-in 0.18s ease;
}

@keyframes popover-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
}

/* --- Info rows --- */
.info-section {
  @apply flex flex-col gap-1.5 text-xs opacity-60 w-full;
}

.info-row {
  @apply flex items-center gap-1.5;
}

.info-icon {
  @apply w-3.5 h-3.5 shrink-0;
}

/* --- Action bar --- */
.action-bar {
  @apply flex justify-between w-full;
}

.action-icon {
  @apply w-4 h-4;
}
</style>
