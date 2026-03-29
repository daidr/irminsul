<script setup lang="ts">
const props = defineProps<{
  userId: string;
}>();

interface UserProfile {
  uuid: string;
  gameId: string;
  isAdmin: boolean;
}

const profile = ref<UserProfile | null>(null);
const loading = ref(true);
const show = ref(false);
let closeTimer: ReturnType<typeof setTimeout> | null = null;

onBeforeUnmount(() => {
  if (closeTimer) clearTimeout(closeTimer);
});

async function loadProfile() {
  if (profile.value || !props.userId) return;
  loading.value = true;
  try {
    const res = await $fetch<{ success: boolean; user: UserProfile }>(
      `/api/admin/users/${props.userId}/profile`,
    );
    if (res.success) profile.value = res.user;
  } catch {
    // silently fail
  } finally {
    loading.value = false;
  }
}

onMounted(loadProfile);

watch(() => props.userId, () => {
  profile.value = null;
  loadProfile();
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
</script>

<template>
  <span v-if="loading" class="inline-flex items-center gap-1 text-[11px] text-base-content/40">
    <span class="loading loading-spinner" style="width: 10px; height: 10px" />
  </span>

  <span v-else-if="!profile" class="text-[11px] text-base-content/40">{{ userId }}</span>

  <span v-else class="relative inline-flex" @mouseenter="onEnter" @mouseleave="onLeave">
    <!-- Capsule trigger -->
    <span class="bubble-trigger">
      <img :src="`/avatar/${profile.uuid}?scale=1`" class="w-3 h-3 shrink-0" style="image-rendering: pixelated">
      <span class="truncate">{{ profile.gameId }}</span>
    </span>

    <!-- Popover -->
    <Transition name="bubble-pop">
      <div v-if="show" class="bubble-popover" @mouseenter="onEnter" @mouseleave="onLeave">
        <div class="flex items-center gap-3">
          <!-- Large avatar -->
          <img :src="`/avatar/${profile.uuid}?scale=3`" class="w-10 h-10 shrink-0" style="image-rendering: pixelated">

          <!-- Info -->
          <div class="min-w-0 flex flex-col gap-0.5">
            <span class="text-sm font-semibold truncate">{{ profile.gameId }}</span>
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[10px] text-base-content/40 font-mono">{{ profile.uuid }}</span>
              <span v-if="profile.isAdmin" class="badge badge-info badge-sm"
                style="font-size: 10px; padding: 0 6px; height: 16px">管理员</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </span>
</template>

<style scoped>
@reference "~/assets/css/tailwind.css";

.bubble-trigger {
  @apply inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] border border-base-300 bg-base-200/60 cursor-default hover:bg-base-300/60 transition-colors;
}

.bubble-popover {
  @apply absolute left-0 bottom-full mb-1 z-50 bg-base-100 border border-base-300 shadow-lg p-3 whitespace-nowrap;
}

.bubble-pop-enter-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.bubble-pop-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}

.bubble-pop-enter-from,
.bubble-pop-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
