<script setup lang="ts">
interface ClientBanRecord {
  start: number;
  end?: number;
  reason?: string;
}

const { data: user } = useUser();

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isActive(ban: ClientBanRecord): boolean {
  const now = Date.now();
  return ban.start <= now && (!ban.end || ban.end > now);
}

function isPermanent(ban: ClientBanRecord): boolean {
  return !ban.end;
}

const bans = computed(() => (user.value?.bans as ClientBanRecord[]) ?? []);

const hasActiveBan = computed(() => bans.value.some(isActive));
</script>

<template>
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <h3 class="text-xl font-bold">封禁记录</h3>
      <span v-if="hasActiveBan" class="badge badge-error badge-sm">封禁中</span>
    </div>
  </div>

  <p class="mt-3 text-[13px] leading-relaxed opacity-50">
    以下是你的账户封禁历史记录。封禁仅影响游戏登录，不影响网页端功能。
  </p>

  <!-- Empty State -->
  <div v-if="bans.length === 0" class="mt-5 py-8 text-center text-sm opacity-50">
    暂无封禁记录
  </div>

  <!-- Ban List -->
  <div v-else class="mt-5 flex flex-col gap-3 max-h-[50dvh] overflow-auto">
    <div
      v-for="(ban, index) in bans"
      :key="index"
      class="border px-4 py-3"
      :class="isActive(ban) ? 'border-error/50 bg-error/5' : 'border-base-300 bg-base-200/50'"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Icon
            name="hugeicons:calendar-remove-01"
            class="h-4 w-4 shrink-0"
            :class="isActive(ban) ? 'text-error' : 'opacity-40'"
          />
          <span class="text-sm font-semibold">
            {{ formatTime(ban.start) }}
          </span>
        </div>
        <span
          v-if="isActive(ban) && isPermanent(ban)"
          class="bg-error/15 px-2 py-0.5 text-[10px] font-semibold text-error"
        >
          永久封禁
        </span>
        <span
          v-else-if="isActive(ban)"
          class="bg-error/15 px-2 py-0.5 text-[10px] font-semibold text-error"
        >
          生效中
        </span>
        <span v-else class="bg-base-300 px-2 py-0.5 text-[10px] font-semibold opacity-50">
          已过期
        </span>
      </div>

      <!-- Duration -->
      <div class="mt-2 text-xs opacity-60">
        <span v-if="isPermanent(ban)">{{ formatTime(ban.start) }} 起，永久</span>
        <span v-else>{{ formatTime(ban.start) }} ~ {{ formatTime(ban.end!) }}</span>
      </div>

      <!-- Reason -->
      <div v-if="ban.reason" class="mt-1.5 text-xs opacity-80">
        <span class="opacity-60">原因：</span>{{ ban.reason }}
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss"></style>
