<script setup lang="ts">
useHead({ title: "授权确认" });

const route = useRoute();
const toast = useToast();
const { data: user } = useUser();

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "profile:read": "读取基础档案（UUID、游戏 ID、皮肤、披风）",
  "profile:write": "修改材质（上传/删除皮肤和披风）",
  "email:read": "读取邮箱地址",
  "account:read": "读取账户信息（注册时间、封禁状态等）",
};

const clientId = computed(() => (route.query.client_id as string) || "");
const redirectUri = computed(() => (route.query.redirect_uri as string) || "");
const scope = computed(() => (route.query.scope as string) || "");
const state = computed(() => (route.query.state as string) || "");
const codeChallenge = computed(() => (route.query.code_challenge as string) || "");
const codeChallengeMethod = computed(() => (route.query.code_challenge_method as string) || "");

const requestedScopes = computed(() => scope.value.split(" ").filter(Boolean));

const appInfo = ref<{
  name: string;
  description: string;
} | null>(null);
const loadingApp = ref(true);
const isSubmitting = ref(false);

async function fetchApp() {
  if (!clientId.value) return;
  loadingApp.value = true;
  try {
    const data = await $fetch<any>(`/api/oauth-provider/apps/${clientId.value}`);
    appInfo.value = data;
  } catch {
    toast.error("无法加载应用信息");
  } finally {
    loadingApp.value = false;
  }
}

onMounted(fetchApp);

async function handleAction(action: "approve" | "deny") {
  isSubmitting.value = true;
  try {
    const result = await $fetch<{ redirect: string }>("/api/oauth-provider/authorize", {
      method: "POST",
      body: {
        client_id: clientId.value,
        redirect_uri: redirectUri.value,
        scope: scope.value,
        state: state.value || undefined,
        code_challenge: codeChallenge.value || undefined,
        code_challenge_method: codeChallengeMethod.value || undefined,
        action,
      },
    });
    if (result.redirect) {
      window.location.href = result.redirect;
    }
  } catch {
    toast.error("授权请求失败，请重试");
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="flex justify-center items-center px-4 min-h-dvh -mt-18 pt-22 pb-8 bg-base-100">
    <div class="w-full max-w-105 flex flex-col gap-6">
      <!-- Loading -->
      <div v-if="loadingApp" class="flex justify-center p-12">
        <span class="loading loading-spinner loading-md" />
      </div>

      <template v-else-if="appInfo">
        <h1 class="text-2xl text-base-content text-center font-bold">授权确认</h1>

        <!-- App info -->
        <div class="flex flex-col items-center gap-3">
          <div class="w-16 h-16 bg-base-200 border border-base-300 flex items-center justify-center">
            <Icon name="hugeicons:puzzle" class="text-2xl text-base-content/40" />
          </div>
          <div class="text-center">
            <p class="text-lg font-semibold">{{ appInfo.name }}</p>
            <p v-if="appInfo.description" class="text-sm text-base-content/60 mt-1">{{ appInfo.description }}</p>
          </div>
        </div>

        <!-- Current user -->
        <div class="bg-base-200 border border-base-300 p-3 text-sm">
          <span class="text-base-content/60">当前账号：</span>
          <span class="font-medium">{{ user?.gameId }}</span>
        </div>

        <!-- Scopes -->
        <div class="flex flex-col gap-2">
          <p class="text-sm font-semibold text-base-content/80">该应用请求以下权限：</p>
          <ul class="flex flex-col gap-1.5">
            <li
              v-for="s in requestedScopes"
              :key="s"
              class="flex items-start gap-2 bg-base-200 border border-base-300 p-2.5 text-sm"
            >
              <Icon name="hugeicons:shield-key" class="text-base text-primary shrink-0 mt-0.5" />
              <div>
                <span class="font-medium">{{ s }}</span>
                <p v-if="SCOPE_DESCRIPTIONS[s]" class="text-base-content/60 text-xs mt-0.5">
                  {{ SCOPE_DESCRIPTIONS[s] }}
                </p>
              </div>
            </li>
          </ul>
        </div>

        <!-- Actions -->
        <div class="flex gap-3">
          <button
            class="btn btn-ghost flex-1"
            :disabled="isSubmitting"
            @click="handleAction('deny')"
          >
            拒绝
          </button>
          <button
            class="btn btn-primary flex-1"
            :disabled="isSubmitting"
            @click="handleAction('approve')"
          >
            <span v-if="isSubmitting" class="loading loading-spinner loading-sm" />
            授权
          </button>
        </div>
      </template>

      <!-- Error state -->
      <div v-else class="text-center text-base-content/40 py-12">
        无法加载应用信息
      </div>
    </div>
  </div>
</template>
