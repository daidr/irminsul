<script setup lang="ts">
import { HugeiconsIcon } from "@hugeicons/vue";
import { ComputerIcon, SmartPhone02Icon } from "@hugeicons/core-free-icons";

interface GameSessionItem {
  tokenId: string;
  label: string;
  status: 0 | 1;
  createdIp: string;
  lastUsedIp: string;
  lastUsedAt: number;
  createdAt: number;
}

interface WebSessionItem {
  sessionId: string;
  ip: string;
  ua: string;
  loginAt: number;
  isCurrent: boolean;
}

const activeTab = ref<"game" | "web">("game");
const gameSessions = ref<GameSessionItem[]>([]);
const webSessions = ref<WebSessionItem[]>([]);
const loading = ref(false);
const actionLoading = ref<string | null>(null);
const toast = useToast();

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 从 User-Agent 解析浏览器和操作系统信息 */
function parseWebUA(ua: string): { browser: string; os: string; icon: "monitor" | "smartphone" } {
  let browser = "未知浏览器";
  let os = "未知系统";
  let icon: "monitor" | "smartphone" = "monitor";

  // 浏览器检测
  if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("Chrome/") && !ua.includes("Edg/")) browser = "Chrome";
  else if (ua.includes("Firefox/")) browser = "Firefox";
  else if (ua.includes("Safari/") && !ua.includes("Chrome/")) browser = "Safari";

  // 操作系统检测
  if (ua.includes("iPhone") || ua.includes("iPad")) {
    os = "iOS";
    icon = "smartphone";
  } else if (ua.includes("Android")) {
    os = "Android";
    icon = "smartphone";
  } else if (ua.includes("Windows")) {
    os = "Windows";
  } else if (ua.includes("Mac OS")) {
    os = "macOS";
  } else if (ua.includes("Linux")) {
    os = "Linux";
  }

  return { browser, os, icon };
}

async function loadGameSessions() {
  loading.value = true;
  try {
    const result = await $fetch<{ success: boolean; sessions: GameSessionItem[] }>(
      "/api/user/sessions/game",
    );
    if (result.success) gameSessions.value = result.sessions;
  } catch {
    toast.error("加载游戏会话失败");
  } finally {
    loading.value = false;
  }
}

async function loadWebSessions() {
  loading.value = true;
  try {
    const result = await $fetch<{ success: boolean; sessions: WebSessionItem[] }>(
      "/api/user/sessions/web",
    );
    if (result.success) webSessions.value = result.sessions;
  } catch {
    toast.error("加载网页会话失败");
  } finally {
    loading.value = false;
  }
}

function switchTab(tab: "game" | "web") {
  activeTab.value = tab;
  if (tab === "game") loadGameSessions();
  else loadWebSessions();
}

async function handleInvalidateGame(tokenId: string) {
  actionLoading.value = tokenId;
  try {
    const result = await $fetch<{ success: boolean }>("/api/user/sessions/game", {
      method: "DELETE",
      body: { tokenId },
    });
    if (result.success) await loadGameSessions();
  } catch {
    toast.error("注销会话失败");
  } finally {
    actionLoading.value = null;
  }
}

async function handleInvalidateAllGame() {
  actionLoading.value = "all-game";
  try {
    const result = await $fetch<{ success: boolean }>("/api/user/sessions/game/all", {
      method: "DELETE",
    });
    if (result.success) await loadGameSessions();
  } catch {
    toast.error("注销所有游戏会话失败");
  } finally {
    actionLoading.value = null;
  }
}

async function handleDeleteWeb(sessionId: string) {
  actionLoading.value = sessionId;
  try {
    const result = await $fetch<{ success: boolean }>("/api/user/sessions/web", {
      method: "DELETE",
      body: { sessionId },
    });
    if (result.success) await loadWebSessions();
  } catch {
    toast.error("登出会话失败");
  } finally {
    actionLoading.value = null;
  }
}

async function handleDeleteOtherWeb() {
  actionLoading.value = "all-web";
  try {
    const result = await $fetch<{ success: boolean }>("/api/user/sessions/web/others", {
      method: "DELETE",
    });
    if (result.success) await loadWebSessions();
  } catch {
    toast.error("登出其他会话失败");
  } finally {
    actionLoading.value = null;
  }
}

onMounted(() => {
  loadGameSessions();
});
</script>

<template>
  <!-- Header -->
  <div class="flex items-center justify-between">
    <h3 class="text-xl font-bold">会话管理</h3>
  </div>

  <!-- Tab Bar -->
  <div class="join w-full mt-5">
    <button
      class="btn btn-sm join-item flex-1"
      :class="activeTab === 'game' ? 'btn-primary' : ''"
      @click="switchTab('game')"
    >
      游戏会话
    </button>
    <button
      class="btn btn-sm join-item flex-1"
      :class="activeTab === 'web' ? 'btn-primary' : ''"
      @click="switchTab('web')"
    >
      网页会话
    </button>
  </div>

  <!-- Description -->
  <p class="mt-5 text-[13px] leading-relaxed opacity-50">
    <template v-if="activeTab === 'game'">
      管理当前活跃的游戏会话。你可以在这里强制注销第三方启动器登录态。
    </template>
    <template v-else> 管理当前活跃的网页登录会话。你可以在这里登出其他浏览器。 </template>
  </p>

  <!-- Loading -->
  <div v-if="loading" class="mt-5 flex justify-center py-8">
    <span class="loading loading-spinner loading-md" />
  </div>

  <!-- Game Sessions -->
  <template v-else-if="activeTab === 'game'">
    <div v-if="gameSessions.length === 0" class="mt-5 py-8 text-center text-sm opacity-50">
      暂无游戏会话
    </div>
    <div v-else class="mt-5 flex flex-col gap-3 max-h-[40dvh] overflow-auto">
      <div
        v-for="s in gameSessions"
        :key="s.tokenId"
        class="flex items-center justify-between border border-base-300 bg-base-200/50 px-4 py-3"
        :class="{ 'opacity-50': s.status === 0 }"
      >
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold">{{ s.label }}</span>
            <span
              v-if="s.status === 0"
              class="bg-base-300 px-2 py-0.5 text-[10px] font-semibold opacity-70"
            >
              暂时失效
            </span>
          </div>
          <span class="text-xs opacity-50">
            IP: {{ s.lastUsedIp || s.createdIp || "未知" }} · 最后使用
            {{ formatTime(s.lastUsedAt) }}
          </span>
        </div>
        <button
          class="btn btn-ghost btn-xs border border-error/30 text-error hover:bg-error/10"
          :disabled="actionLoading === s.tokenId"
          @click="handleInvalidateGame(s.tokenId)"
        >
          <span v-if="actionLoading === s.tokenId" class="loading loading-spinner loading-xs" />
          <template v-else>注销</template>
        </button>
      </div>
    </div>

    <!-- Invalidate All -->
    <button
      v-if="gameSessions.length > 0"
      class="btn btn-ghost mt-5 w-full border border-error/30 font-semibold text-error hover:bg-error/10"
      :disabled="actionLoading === 'all-game'"
      @click="handleInvalidateAllGame"
    >
      <span v-if="actionLoading === 'all-game'" class="loading loading-spinner loading-sm" />
      全部注销
    </button>
  </template>

  <!-- Web Sessions -->
  <template v-else>
    <div v-if="webSessions.length === 0" class="mt-5 py-8 text-center text-sm opacity-50">
      暂无活跃的网页会话
    </div>
    <div v-else class="mt-5 flex flex-col gap-3 max-h-[40dvh] overflow-auto">
      <div
        v-for="s in webSessions"
        :key="s.sessionId"
        class="flex items-center justify-between border px-4 py-3"
        :class="s.isCurrent ? 'border-success/50 bg-base-200/50' : 'border-base-300 bg-base-200/50'"
      >
        <div class="flex items-center gap-3">
          <HugeiconsIcon
            v-if="parseWebUA(s.ua).icon === 'monitor'"
            :icon="ComputerIcon"
            :size="20"
            class="shrink-0"
            :class="s.isCurrent ? 'text-success' : 'opacity-40'"
          />
          <HugeiconsIcon
            v-else
            :icon="SmartPhone02Icon"
            :size="20"
            class="shrink-0"
            :class="s.isCurrent ? 'text-success' : 'opacity-40'"
          />
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold">
                {{ parseWebUA(s.ua).browser }} · {{ parseWebUA(s.ua).os }}
              </span>
              <span v-if="s.isCurrent" class="bg-success/15 px-2 py-0.5 text-[10px] text-success">
                当前
              </span>
            </div>
            <span class="text-xs opacity-50">
              IP: {{ s.ip || "未知" }} · 登录于 {{ formatTime(s.loginAt) }}
            </span>
          </div>
        </div>
        <button
          v-if="!s.isCurrent"
          class="btn btn-ghost btn-xs border border-error/30 text-error hover:bg-error/10"
          :disabled="actionLoading === s.sessionId"
          @click="handleDeleteWeb(s.sessionId)"
        >
          <span v-if="actionLoading === s.sessionId" class="loading loading-spinner loading-xs" />
          <template v-else>登出</template>
        </button>
      </div>
    </div>

    <!-- Delete Other Sessions -->
    <button
      v-if="webSessions.length > 1"
      class="btn btn-ghost mt-5 w-full border border-error/30 font-semibold text-error hover:bg-error/10"
      :disabled="actionLoading === 'all-web'"
      @click="handleDeleteOtherWeb"
    >
      <span v-if="actionLoading === 'all-web'" class="loading loading-spinner loading-sm" />
      登出所有其他会话
    </button>
  </template>
</template>

<style scoped lang="scss"></style>
