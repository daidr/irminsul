<script setup lang="ts">
import { HugeiconsIcon } from "@hugeicons/vue";
import { LinkCircle02Icon } from "@hugeicons/core-free-icons";

interface OAuthProvider {
  id: string;
  name: string;
  icon: string;
  brandColor: string;
}

interface OAuthBindingInfo {
  provider: string;
  providerId: string;
  displayName: string;
  boundAt: number;
}

const { data: user } = useUser();
const { data: providersData, refresh: refreshProviders } = await useFetch("/api/oauth/providers");
const toast = useToast();
const unbindLoading = ref<string | null>(null);
const confirmProvider = ref<string | null>(null);

const providers = computed<OAuthProvider[]>(
  () => (providersData.value as { providers: OAuthProvider[] })?.providers ?? [],
);

const bindings = computed<OAuthBindingInfo[]>(
  () => user.value?.oauthBindings ?? [],
);

function getBinding(providerId: string): OAuthBindingInfo | undefined {
  return bindings.value.find((b) => b.provider === providerId);
}

function handleBind(providerId: string) {
  navigateTo(`/api/oauth/${providerId}/authorize?action=bind`, { external: true });
}

async function handleUnbind(providerId: string) {
  if (confirmProvider.value !== providerId) {
    confirmProvider.value = providerId;
    return;
  }

  confirmProvider.value = null;
  unbindLoading.value = providerId;
  try {
    await $fetch(`/api/oauth/${providerId}/unbind`, { method: "POST" });
    toast.success("已解绑");
    await refreshNuxtData("current-user");
  } catch {
    toast.error("解绑失败，请重试");
  } finally {
    unbindLoading.value = null;
  }
}

function cancelConfirm() {
  confirmProvider.value = null;
}
</script>

<template>
  <div>
    <div class="flex items-center gap-2.5 text-lg">
      <HugeiconsIcon :icon="LinkCircle02Icon" :size="20" />
      <h2>账号绑定</h2>
    </div>
    <p class="text-sm opacity-60 mt-1">绑定后可直接使用第三方账号快捷登录</p>

    <div v-if="providers.length === 0" class="mt-4 text-sm opacity-50">
      暂无可用的第三方登录服务
    </div>

    <div v-else class="mt-4 flex flex-col gap-2">
      <div
        v-for="provider in providers"
        :key="provider.id"
        class="flex items-center gap-3 p-3 border"
        :class="getBinding(provider.id)
          ? 'border-base-300'
          : 'border-dashed border-base-300 opacity-60'"
      >
        <!-- Provider Icon -->
        <div
          class="w-10 h-10 flex items-center justify-center shrink-0"
          :style="{ backgroundColor: provider.brandColor }"
        >
          <img
            :src="provider.icon"
            :alt="provider.name"
            class="w-5 h-5"
          >
        </div>

        <!-- Info -->
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm">{{ provider.name }}</div>
          <div v-if="getBinding(provider.id)" class="text-xs opacity-60 mt-0.5">
            {{ getBinding(provider.id)!.displayName }}
          </div>
          <div v-else class="text-xs opacity-40 mt-0.5">未绑定</div>
        </div>

        <!-- Action -->
        <div class="shrink-0 flex items-center gap-2">
          <template v-if="getBinding(provider.id)">
            <span class="text-xs text-success">已绑定</span>
            <button
              v-if="confirmProvider !== provider.id"
              class="btn btn-outline btn-error btn-xs"
              :disabled="unbindLoading === provider.id"
              @click="handleUnbind(provider.id)"
            >
              解绑
            </button>
            <template v-else>
              <button
                class="btn btn-error btn-xs"
                :disabled="unbindLoading === provider.id"
                @click="handleUnbind(provider.id)"
              >
                <span v-if="unbindLoading === provider.id" class="loading loading-spinner loading-xs" />
                确认
              </button>
              <button class="btn btn-ghost btn-xs" @click="cancelConfirm">取消</button>
            </template>
          </template>
          <button
            v-else
            class="btn btn-primary btn-xs"
            @click="handleBind(provider.id)"
          >
            绑定
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

